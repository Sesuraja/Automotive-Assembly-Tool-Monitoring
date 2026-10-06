from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models.schema import Organization, Plant, Line, Station, Device, User, AuditLog, SystemSetting
from backend.app.core.security import require_role

router = APIRouter(prefix="/admin", tags=["Administration & Hierarchy"])

@router.get("/hierarchy")
def get_hierarchy(db: Session = Depends(get_db)):
    orgs = db.query(Organization).all()
    result = []
    for org in orgs:
        plants = []
        for p in org.plants:
            lines = []
            for l in p.lines:
                stations = []
                for s in l.stations:
                    devices = [{"id": d.id, "name": d.name, "type": d.device_type, "is_active": d.is_active} for d in s.devices]
                    stations.append({"id": s.id, "name": s.name, "state": s.state, "devices": devices})
                lines.append({"id": l.id, "name": l.name, "stations": stations})
            plants.append({"id": p.id, "name": p.name, "location": p.location, "lines": lines})
        result.append({"id": org.id, "name": org.name, "plants": plants})
    return result

@router.get("/devices")
def get_devices(db: Session = Depends(get_db)):
    devices = db.query(Device).all()
    return [{
        "id": d.id,
        "name": d.name,
        "station_id": d.station_id,
        "device_type": d.device_type,
        "is_active": d.is_active,
        "last_seen": d.last_seen.isoformat() if d.last_seen else None
    } for d in devices]

@router.get("/users")
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [{
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active
    } for u in users]

@router.get("/audit")
def get_audit_logs(limit: int = 50, db: Session = Depends(get_db)):
    logs = db.query(AuditLog).order_by(AuditLog.ts.desc()).limit(limit).all()
    return [{
        "id": l.id,
        "username": l.username,
        "action": l.action,
        "resource": l.resource,
        "details": l.details,
        "ts": (l.ts.isoformat() + "Z") if l.ts and not l.ts.isoformat().endswith("Z") else (l.ts.isoformat() if l.ts else None)
    } for l in logs]

from typing import Optional
from pydantic import BaseModel
import datetime
from backend.app.models.schema import MLModelRecord
from backend.app.core.decision_engine import get_decision_engine, _station_engines
from backend.app.core.ml_model import get_active_model

class SystemSettingsPayload(BaseModel):
    timezone: Optional[str] = None
    station_id: Optional[str] = None
    station_name: Optional[str] = None
    company_name: Optional[str] = None
    brand_name: Optional[str] = None
    company_logo: Optional[str] = None
    # Live Vibration Rolling Profile
    vibration_limit_g: Optional[float] = None
    vibration_max_scale_g: Optional[float] = None
    rolling_samples_count: Optional[int] = None
    # FFT Frequency Spectrum Range
    fft_max_freq_hz: Optional[float] = None
    fft_exciter_start_hz: Optional[float] = None
    fft_exciter_end_hz: Optional[float] = None
    # Motor Speed & Drive Telemetry Limits
    motor_max_rpm: Optional[float] = None
    motor_rated_rpm: Optional[float] = None
    motor_rated_current_amps: Optional[float] = None
    # Threshold Tuning & Model Training
    warn_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    persistence_windows: Optional[int] = None
    # Motor Auto Stop / Manual Stop & Restart Control
    motor_trip_mode: Optional[str] = None  # "AUTO" or "MANUAL"
    auto_restart_enabled: Optional[bool] = None

@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(SystemSetting).all()
    defaults = {
        "timezone": "UTC",
        "station_id": "station-A",
        "station_name": "Station 4A - Multi-Spindle Angle Nutrunner",
        "company_name": "Apex Dynamics Powertrain",
        "brand_name": "Aperture",
        "company_logo": "/aperture-logo-hd.png",
        "vibration_limit_g": "1.25",
        "vibration_max_scale_g": "2.50",
        "rolling_samples_count": "60",
        "fft_max_freq_hz": "500.0",
        "fft_exciter_start_hz": "150.0",
        "fft_exciter_end_hz": "250.0",
        "motor_max_rpm": "2000.0",
        "motor_rated_rpm": "1500.0",
        "motor_rated_current_amps": "6.5",
        "warn_threshold": "0.45",
        "critical_threshold": "0.70",
        "persistence_windows": "3",
        "motor_trip_mode": "AUTO",
        "auto_restart_enabled": "false"
    }
    settings_dict = {row.key: row.value for row in rows}
    defaults.update(settings_dict)
    return defaults

@router.post("/settings")
@router.put("/settings")
def update_settings(payload: SystemSettingsPayload, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_unset=True)
    for key, val in data.items():
        if val is not None:
            setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
            if not setting:
                setting = SystemSetting(key=key, value=str(val))
                db.add(setting)
            else:
                setting.value = str(val)
                setting.updated_at = datetime.datetime.utcnow()

    # 1. Update DecisionEngine runtime safety parameters across all station engines
    target_station = payload.station_id or "station-A"
    target_engine = get_decision_engine(target_station)
    
    # Update all instantiated engines so policy remains uniform across stations
    for eng in set(list(_station_engines.values()) + [target_engine]):
        if payload.warn_threshold is not None and payload.critical_threshold is not None:
            eng.update_thresholds(
                warn=float(payload.warn_threshold),
                critical=float(payload.critical_threshold),
                persistence=int(payload.persistence_windows or 3)
            )
        if payload.vibration_limit_g is not None and hasattr(eng, "update_vibration_limit"):
            eng.update_vibration_limit(float(payload.vibration_limit_g))
        if payload.motor_max_rpm is not None and hasattr(eng, "update_motor_max_rpm"):
            eng.update_motor_max_rpm(float(payload.motor_max_rpm))
        if payload.motor_rated_rpm is not None and hasattr(eng, "update_motor_rated_rpm"):
            eng.update_motor_rated_rpm(float(payload.motor_rated_rpm))
        if hasattr(eng, "update_motor_mode"):
            eng.update_motor_mode(
                mode=payload.motor_trip_mode,
                auto_restart=payload.auto_restart_enabled
            )
            # Reset if switching to MANUAL while engine stopped to avoid stale STOP state
            if payload.motor_trip_mode is not None and str(payload.motor_trip_mode).strip().upper() == "MANUAL":
                eng.reset(operator="Mode change to MANUAL", notes="Resetting engine state due to manual mode selection")

    # 2. Dynamically reflect configured motor rated RPM into Virtual Motor Simulator
    try:
        from simulator.virtual_rig import simulator_rig
        if payload.motor_rated_rpm is not None:
            simulator_rig.motor.set_rated_rpm(float(payload.motor_rated_rpm))
        elif payload.motor_max_rpm is not None:
            simulator_rig.motor.set_rated_rpm(float(payload.motor_max_rpm))
    except Exception as ex:
        print(f"[Admin Settings] Simulator motor RPM update note: {ex}")

    # 3. Reflect Threshold Tuning to Models (Database MLModelRecord & in-memory active model)
    if payload.warn_threshold is not None or payload.critical_threshold is not None:
        active_models = db.query(MLModelRecord).filter(MLModelRecord.active_flag == True).all()
        for am in active_models:
            cur_thresh = dict(am.thresholds or {})
            if payload.warn_threshold is not None:
                cur_thresh["warn_threshold"] = float(payload.warn_threshold)
            if payload.critical_threshold is not None:
                cur_thresh["critical_threshold"] = float(payload.critical_threshold)
            am.thresholds = cur_thresh

        try:
            active_inst = get_active_model()
            if active_inst and hasattr(active_inst, "thresholds"):
                if payload.warn_threshold is not None:
                    active_inst.thresholds["warn_threshold"] = float(payload.warn_threshold)
                if payload.critical_threshold is not None:
                    active_inst.thresholds["critical_threshold"] = float(payload.critical_threshold)
        except Exception:
            pass

    # 3. Comprehensive Audit Log
    detail_parts = [
        f"timezone={payload.timezone}",
        f"station={payload.station_id}",
        f"company={payload.company_name}",
        f"brand={payload.brand_name}"
    ]
    if payload.vibration_limit_g is not None:
        detail_parts.append(f"vib_limit={payload.vibration_limit_g}g")
    if payload.fft_max_freq_hz is not None:
        detail_parts.append(f"fft_max={payload.fft_max_freq_hz}Hz")
    if payload.motor_max_rpm is not None:
        detail_parts.append(f"motor_rpm={payload.motor_max_rpm}")
    if payload.warn_threshold is not None:
        detail_parts.append(f"warn_thresh={payload.warn_threshold}")
    if payload.critical_threshold is not None:
        detail_parts.append(f"crit_thresh={payload.critical_threshold}")
    if payload.motor_trip_mode is not None:
        detail_parts.append(f"motor_mode={payload.motor_trip_mode}")
    if payload.auto_restart_enabled is not None:
        detail_parts.append(f"auto_restart={payload.auto_restart_enabled}")

    audit = AuditLog(
        username="Admin",
        action="SETTINGS_UPDATE",
        resource="Branding, Telemetry Limits & Model Thresholds",
        details="Updated: " + ", ".join(detail_parts)
    )
    db.add(audit)
    db.commit()

    return get_settings(db=db)

