import json
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.schemas.pydantic_models import IngestPayload, VibrationFeatures
from backend.app.core.feature_extractor import extract_features, features_to_vector
from backend.app.core.ml_model import get_active_model
from backend.app.core.decision_engine import get_decision_engine
from backend.app.core.live_hub import live_hub
from backend.app.models.schema import (
    RawWindow, FeatureRecord, AnomalyScoreRecord, DecisionRecord,
    MotorTelemetry, EventRecord, Device, Station
)
from backend.app.core.ai_diagnostics import AIDiagnosticsEngine


class DeviceTracker:
    def __init__(self, device_id: str):
        self.device_id = device_id
        self.last_seq: Optional[int] = None
        self.last_seen_time: Optional[datetime] = None
        self.packet_gap_count: int = 0
        self.duplicate_count: int = 0

_device_trackers: Dict[str, DeviceTracker] = {}
_packet_ingest_counter: int = 0

def prune_transient_telemetry(db: Session, max_rows: int = 3000):
    """
    Rolling retention policy: Trims transient high-frequency tables so the SQLite database
    never balloons uncontrollably. Retains latest max_rows records.
    Audit logs, motor stop analyses, events, models, and settings are never pruned.
    """
    try:
        from sqlalchemy import text
        for tbl in ["raw_windows", "features", "anomaly_scores", "decisions", "motor_telemetry"]:
            row = db.execute(
                text(f"SELECT id FROM {tbl} ORDER BY id DESC LIMIT 1 OFFSET :offset"),
                {"offset": max_rows}
            ).fetchone()
            if row and row[0]:
                cutoff_id = row[0]
                db.execute(text(f"DELETE FROM {tbl} WHERE id <= :cutoff"), {"cutoff": cutoff_id})
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[Retention Policy Pruning Notice] {e}")

class IngestionService:
    latest_reading: Optional[Dict[str, Any]] = None

    @staticmethod
    async def process_payload(payload: IngestPayload, db: Optional[Session] = None) -> Dict[str, Any]:
        """
        Processes an incoming vibration payload from either physical BLE node or Virtual Simulator.
        Hardware-agnostic data contract.
        """
        device_id = payload.device_id
        station_id = payload.station_id
        now = datetime.utcnow()
        
        # 1. Packet Sequence & Loss Tracking
        if device_id not in _device_trackers:
            _device_trackers[device_id] = DeviceTracker(device_id)
        tracker = _device_trackers[device_id]
        
        if tracker.last_seq is not None:
            if payload.seq > tracker.last_seq + 1:
                tracker.packet_gap_count += (payload.seq - tracker.last_seq - 1)
            elif payload.seq <= tracker.last_seq:
                tracker.duplicate_count += 1
        tracker.last_seq = payload.seq
        tracker.last_seen_time = now

        # 2. Extract or Validate Features
        fft_spectrum = None
        if payload.features:
            features_dict = payload.features.model_dump()
            vibration_features = payload.features
            if payload.window and len(payload.window) >= 16:
                _, fft_spectrum = extract_features(
                    payload.window, 
                    sample_rate_hz=payload.sample_rate_hz,
                    compute_spectrum=True
                )
        elif payload.window and len(payload.window) >= 16:
            features_dict, fft_spectrum = extract_features(
                payload.window, 
                sample_rate_hz=payload.sample_rate_hz,
                compute_spectrum=True
            )
            vibration_features = VibrationFeatures(**features_dict)
        elif payload.window and len(payload.window) > 0:
            features_dict, fft_spectrum = extract_features(
                payload.window, 
                sample_rate_hz=payload.sample_rate_hz,
                compute_spectrum=False
            )
            vibration_features = VibrationFeatures(**features_dict)
        else:
            # Fallback zero features
            features_dict, _ = extract_features([], payload.sample_rate_hz)
            vibration_features = VibrationFeatures(**features_dict)

        # 3. Decision Engine & Motor Speed Context
        engine = get_decision_engine(station_id)
        prev_state = engine.state
        motor_data = payload.motor.model_dump() if payload.motor else None
        target_rated_rpm = float(getattr(engine, "motor_rated_rpm", 1500.0))
        measured_rpm = float(payload.motor.measured_rpm) if payload.motor and payload.motor.measured_rpm > 10.0 else target_rated_rpm

        # 4. Model Inference & Scoring using Active Engine (Speed-Adaptive)
        feat_vector = features_to_vector(features_dict)
        active_model = get_active_model()
        raw_score, smoothed_score = active_model.predict_score(
            feat_vector,
            operating_rpm=measured_rpm,
            rated_rpm=target_rated_rpm
        )
        remote_host_score = float(payload.anomaly_score) if payload.anomaly_score is not None else None

        # Dynamically calibrate anomaly score based on MAX TACHOMETER SCALE (RPM) from settings
        max_tachometer_scale = getattr(engine, "motor_max_rpm", 20000.0)
        scale_ratio = 12000.0 / max(1000.0, max_tachometer_scale)

        # When motor is STOPPED, the rotational vibration anomaly score must be 0.00
        if engine.state == "STOPPED" or (payload.motor and payload.motor.measured_rpm < 15.0 and engine.state == "STOPPED"):
            raw_score = 0.00
            smoothed_score = 0.00
        elif remote_host_score is not None and remote_host_score >= 0.0:
            # Dynamic calibration factor: adapts sensitivity to the configured tachometer scale
            dynamic_val = remote_host_score * (0.85 + 0.25 * scale_ratio)
            raw_score = round(max(0.01, min(0.99, dynamic_val)), 4)
            smoothed_score = round(max(0.01, min(0.99, dynamic_val)), 4)
        else:
            raw_score = round(raw_score, 4)
            smoothed_score = round(smoothed_score, 4)

        # Always evaluate safety limits and AI anomaly score
        state, indicator_light, commanded_speed_pct, reason, layer_caused = engine.evaluate(
            features=features_dict,
            anomaly_score=smoothed_score,
            motor=motor_data,
            link_lost=False
        )

        # Check if in spinup grace period after an operator reset / restart
        in_spinup_grace = False
        if getattr(engine, "last_reset_time", None):
            if (datetime.utcnow() - engine.last_reset_time).total_seconds() < 8.0:
                in_spinup_grace = True

        # If decision engine is not already stopped, check if remote host issued an explicit emergency STOP
        if state != "STOPPED" and not in_spinup_grace:
            if payload.decision:
                host_dec = str(payload.decision).upper()
                if host_dec in ["STOP", "STOPPED", "TRIP"]:
                    if engine.motor_trip_mode == "MANUAL":
                        # In MANUAL mode, autonomous motor stop is disabled by policy
                        state = "WARNING"
                        indicator_light = "AMBER"
                        reason = f"Remote Host Advises STOP, but Manual Stop Mode is Active. Motor running. Awaiting manual operator action."
                        layer_caused = "REMOTE_HOST"
                        engine.state = state
                        engine.indicator_light = indicator_light
                        engine.last_decision_reason = reason
                        engine.last_layer_caused = layer_caused
                    else:
                        state = "STOPPED"
                        indicator_light = "RED"
                        commanded_speed_pct = 0.0
                        reason = "Remote Host Decision: STOPPED"
                        layer_caused = "REMOTE_HOST"
                        engine.state = state
                        engine.indicator_light = indicator_light
                        engine.commanded_speed_pct = commanded_speed_pct
                        engine.last_decision_reason = reason
                        engine.last_layer_caused = layer_caused
                elif host_dec in ["REDUCE_SPEED", "REDUCED_SPEED", "SLOW", "WARNING"] and state == "NORMAL":
                    if engine.motor_trip_mode == "MANUAL":
                        state = "WARNING"
                        indicator_light = "AMBER"
                        reason = "Remote Host Advisory: REDUCED_SPEED recommended (Manual Mode Active)"
                        layer_caused = "REMOTE_HOST"
                        engine.state = state
                        engine.indicator_light = indicator_light
                        engine.last_decision_reason = reason
                        engine.last_layer_caused = layer_caused
                    else:
                        state = "REDUCED_SPEED"
                        indicator_light = "AMBER"
                        commanded_speed_pct = 50.0
                        reason = "Remote Host Decision: REDUCED_SPEED"
                        layer_caused = "REMOTE_HOST"
                        engine.state = state
                        engine.indicator_light = indicator_light
                        engine.commanded_speed_pct = commanded_speed_pct
                        engine.last_decision_reason = reason
                        engine.last_layer_caused = layer_caused
            elif payload.status:
                host_st = str(payload.status).upper()
                if host_st == "OFF" and not in_spinup_grace:
                    if engine.motor_trip_mode != "MANUAL":
                        state = "STOPPED"
                        indicator_light = "RED"
                        commanded_speed_pct = 0.0
                        reason = "Remote Host Motor Status: OFF"
                        layer_caused = "REMOTE_HOST"
                        engine.state = state
                        engine.indicator_light = indicator_light
                        engine.commanded_speed_pct = commanded_speed_pct
                        engine.last_decision_reason = reason
                        engine.last_layer_caused = layer_caused

        # 5. Database Persistence
        if db is not None:
            try:
                # Raw Window Record (first 50 samples preview or full)
                if payload.window:
                    preview_json = json.dumps(payload.window[:100])
                    db_raw = RawWindow(
                        device_id=device_id,
                        station_id=station_id,
                        ts=now,
                        seq=payload.seq,
                        sample_rate_hz=payload.sample_rate_hz,
                        axes=payload.axes,
                        window_json=preview_json
                    )
                    db.add(db_raw)

                # Feature Record
                db_feat = FeatureRecord(
                    device_id=device_id,
                    station_id=station_id,
                    ts=now,
                    rms=vibration_features.rms,
                    peak=vibration_features.peak,
                    peak_to_peak=vibration_features.peak_to_peak,
                    crest_factor=vibration_features.crest_factor,
                    kurtosis=vibration_features.kurtosis,
                    skewness=vibration_features.skewness,
                    dominant_freq=vibration_features.dominant_freq,
                    spectral_centroid=vibration_features.spectral_centroid,
                    band_energies=vibration_features.band_energies
                )
                db.add(db_feat)

                # Anomaly Score Record
                db_score = AnomalyScoreRecord(
                    device_id=device_id,
                    station_id=station_id,
                    ts=now,
                    model_version=active_model.version,
                    raw_score=raw_score,
                    smoothed_score=smoothed_score,
                    state=state
                )
                db.add(db_score)

                # Decision Record
                db_decision = DecisionRecord(
                    device_id=device_id,
                    station_id=station_id,
                    ts=now,
                    state=state,
                    reason=reason,
                    layer_caused=layer_caused,
                    commanded_speed_pct=commanded_speed_pct,
                    indicator_light=indicator_light
                )
                db.add(db_decision)

                # Motor Telemetry
                if payload.motor:
                    db_motor = MotorTelemetry(
                        device_id=device_id,
                        station_id=station_id,
                        ts=now,
                        commanded_pct=payload.motor.commanded_pct,
                        measured_rpm=payload.motor.measured_rpm,
                        current_amps=payload.motor.current_amps
                    )
                    db.add(db_motor)

                # Log State Change / Trip Events
                if state != prev_state:
                    event_type = "TRIP" if state == "STOPPED" else ("SPEED_CHANGE" if state == "REDUCED_SPEED" else "STATE_CHANGE")
                    db_event = EventRecord(
                        station_id=station_id,
                        ts=now,
                        event_type=event_type,
                        details=f"Transitioned from {prev_state} to {state}. Reason: {reason}",
                        operator="System",
                        notes=f"Layer: {layer_caused}"
                    )
                    db.add(db_event)

                # AI Post-Trip Diagnostic & Root Cause Analysis when motor is STOPPED
                trip_analysis = None
                if state == "STOPPED":
                    if prev_state != "STOPPED" or engine.latest_trip_analysis is None:
                        trip_analysis = AIDiagnosticsEngine.analyze_motor_stop(
                            station_id=station_id,
                            trip_reason=reason,
                            layer_caused=layer_caused,
                            features=features_dict,
                            motor=motor_data,
                            anomaly_score=smoothed_score,
                            warn_threshold=engine.warn_threshold,
                            critical_threshold=engine.critical_threshold,
                            model_version=active_model.version,
                            device_id=device_id,
                            db=db
                        )
                        engine.latest_trip_analysis = trip_analysis
                    else:
                        trip_analysis = engine.latest_trip_analysis
                elif prev_state == "STOPPED" and state != "STOPPED":
                    engine.latest_trip_analysis = None

                # Update Station state in DB
                st = db.query(Station).filter(Station.id == station_id).first()
                if st:
                    st.state = state
                    st.indicator_light = indicator_light
                    st.commanded_speed_pct = commanded_speed_pct
                    
                db.commit()

                # Periodic automated rolling retention pruning
                global _packet_ingest_counter
                _packet_ingest_counter += 1
                if _packet_ingest_counter >= settings.AUTO_PRUNE_INTERVAL_PACKETS:
                    _packet_ingest_counter = 0
                    prune_transient_telemetry(db, max_rows=settings.TELEMETRY_RETENTION_MAX_ROWS)
            except Exception as e:
                db.rollback()
                # Log error but never crash ingestion
                print(f"[Ingestion DB Error] {e}")

        # Actuate simulator rig and ensure motor halts or restarts
        from simulator.virtual_rig import simulator_rig
        if state == "STOPPED":
            simulator_rig.motor.is_stalled = True
            simulator_rig.motor.commanded_pct = 0.0
            simulator_rig.motor.current_rpm = 0.0
            simulator_rig.apply_backend_command(0.0, "RED", "STOPPED")
            # Forward STOP command to vendor API if state newly transitioned to STOPPED
            if prev_state != "STOPPED":
                try:
                    from backend.app.api.vendor_motor_api import _forward_command_to_vendor
                    asyncio.create_task(_forward_command_to_vendor("STOP", 0.0))
                except Exception as e:
                    print(f"[Vendor API Forwarding Notice] {e}")
        elif state == "REDUCED_SPEED":
            simulator_rig.motor.is_stalled = False
            simulator_rig.apply_backend_command(commanded_speed_pct, indicator_light, state)
            # Forward REDUCE_SPEED command to vendor API when entering reduced speed
            if prev_state != "REDUCED_SPEED":
                try:
                    from backend.app.api.vendor_motor_api import _forward_command_to_vendor
                    rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
                    target_r = rated_ref * 0.5
                    asyncio.create_task(_forward_command_to_vendor("REDUCE_SPEED", target_r))
                except Exception as e:
                    print(f"[Vendor API Forwarding Notice] {e}")
        else:
            simulator_rig.motor.is_stalled = False
            simulator_rig.apply_backend_command(commanded_speed_pct, indicator_light, state)
            # Only forward RESET to vendor API when an explicit operator reset occurred
            if layer_caused in ["MANUAL_RESET", "API_RESTART"]:
                try:
                    from backend.app.api.vendor_motor_api import _forward_command_to_vendor
                    rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
                    asyncio.create_task(_forward_command_to_vendor("RESET", rated_ref))
                except Exception as e:
                    print(f"[Vendor API Restart Forwarding Notice] {e}")

        # Real-time AI Tool Health Prognostics
        ai_health = AIDiagnosticsEngine.calculate_tool_health_index(
            features=features_dict,
            anomaly_score=smoothed_score,
            state=state
        )

        is_stopped = (state == "STOPPED")
        rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
        actual_measured_rpm = 0.0 if is_stopped else (
            payload.motor.measured_rpm if (payload.motor and payload.motor.measured_rpm > 0.0) else (
                (commanded_speed_pct / 100.0) * rated_ref
            )
        )
        actual_cmd_pct = 0.0 if is_stopped else commanded_speed_pct
        actual_current_amps = 0.0 if is_stopped else (payload.motor.current_amps if payload.motor else 0.0)
        actual_motor_status = "OFF" if is_stopped else ("SLOW" if state == "REDUCED_SPEED" else "RUNNING")

        feat_broadcast = vibration_features.model_dump()
        if is_stopped:
            feat_broadcast["rms"] = 0.005
            feat_broadcast["peak"] = 0.008

        # 6. Real-time Live Broadcast to WebSockets
        broadcast_data = {
            "device_id": device_id,
            "station_id": station_id,
            "ts": now.isoformat(),
            "seq": payload.seq,
            "state": state,
            "indicator_light": indicator_light,
            "commanded_speed_pct": actual_cmd_pct,
            "measured_rpm": actual_measured_rpm,
            "motor_status": actual_motor_status,
            "status": actual_motor_status,
            "operational_status": actual_motor_status,
            "current_amps": actual_current_amps,
            "features": feat_broadcast,
            "raw_anomaly_score": raw_score,
            "smoothed_anomaly_score": smoothed_score,
            "anomaly_score": smoothed_score,
            "remote_anomaly_score": remote_host_score,
            "model_type": active_model.model_type,
            "model_version": active_model.version,
            "active_model_type": active_model.model_type,
            "active_model_version": active_model.version,
            "warn_threshold": engine.warn_threshold,
            "critical_threshold": engine.critical_threshold,
            "last_decision_reason": reason,
            "layer_caused": layer_caused,
            "battery_pct": payload.battery_pct or 100.0,
            "rssi": payload.rssi or -55.0,
            "temperature": getattr(payload, "temperature", None) or 26.4,
            "fft_spectrum": fft_spectrum,
            "latest_trip_analysis": engine.latest_trip_analysis,
            "ai_health": ai_health
        }
        await live_hub.broadcast(broadcast_data)
        IngestionService.latest_reading = broadcast_data

        # 7. Motor command feedback response sent back to simulator / BLE rig
        return {
            "status": "ok",
            "state": state,
            "commanded_speed_pct": commanded_speed_pct,
            "indicator_light": indicator_light,
            "reason": reason,
            "layer_caused": layer_caused
        }

    @staticmethod
    async def trigger_link_loss_check(station_id: str = "station-A", timeout_sec: float = 1.0, db: Optional[Session] = None):
        """
        Watchdog checker for link lost state.
        If no packet received within timeout, safe state action is triggered.
        """
        now = datetime.utcnow()
        for dev_id, tracker in _device_trackers.items():
            if tracker.last_seen_time and (now - tracker.last_seen_time).total_seconds() > timeout_sec:
                engine = get_decision_engine(station_id)
                if engine.state != "STOPPED":
                    state, light, speed, reason, layer = engine.evaluate(
                        features={"rms": 0, "peak": 0},
                        anomaly_score=0.0,
                        link_lost=True
                    )
                    if db:
                        ev = EventRecord(
                            station_id=station_id,
                            ts=now,
                            event_type="LINK_LOST",
                            details=f"Packet timeout exceeded {timeout_sec}s for device {dev_id}. Safe-state STOP commanded.",
                            operator="Watchdog"
                        )
                        db.add(ev)
                        db.commit()
                        
                    await live_hub.broadcast({
                        "device_id": dev_id,
                        "station_id": station_id,
                        "ts": now.isoformat(),
                        "seq": tracker.last_seq or 0,
                        "state": state,
                        "indicator_light": light,
                        "commanded_speed_pct": speed,
                        "measured_rpm": 0.0,
                        "features": {"rms": 0.0, "peak": 0.0},
                        "raw_anomaly_score": 0.0,
                        "smoothed_anomaly_score": 0.0,
                        "warn_threshold": engine.warn_threshold,
                        "critical_threshold": engine.critical_threshold,
                        "last_decision_reason": reason,
                        "layer_caused": layer,
                        "battery_pct": 0.0,
                        "rssi": -100.0,
                        "fft_spectrum": []
                    })
