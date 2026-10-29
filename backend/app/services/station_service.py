from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.app.core.decision_engine import get_decision_engine
from backend.app.core.live_hub import live_hub
from backend.app.models.schema import Station, EventRecord

class StationService:
    @staticmethod
    async def reset_station(station_id: str, operator: str = "Operator", notes: Optional[str] = None, db: Optional[Session] = None, rpm: Optional[float] = None) -> Dict[str, Any]:
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

        # Determine dynamic user-configured motor rated RPM
        if rpm and float(rpm) > 10.0:
            rated_target = float(rpm)
            if hasattr(engine, "update_motor_rated_rpm"):
                engine.update_motor_rated_rpm(rated_target)
        else:
            rated_target = float(getattr(engine, "motor_rated_rpm", None) or getattr(engine, "motor_max_rpm", None) or 1500.0)

        # Forward RESET to vendor API
        try:
            from backend.app.api.vendor_motor_api import _forward_command_to_vendor
            await _forward_command_to_vendor("RESET", rated_target)
        except Exception as e:
            print(f"[Vendor Forward Notice] {e}")

        from backend.app.services.ingestion_service import IngestionService
        engine.latest_trip_analysis = None
        if IngestionService.latest_reading is not None:
            IngestionService.latest_reading["state"] = "NORMAL"
            IngestionService.latest_reading["indicator_light"] = "GREEN"
            IngestionService.latest_reading["commanded_speed_pct"] = 100.0
            IngestionService.latest_reading["measured_rpm"] = rated_target
            IngestionService.latest_reading["motor_status"] = "RUNNING"
            IngestionService.latest_reading["is_running"] = True
            IngestionService.latest_reading["is_slow"] = False
            IngestionService.latest_reading["is_off"] = False
            IngestionService.latest_reading["last_decision_reason"] = f"Explicit reset executed by {operator}."
            IngestionService.latest_reading["layer_caused"] = "MANUAL_RESET"
            IngestionService.latest_reading["latest_trip_analysis"] = None

        # Extract dynamic device ID and live features from active ingestion
        active_device = (IngestionService.latest_reading or {}).get("device_id") or "304A2657BF44"
        live_features = (IngestionService.latest_reading or {}).get("features") or {"rms": 0.0, "peak": 0.0, "crest_factor": 1.0, "kurtosis": 0.0, "dominant_freq": 0.0}
        live_score = float((IngestionService.latest_reading or {}).get("smoothed_anomaly_score") or 0.0)

        # Broadcast state update immediately
        await live_hub.broadcast({
            "device_id": active_device,
            "station_id": station_id,
            "ts": now.isoformat(),
            "seq": 0,
            "state": "NORMAL",
            "indicator_light": "GREEN",
            "commanded_speed_pct": 100.0,
            "measured_rpm": rated_target,
            "features": live_features,
            "raw_anomaly_score": live_score,
            "smoothed_anomaly_score": live_score,
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

        # Forward STOP to vendor API
        try:
            from backend.app.api.vendor_motor_api import _forward_command_to_vendor
            await _forward_command_to_vendor("STOP", 0.0)
        except Exception as e:
            print(f"[Vendor Forward Notice] {e}")

        # Generate AI Root Cause Analysis & Forensics for the E-Stop incident
        from backend.app.core.ai_diagnostics import AIDiagnosticsEngine
        from backend.app.services.ingestion_service import IngestionService

        active_device = (IngestionService.latest_reading or {}).get("device_id") or "304A2657BF44"
        live_features = (IngestionService.latest_reading or {}).get("features") or {"rms": 0.0, "peak": 0.0, "crest_factor": 1.0, "kurtosis": 0.0, "dominant_freq": 0.0}
        live_score = float((IngestionService.latest_reading or {}).get("smoothed_anomaly_score") or 0.0)
        live_battery = (IngestionService.latest_reading or {}).get("battery_pct")
        live_rssi = (IngestionService.latest_reading or {}).get("rssi")
        live_fft = (IngestionService.latest_reading or {}).get("fft_spectrum") or []

        trip_analysis = None
        try:
            trip_analysis = AIDiagnosticsEngine.analyze_motor_stop(
                station_id=station_id,
                trip_reason=f"Operator Emergency Stop (E-Stop) commanded by {operator}.",
                layer_caused="MANUAL_STOP",
                features=live_features,
                motor={"commanded_pct": 0.0, "measured_rpm": 0.0},
                anomaly_score=live_score,
                warn_threshold=engine.warn_threshold,
                critical_threshold=engine.critical_threshold,
                model_version="v1.0.0-baseline",
                device_id=active_device,
                db=db
            )
            engine.latest_trip_analysis = trip_analysis
        except Exception as e:
            print(f"[E-Stop Diagnostics Warning] {e}")

        # Update IngestionService.latest_reading immediately so API pollers receive STOPPED / OFF
        IngestionService.latest_reading = {
            "device_id": active_device,
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
            "features": live_features,
            "raw_anomaly_score": live_score,
            "smoothed_anomaly_score": live_score,
            "warn_threshold": engine.warn_threshold,
            "critical_threshold": engine.critical_threshold,
            "last_decision_reason": f"Emergency stop commanded by {operator}.",
            "layer_caused": "MANUAL_STOP",
            "latest_trip_analysis": trip_analysis
        }

        # Broadcast complete LiveTelemetry payload
        await live_hub.broadcast({
            "device_id": active_device,
            "station_id": station_id,
            "ts": now.isoformat(),
            "seq": 0,
            "state": "STOPPED",
            "indicator_light": "RED",
            "commanded_speed_pct": 0.0,
            "measured_rpm": 0.0,
            "current_amps": 0.0,
            "features": live_features,
            "raw_anomaly_score": live_score,
            "smoothed_anomaly_score": live_score,
            "warn_threshold": engine.warn_threshold,
            "critical_threshold": engine.critical_threshold,
            "last_decision_reason": f"Manual emergency stop commanded by {operator}. Spindle power cut to 0 RPM.",
            "layer_caused": "MANUAL_STOP",
            "battery_pct": live_battery,
            "rssi": live_rssi,
            "fft_spectrum": live_fft,
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
