from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.app.core.decision_engine import get_decision_engine
from backend.app.core.live_hub import live_hub
from backend.app.models.schema import Station, EventRecord
from simulator.virtual_rig import simulator_rig

class StationService:
    @staticmethod
    async def reset_station(station_id: str, operator: str = "Operator", notes: Optional[str] = None, db: Optional[Session] = None) -> Dict[str, Any]:
        from backend.app.core.decision_engine import reset_all_decision_engines
        reset_all_decision_engines(operator=operator, notes=notes)
        engine = get_decision_engine(station_id)
        result = engine.reset(operator=operator, notes=notes)
        now = datetime.utcnow()
        
        if db:
            for st in db.query(Station).all():
                st.state = "NORMAL"
                st.indicator_light = "GREEN"
                st.commanded_speed_pct = 100.0
                
            ev = EventRecord(
                station_id=station_id,
                ts=now,
                event_type="RESET",
                details=f"Explicit reset performed by {operator}. Notes: {notes or 'N/A'}",
                operator=operator,
                notes=notes
            )
            db.add(ev)
            db.commit()

        # Clear any fault scenario back to normal so the simulator does not re-trip immediately
        if simulator_rig.scenario in ["disturbance_on", "disturbance_ramp", "sensor_dropout", "packet_loss", "critical_failure"]:
            simulator_rig.set_scenario("normal", amplitude=0.08, freq=180.0)
        simulator_rig.motor.is_stalled = False
        simulator_rig.motor.commanded_pct = 100.0
        simulator_rig.motor.current_rpm = 12000.0
        simulator_rig.is_running = False

        # Update simulator rig motor command
        simulator_rig.apply_backend_command(
            commanded_speed_pct=100.0,
            indicator_light="GREEN",
            station_state="NORMAL"
        )

        # Forward RESET to vendor API
        try:
            from backend.app.api.vendor_motor_api import _forward_command_to_vendor
            await _forward_command_to_vendor("RESET", 12000.0)
        except Exception as e:
            print(f"[Vendor Forward Notice] {e}")

        from backend.app.services.ingestion_service import IngestionService
        engine.latest_trip_analysis = None
        if IngestionService.latest_reading is not None:
            IngestionService.latest_reading["state"] = "NORMAL"
            IngestionService.latest_reading["indicator_light"] = "GREEN"
            IngestionService.latest_reading["commanded_speed_pct"] = 100.0
            IngestionService.latest_reading["measured_rpm"] = 12000.0
            IngestionService.latest_reading["motor_status"] = "RUNNING"
            IngestionService.latest_reading["is_running"] = True
            IngestionService.latest_reading["is_slow"] = False
            IngestionService.latest_reading["is_off"] = False
            IngestionService.latest_reading["last_decision_reason"] = f"Explicit reset executed by {operator}."
            IngestionService.latest_reading["layer_caused"] = "MANUAL_RESET"
            IngestionService.latest_reading["latest_trip_analysis"] = None

        # Broadcast state update immediately
        await live_hub.broadcast({
            "device_id": "AC:23:3F:88:D1:05",
            "station_id": station_id,
            "ts": now.isoformat(),
            "seq": 0,
            "state": "NORMAL",
            "indicator_light": "GREEN",
            "commanded_speed_pct": 100.0,
            "measured_rpm": 12000.0,
            "features": {"rms": 0.045, "peak": 0.075},
            "raw_anomaly_score": 0.05,
            "smoothed_anomaly_score": 0.05,
            "warn_threshold": engine.warn_threshold,
            "critical_threshold": engine.critical_threshold,
            "last_decision_reason": f"Explicit reset executed by {operator}.",
            "layer_caused": "MANUAL_RESET",
            "latest_trip_analysis": None
        })
        return result

    @staticmethod
    async def emergency_stop(station_id: str, operator: str = "Operator", notes: Optional[str] = None, db: Optional[Session] = None) -> Dict[str, Any]:
        engine = get_decision_engine(station_id)
        result = engine.manual_stop(operator=operator, notes=notes)
        now = datetime.utcnow()
        
        if db:
            for st in db.query(Station).all():
                st.state = "STOPPED"
                st.indicator_light = "RED"
                st.commanded_speed_pct = 0.0
                
            ev = EventRecord(
                station_id=station_id,
                ts=now,
                event_type="MANUAL_STOP",
                details=f"Emergency manual stop by {operator}. Notes: {notes or 'N/A'}",
                operator=operator,
                notes=notes
            )
            db.add(ev)
            db.commit()

        simulator_rig.motor.is_stalled = True
        simulator_rig.motor.commanded_pct = 0.0
        simulator_rig.motor.current_rpm = 0.0
        simulator_rig.apply_backend_command(
            commanded_speed_pct=0.0,
            indicator_light="RED",
            station_state="STOPPED"
        )

        # Forward STOP to vendor API
        try:
            from backend.app.api.vendor_motor_api import _forward_command_to_vendor
            await _forward_command_to_vendor("STOP", 0.0)
        except Exception as e:
            print(f"[Vendor Forward Notice] {e}")

        # Generate AI Root Cause Analysis & Forensics for the E-Stop incident
        from backend.app.core.ai_diagnostics import AIDiagnosticsEngine
        trip_analysis = None
        try:
            trip_analysis = AIDiagnosticsEngine.analyze_motor_stop(
                station_id=station_id,
                trip_reason=f"Operator Emergency Stop (E-Stop) commanded by {operator}.",
                layer_caused="MANUAL_STOP",
                features={"rms": 0.005, "peak": 0.008, "crest_factor": 1.414, "kurtosis": 0.0, "dominant_freq": 0.0},
                motor={"commanded_pct": 0.0, "measured_rpm": 0.0},
                anomaly_score=0.0,
                warn_threshold=engine.warn_threshold,
                critical_threshold=engine.critical_threshold,
                model_version="v1.0.0-baseline",
                device_id="AC:23:3F:88:D1:05",
                db=db
            )
            engine.latest_trip_analysis = trip_analysis
        except Exception as e:
            print(f"[E-Stop Diagnostics Warning] {e}")

        # Update IngestionService.latest_reading immediately so API pollers receive STOPPED / OFF
        from backend.app.services.ingestion_service import IngestionService
        IngestionService.latest_reading = {
            "device_id": "AC:23:3F:88:D1:05",
            "station_id": station_id,
            "ts": now.isoformat(),
            "seq": 0,
            "state": "STOPPED",
            "indicator_light": "RED",
            "commanded_speed_pct": 0.0,
            "measured_rpm": 0.0,
            "current_amps": 0.0,
            "status": "OFF",
            "motor_status": "OFF",
            "features": {"rms": 0.005, "peak": 0.008, "crest_factor": 1.414, "kurtosis": 0.0, "dominant_freq": 0.0},
            "raw_anomaly_score": 0.0,
            "smoothed_anomaly_score": 0.0,
            "warn_threshold": engine.warn_threshold,
            "critical_threshold": engine.critical_threshold,
            "last_decision_reason": f"Emergency stop commanded by {operator}.",
            "layer_caused": "MANUAL_STOP",
            "latest_trip_analysis": trip_analysis
        }

        # Broadcast complete LiveTelemetry payload
        await live_hub.broadcast({
            "device_id": "AC:23:3F:88:D1:05",
            "station_id": station_id,
            "ts": now.isoformat(),
            "seq": 0,
            "state": "STOPPED",
            "indicator_light": "RED",
            "commanded_speed_pct": 0.0,
            "measured_rpm": 0.0,
            "current_amps": 0.0,
            "features": {
                "rms": 0.005,
                "peak": 0.008,
                "crest_factor": 1.414,
                "kurtosis": 0.0,
                "dominant_freq": 0.0
            },
            "raw_anomaly_score": 0.0,
            "smoothed_anomaly_score": 0.0,
            "warn_threshold": engine.warn_threshold,
            "critical_threshold": engine.critical_threshold,
            "last_decision_reason": f"Manual emergency stop commanded by {operator}. Spindle power cut to 0 RPM.",
            "layer_caused": "MANUAL_STOP",
            "battery_pct": 98,
            "rssi": -56,
            "fft_spectrum": [
                {"freq": 50, "magnitude": 0.001},
                {"freq": 100, "magnitude": 0.001},
                {"freq": 150, "magnitude": 0.001}
            ],
            "latest_trip_analysis": trip_analysis,
            "ai_health": {
                "health_index_pct": 25.0,
                "stage": "CRITICAL_TRIP",
                "stage_color": "#ef4444",
                "estimated_cycles_remaining": 0,
                "diagnostic_note": "Emergency Stop engaged. Spindle drive interlocked pending reset."
            }
        })

        result["trip_analysis"] = trip_analysis
        return result
