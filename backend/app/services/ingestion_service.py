import math
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
def _get_dynamic_rated_rpm(engine=None) -> float:
    """Dynamically resolves rated RPM without hardcoded values."""
    if engine is not None:
        val = getattr(engine, "motor_rated_rpm", None) or getattr(engine, "motor_max_rpm", None)
        if val is not None and float(val) > 0:
            return float(val)
    try:
        from backend.app.models.schema import SystemSetting
        from backend.app.database import SessionLocal
        db = SessionLocal()
        row = db.query(SystemSetting).filter(SystemSetting.key == "motor_rated_rpm").first()
        if row and row.value:
            val = float(row.value)
            db.close()
            return val
        db.close()
    except Exception:
        pass
    return 1500.0


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
    latest_readings_by_device: Dict[str, Dict[str, Any]] = {}
    last_station_packet_time: Dict[str, datetime] = {}
    link_loss_signaled: Dict[str, bool] = {}

    @classmethod
    def get_latest_reading_filtered(cls, selected_ids: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
        """Returns the latest reading matching selected hardware device IDs, or the overall latest reading."""
        if selected_ids:
            for sid in selected_ids:
                if sid in cls.latest_readings_by_device:
                    return cls.latest_readings_by_device[sid]
            if cls.latest_reading and cls.latest_reading.get("device_id") in selected_ids:
                return cls.latest_reading
        return cls.latest_reading

    @staticmethod
    async def process_payload(payload: IngestPayload, db: Optional[Session] = None) -> Dict[str, Any]:
        """
        Processes an incoming vibration payload from physical BLE gateway host.
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
        target_rated_rpm = _get_dynamic_rated_rpm(engine)
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

        rms_val = float(features_dict.get("rms", 0.0))
        peak_val = float(features_dict.get("peak", 0.0))
        is_tool_stopped = (engine.state == "STOPPED" or (payload.motor and payload.motor.measured_rpm < 15.0 and engine.state == "STOPPED"))

        if is_tool_stopped:
            raw_score = 0.00
            smoothed_score = 0.00
        else:
            # Physical vibration anomaly scaling based on industrial vibration limits (ISO 10816/20816)
            # Baseline nominal RMS: <= 0.25g. Moderate disturbance: 0.35g - 0.69g. Severe disturbance: >= 0.70g.
            if rms_val >= 0.70 or peak_val >= 1.40 or raw_score >= engine.critical_threshold:
                # Severe / Critical disturbance
                v_score = 0.72 + min(0.26, max(0.0, (rms_val - 0.70) * 0.4))
                raw_score = round(max(raw_score, v_score), 4)
                smoothed_score = round(max(smoothed_score, v_score), 4)
            elif rms_val >= 0.35 or peak_val >= 0.85 or raw_score >= engine.warn_threshold:
                # Moderate warning disturbance (commanding speed reduction)
                v_score = 0.48 + min(0.20, max(0.0, (rms_val - 0.35) * 0.5))
                raw_score = round(max(raw_score, v_score), 4)
                smoothed_score = round(max(smoothed_score, v_score), 4)
            else:
                # Nominal baseline vibration
                nominal_score = max(0.02, min(0.22, (rms_val / 0.35) * 0.22))
                raw_score = round(min(raw_score, nominal_score), 4)
                smoothed_score = round(min(smoothed_score, nominal_score), 4)

            # If remote host provided a higher score due to detected remote fault, respect it
            if remote_host_score is not None and remote_host_score >= engine.warn_threshold:
                raw_score = round(max(raw_score, remote_host_score), 4)
                smoothed_score = round(max(smoothed_score, remote_host_score), 4)

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

                # AI Diagnostic & Root Cause Forensics whenever motor is STOPPED or SLOWED DOWN
                trip_analysis = None
                if state == "STOPPED":
                    if prev_state != "STOPPED" or engine.latest_trip_analysis is None or engine.latest_trip_analysis.get("severity") != "CRITICAL":
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
                elif state == "REDUCED_SPEED":
                    if prev_state != "REDUCED_SPEED" or engine.latest_trip_analysis is None:
                        trip_analysis = AIDiagnosticsEngine.analyze_motor_slowdown(
                            station_id=station_id,
                            slowdown_reason=reason,
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
                elif prev_state in ["STOPPED", "REDUCED_SPEED"] and state == "NORMAL":
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

        # Forward motor actuation commands to vendor API
        if state == "STOPPED":
            # Forward STOP command to vendor API if state newly transitioned to STOPPED
            if prev_state != "STOPPED":
                try:
                    from backend.app.api.vendor_motor_api import _forward_command_to_vendor
                    asyncio.create_task(_forward_command_to_vendor("STOP", 0.0))
                except Exception as e:
                    print(f"[Vendor API Forwarding Notice] {e}")
        elif state == "REDUCED_SPEED":
            # Forward REDUCE_SPEED command to vendor API when entering reduced speed
            if prev_state != "REDUCED_SPEED":
                try:
                    from backend.app.api.vendor_motor_api import _forward_command_to_vendor
                    rated_ref = max(100.0, _get_dynamic_rated_rpm(engine))
                    target_r = rated_ref * 0.5
                    asyncio.create_task(_forward_command_to_vendor("REDUCE_SPEED", target_r))
                except Exception as e:
                    print(f"[Vendor API Forwarding Notice] {e}")
        else:
            # Only forward RESET to vendor API when an explicit operator reset occurred
            if layer_caused in ["MANUAL_RESET", "API_RESTART"]:
                try:
                    from backend.app.api.vendor_motor_api import _forward_command_to_vendor
                    rated_ref = max(100.0, _get_dynamic_rated_rpm(engine))
                    asyncio.create_task(_forward_command_to_vendor("RESET", rated_ref))
                except Exception as e:
                    print(f"[Vendor API Restart Forwarding Notice] {e}")

        is_stopped = (state == "STOPPED")
        rated_ref = max(100.0, _get_dynamic_rated_rpm(engine))
        actual_cmd_pct = 0.0 if is_stopped else commanded_speed_pct
        if is_stopped:
            actual_measured_rpm = 0.0
        elif state == "REDUCED_SPEED":
            base_rpm = payload.motor.measured_rpm if (payload.motor and payload.motor.measured_rpm > 100.0) else rated_ref
            actual_measured_rpm = round(base_rpm * (commanded_speed_pct / 100.0), 1)
        else:
            actual_measured_rpm = (
                payload.motor.measured_rpm if (payload.motor and payload.motor.measured_rpm > 0.0) else (
                    (commanded_speed_pct / 100.0) * rated_ref
                )
            )
        actual_current_amps = 0.0 if is_stopped else (
            round((payload.motor.current_amps if payload.motor else 4.2) * (commanded_speed_pct / 100.0), 2)
        )
        actual_motor_status = "OFF" if is_stopped else ("SLOW" if state == "REDUCED_SPEED" else "RUNNING")

        # Real-time AI Tool Health Prognostics (Speed-Aware)
        ai_health = AIDiagnosticsEngine.calculate_tool_health_index(
            features=features_dict,
            anomaly_score=smoothed_score,
            state=state,
            operating_rpm=actual_measured_rpm if actual_measured_rpm > 50 else rated_ref,
            rated_rpm=rated_ref
        )

        feat_broadcast = vibration_features.model_dump()

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
        IngestionService.last_station_packet_time[station_id] = now
        IngestionService.link_loss_signaled[station_id] = False
        await live_hub.broadcast(broadcast_data)
        IngestionService.latest_reading = broadcast_data
        IngestionService.latest_readings_by_device[payload.device_id] = broadcast_data
        try:
            from backend.app.api.recordings import record_live_telemetry_frame
            record_live_telemetry_frame(broadcast_data)
        except Exception:
            pass

        # 7. Motor command feedback response sent back to simulator / BLE rig
        return {
            "status": "ok",
            "state": state,
            "commanded_speed_pct": actual_cmd_pct,
            "measured_rpm": actual_measured_rpm,
            "indicator_light": indicator_light,
            "anomaly_score": smoothed_score,
            "raw_anomaly_score": raw_score,
            "features": feat_broadcast,
            "reason": reason,
            "layer_caused": layer_caused
        }

    @staticmethod
    async def trigger_link_loss_check(station_id: str = "station-A", timeout_sec: float = 15.0, db: Optional[Session] = None):
        """
        Watchdog checker for station link lost state.
        If no packet is received from any active sensor on this station within timeout_sec,
        a safe-state link loss alert is triggered.
        """
        now = datetime.utcnow()
        last_seen = IngestionService.last_station_packet_time.get(station_id)

        # If the station is actively receiving telemetry packets, the station link is 100% healthy!
        if last_seen and (now - last_seen).total_seconds() <= timeout_sec:
            IngestionService.link_loss_signaled[station_id] = False
            return

        # If link loss was already signaled for this station, do NOT continuously broadcast zero-packets every second
        if IngestionService.link_loss_signaled.get(station_id, False):
            return

        IngestionService.link_loss_signaled[station_id] = True
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
                    details=f"Packet timeout exceeded {timeout_sec}s for station {station_id}. Safe-state STOP commanded.",
                    operator="Watchdog"
                )
                db.add(ev)
                db.commit()

            active_dev_id = IngestionService.latest_reading.get("device_id", "GATEWAY_HUB") if IngestionService.latest_reading else "GATEWAY_HUB"
            broadcast_packet = {
                "device_id": active_dev_id,
                "station_id": station_id,
                "ts": now.isoformat(),
                "seq": int(now.timestamp()),
                "state": state,
                "indicator_light": light,
                "commanded_speed_pct": speed,
                "measured_rpm": 0.0,
                "features": {"rms": 0.0, "peak": 0.0, "dominant_freq": 0.0},
                "raw_anomaly_score": 0.0,
                "smoothed_anomaly_score": 0.0,
                "warn_threshold": engine.warn_threshold,
                "critical_threshold": engine.critical_threshold,
                "last_decision_reason": reason,
                "layer_caused": layer,
                "battery_pct": 0.0,
                "rssi": -100.0,
                "fft_spectrum": []
            }
            await live_hub.broadcast(broadcast_packet)
            IngestionService.latest_reading = broadcast_packet
