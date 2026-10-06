from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import datetime
from backend.app.database import get_db
from backend.app.models.schema import Station, AuditLog, MotorStopAnalysis
from backend.app.core.decision_engine import get_decision_engine
from backend.app.services.station_service import StationService
from backend.app.core.security import require_role
from backend.app.schemas.pydantic_models import StationControlCommand


router = APIRouter(prefix="/stations", tags=["Stations & Controls"])

class ThresholdUpdateRequest(BaseModel):
    warn_threshold: float
    critical_threshold: float
    persistence_windows: Optional[int] = 3

@router.get("")
def list_stations(db: Session = Depends(get_db)):
    stations = db.query(Station).all()
    res = []
    for s in stations:
        engine = get_decision_engine(s.id)
        res.append({
            "id": s.id,
            "name": s.name,
            "line_id": s.line_id,
            "state": engine.state,
            "indicator_light": engine.indicator_light,
            "commanded_speed_pct": engine.commanded_speed_pct,
            "current_model_version": s.current_model_version,
            "last_decision_reason": engine.last_decision_reason,
            "layer_caused": engine.last_layer_caused
        })
    return res

@router.get("/{station_id}/status")
def get_station_status(station_id: str, db: Session = Depends(get_db)):
    st = db.query(Station).filter(Station.id == station_id).first()
    if not st:
        raise HTTPException(status_code=404, detail="Station not found")
    engine = get_decision_engine(station_id)
    return {
        "id": st.id,
        "name": st.name,
        "state": engine.state,
        "indicator_light": engine.indicator_light,
        "commanded_speed_pct": engine.commanded_speed_pct,
        "current_model_version": st.current_model_version,
        "last_decision_reason": engine.last_decision_reason,
        "layer_caused": engine.last_layer_caused,
        "warn_threshold": engine.warn_threshold,
        "critical_threshold": engine.critical_threshold,
        "persistence_windows": engine.persistence_windows
    }

@router.put("/{station_id}/thresholds")
def update_station_thresholds(
    station_id: str,
    req: ThresholdUpdateRequest,
    current_user: dict = Depends(require_role(["Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    from backend.app.models.schema import SystemSetting
    from backend.app.core.decision_engine import _station_engines

    engine = get_decision_engine(station_id)
    engine.update_thresholds(req.warn_threshold, req.critical_threshold, req.persistence_windows)

    # Update all instantiated engines so station engines remain synchronized
    for eng in set(list(_station_engines.values()) + [engine]):
        eng.update_thresholds(req.warn_threshold, req.critical_threshold, req.persistence_windows)

    # Persist directly into SystemSetting table so thresholds survive restarts and stay uniform
    warn_row = db.query(SystemSetting).filter(SystemSetting.key == "warn_threshold").first()
    if warn_row:
        warn_row.value = str(req.warn_threshold)
    else:
        db.add(SystemSetting(key="warn_threshold", value=str(req.warn_threshold)))

    crit_row = db.query(SystemSetting).filter(SystemSetting.key == "critical_threshold").first()
    if crit_row:
        crit_row.value = str(req.critical_threshold)
    else:
        db.add(SystemSetting(key="critical_threshold", value=str(req.critical_threshold)))

    if req.persistence_windows:
        pers_row = db.query(SystemSetting).filter(SystemSetting.key == "persistence_windows").first()
        if pers_row:
            pers_row.value = str(req.persistence_windows)
        else:
            db.add(SystemSetting(key="persistence_windows", value=str(req.persistence_windows)))
    
    # Audit log entry
    db.add(AuditLog(
        username=current_user.get("username", "Engineer"),
        action="UPDATE_THRESHOLDS",
        resource=f"Station:{station_id}",
        details=f"Warn={req.warn_threshold}, Crit={req.critical_threshold}, Persistence={req.persistence_windows}"
    ))
    db.commit()

    return {
        "status": "updated",
        "station_id": station_id,
        "warn_threshold": engine.warn_threshold,
        "critical_threshold": engine.critical_threshold,
        "persistence_windows": engine.persistence_windows
    }

@router.post("/{station_id}/reset")
@router.post("/{station_id}/motor/restart")
async def reset_station(
    station_id: str,
    cmd: Optional[StationControlCommand] = None,
    current_user: dict = Depends(require_role(["Operator", "Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    operator = current_user.get("username", "Operator")
    notes = cmd.notes if cmd else None
    result = await StationService.reset_station(station_id, operator=operator, notes=notes, db=db)
    
    db.add(AuditLog(
        username=operator,
        action="RESET_STATION",
        resource=f"Station:{station_id}",
        details=f"Explicit reset / motor restart performed. Notes: {notes or 'N/A'}"
    ))

    # Mark unresolved stop analyses as resolved in database
    try:
        unresolved = (
            db.query(MotorStopAnalysis)
            .filter(MotorStopAnalysis.station_id == station_id, MotorStopAnalysis.resolved == False)
            .all()
        )
        for u in unresolved:
            u.resolved = True
            u.resolved_by = operator
            u.resolved_at = datetime.datetime.utcnow()
            u.resolution_notes = notes or "Cleared during explicit operator reset."
    except Exception as e:
        print(f"[Reset Resolve Error] {e}")

    db.commit()
    return result

@router.post("/{station_id}/stop")
@router.post("/{station_id}/motor/stop")
async def emergency_stop_station(
    station_id: str,
    cmd: Optional[StationControlCommand] = None,
    current_user: dict = Depends(require_role(["Operator", "Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    operator = current_user.get("username", "Operator")
    notes = cmd.notes if cmd else None
    result = await StationService.emergency_stop(station_id, operator=operator, notes=notes, db=db)
    
    db.add(AuditLog(
        username=operator,
        action="EMERGENCY_STOP",
        resource=f"Station:{station_id}",
        details=f"Emergency manual motor stop commanded. Notes: {notes or 'N/A'}"
    ))
    db.commit()
    return result

@router.get("/{station_id}/latest-trip-analysis")
def get_latest_trip_analysis(station_id: str, db: Session = Depends(get_db)):
    engine = get_decision_engine(station_id)
    if engine.latest_trip_analysis:
        return engine.latest_trip_analysis

    engine_a = get_decision_engine("station-A")
    if engine_a.latest_trip_analysis:
        return engine_a.latest_trip_analysis

    record = (
        db.query(MotorStopAnalysis)
        .filter(MotorStopAnalysis.station_id == station_id)
        .order_by(MotorStopAnalysis.ts.desc())
        .first()
    )
    if not record and station_id != "station-A":
        record = (
            db.query(MotorStopAnalysis)
            .filter(MotorStopAnalysis.station_id == "station-A")
            .order_by(MotorStopAnalysis.ts.desc())
            .first()
        )
    if not record:
        return None

    return {
        "id": record.id,
        "station_id": record.station_id,
        "device_id": record.device_id,
        "timestamp": record.ts.isoformat() + "Z" if record.ts else None,
        "primary_cause": record.primary_cause,
        "fault_category": record.fault_category,
        "confidence_pct": record.confidence_pct,
        "severity": record.severity,
        "explanation": record.explanation,
        "recommended_action": record.recommended_action,
        "layer_caused": record.layer_caused,
        "forensics": record.forensics,
        "resolved": record.resolved,
        "resolved_by": record.resolved_by,
        "resolved_at": record.resolved_at.isoformat() + "Z" if record.resolved_at else None,
        "resolution_notes": record.resolution_notes
    }

@router.get("/{station_id}/trip-history")
def get_trip_history(station_id: str, limit: int = 20, db: Session = Depends(get_db)):
    records = (
        db.query(MotorStopAnalysis)
        .filter(MotorStopAnalysis.station_id == station_id)
        .order_by(MotorStopAnalysis.ts.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "station_id": r.station_id,
            "device_id": r.device_id,
            "timestamp": r.ts.isoformat() + "Z" if r.ts else None,
            "primary_cause": r.primary_cause,
            "fault_category": r.fault_category,
            "confidence_pct": r.confidence_pct,
            "severity": r.severity,
            "explanation": r.explanation,
            "recommended_action": r.recommended_action,
            "layer_caused": r.layer_caused,
            "forensics": r.forensics,
            "resolved": r.resolved,
            "resolved_by": r.resolved_by,
            "resolved_at": r.resolved_at.isoformat() + "Z" if r.resolved_at else None,
            "resolution_notes": r.resolution_notes
        }
        for r in records
    ]

