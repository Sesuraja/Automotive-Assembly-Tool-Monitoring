import os
import json
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.schema import (
    Recording,
    FeatureRecord,
    DecisionRecord,
    AnomalyScoreRecord,
    MotorTelemetry,
    EventRecord,
    RawWindow,
    MLModelRecord,
    User
)
from simulator.virtual_rig import simulator_rig

router = APIRouter(prefix="/recordings", tags=["Recordings"])

# ===========================================================================
# PYDANTIC SCHEMAS FOR RECORDING & DATABASE EDITING
# ===========================================================================

class RecordingUpdateRequest(BaseModel):
    name: Optional[str] = None
    label: Optional[str] = None

class FeatureRecordUpdateRequest(BaseModel):
    rms: Optional[float] = None
    peak: Optional[float] = None
    crest_factor: Optional[float] = None
    kurtosis: Optional[float] = None
    dominant_freq: Optional[float] = None

class FeatureRecordCreateRequest(BaseModel):
    station_id: Optional[str] = "station-A"
    device_id: Optional[str] = "manual-entry"
    rms: float
    peak: float
    crest_factor: Optional[float] = 2.0
    kurtosis: Optional[float] = 2.8
    dominant_freq: Optional[float] = 50.0

class DecisionRecordUpdateRequest(BaseModel):
    state: Optional[str] = None
    reason: Optional[str] = None
    commanded_speed_pct: Optional[float] = None
    indicator_light: Optional[str] = None

class AnomalyScoreUpdateRequest(BaseModel):
    raw_score: Optional[float] = None
    smoothed_score: Optional[float] = None
    state: Optional[str] = None

# ===========================================================================
# 1. RECORDING SESSIONS (DATASETS)
# ===========================================================================

@router.get("")
def list_recordings(db: Session = Depends(get_db)):
    """Returns list of all saved dataset recording sessions."""
    return db.query(Recording).order_by(Recording.created_at.desc()).all()

@router.post("/start")
def start_recording(label: str = "normal", name: str = "Session Recording"):
    """Starts capturing raw high-rate telemetry into active buffer."""
    simulator_rig.start_recording(label=label)
    return {"status": "recording_started", "label": label, "name": name}

@router.post("/stop")
def stop_recording(name: str = "Recorded Session", db: Session = Depends(get_db)):
    """Stops capturing and persists session metadata to DB and JSON file."""
    data = simulator_rig.stop_recording()
    if not data:
        # Create a sample buffer if simulator was idle
        from backend.app.core.feature_extractor import extract_features, features_to_vector
        for _ in range(50):
            w = simulator_rig.generate_window()
            f, _ = extract_features(w, 1000)
            data.append({
                "ts": datetime.utcnow().isoformat(),
                "seq": 100,
                "label": simulator_rig.recording_label,
                "features": f,
                "features_vector": features_to_vector(f).tolist()
            })

    rec_id = f"rec_{uuid.uuid4().hex[:8]}"
    filename = f"{rec_id}_{simulator_rig.recording_label}.json"
    file_path = os.path.join(settings.RECORDINGS_DIR, filename)
    
    with open(file_path, "w") as f:
        json.dump(data, f, indent=2)

    rec = Recording(
        id=rec_id,
        name=name,
        label=simulator_rig.recording_label,
        sample_count=len(data),
        duration_sec=round(len(data) * 0.1, 1),
        file_path=file_path,
        created_at=datetime.utcnow()
    )
    db.add(rec)
    db.commit()

    return {
        "status": "recording_saved",
        "id": rec_id,
        "name": name,
        "label": rec.label,
        "sample_count": rec.sample_count,
        "duration_sec": rec.duration_sec,
        "file_path": file_path
    }

@router.get("/{rec_id}")
def get_recording(rec_id: str, db: Session = Depends(get_db)):
    """Inspects a recording session, including preview samples."""
    rec = db.query(Recording).filter(Recording.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    samples = []
    if os.path.exists(rec.file_path):
        with open(rec.file_path, "r") as f:
            samples = json.load(f)
    return {
        "id": rec.id,
        "name": rec.name,
        "label": rec.label,
        "sample_count": rec.sample_count,
        "duration_sec": rec.duration_sec,
        "created_at": rec.created_at,
        "samples_preview": samples[:25]
    }

@router.put("/{rec_id}")
def update_recording(rec_id: str, payload: RecordingUpdateRequest, db: Session = Depends(get_db)):
    """Edits a recording session's metadata (Name, Label) directly in database."""
    rec = db.query(Recording).filter(Recording.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording session not found")
    
    if payload.name is not None and payload.name.strip():
        rec.name = payload.name.strip()
    if payload.label is not None and payload.label.strip().lower() in ["normal", "disturbed"]:
        rec.label = payload.label.strip().lower()
    
    db.commit()
    db.refresh(rec)
    return {
        "status": "updated",
        "id": rec.id,
        "name": rec.name,
        "label": rec.label,
        "sample_count": rec.sample_count,
        "duration_sec": rec.duration_sec,
        "created_at": rec.created_at
    }

@router.delete("/{rec_id}")
def delete_recording(rec_id: str, db: Session = Depends(get_db)):
    """Deletes a recording session and its persisted telemetry JSON file."""
    rec = db.query(Recording).filter(Recording.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    if os.path.exists(rec.file_path):
        try:
            os.remove(rec.file_path)
        except Exception:
            pass
    db.delete(rec)
    db.commit()
    return {"status": "deleted", "id": rec_id}

# ===========================================================================
# 2. REAL-TIME DATABASE EXPLORER & EDITING ENDPOINTS
# ===========================================================================

@router.get("/database/overview")
def get_database_overview(db: Session = Depends(get_db)):
    """Returns real-time record counts and table statistics across the entire database."""
    recordings_count = db.query(Recording).count()
    features_count = db.query(FeatureRecord).count()
    decisions_count = db.query(DecisionRecord).count()
    anomaly_scores_count = db.query(AnomalyScoreRecord).count()
    motor_telemetry_count = db.query(MotorTelemetry).count()
    events_count = db.query(EventRecord).count()
    models_count = db.query(MLModelRecord).count()
    raw_windows_count = db.query(RawWindow).count()

    latest_feature = db.query(FeatureRecord).order_by(FeatureRecord.id.desc()).first()
    latest_decision = db.query(DecisionRecord).order_by(DecisionRecord.id.desc()).first()

    return {
        "status": "online",
        "timestamp": datetime.utcnow().isoformat(),
        "tables": {
            "recordings": {"count": recordings_count, "description": "Training & Validation Datasets"},
            "features": {"count": features_count, "description": "Extracted Vibration FFT & Time-Domain Features"},
            "decisions": {"count": decisions_count, "description": "Closed-Loop State Transitions & Safety Trips"},
            "anomaly_scores": {"count": anomaly_scores_count, "description": "AI ML Model Inference Scores"},
            "motor_telemetry": {"count": motor_telemetry_count, "description": "Tachometer Speeds & Current Draw"},
            "events": {"count": events_count, "description": "Trip Audits, Operator Resets & Safety Actions"},
            "raw_windows": {"count": raw_windows_count, "description": "Raw Time-Series Accelerometer Buffers"},
            "models": {"count": models_count, "description": "Registered AI ML Models & Checkpoints"},
        },
        "latest_feature_id": latest_feature.id if latest_feature else None,
        "latest_decision_id": latest_decision.id if latest_decision else None,
    }

# --- FEATURES TABLE ---

@router.get("/database/features")
def list_database_features(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Returns paginated, searchable real-time vibration feature records from the database."""
    query = db.query(FeatureRecord)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter((FeatureRecord.station_id.ilike(s)) | (FeatureRecord.device_id.ilike(s)))
    
    total = query.count()
    records = query.order_by(FeatureRecord.id.desc()).offset(offset).limit(limit).all()
    
    items = []
    for r in records:
        items.append({
            "id": r.id,
            "ts": r.ts.isoformat() if r.ts else None,
            "station_id": r.station_id,
            "device_id": r.device_id,
            "rms": r.rms,
            "peak": r.peak,
            "peak_to_peak": r.peak_to_peak,
            "crest_factor": r.crest_factor,
            "kurtosis": r.kurtosis,
            "dominant_freq": r.dominant_freq,
            "spectral_centroid": r.spectral_centroid,
        })
    return {"total": total, "limit": limit, "offset": offset, "data": items}

@router.post("/database/features")
def create_database_feature(payload: FeatureRecordCreateRequest, db: Session = Depends(get_db)):
    """Inserts a new vibration feature record into the database."""
    feat = FeatureRecord(
        station_id=payload.station_id,
        device_id=payload.device_id,
        ts=datetime.utcnow(),
        rms=payload.rms,
        peak=payload.peak,
        peak_to_peak=round(payload.peak * 1.95, 4),
        crest_factor=payload.crest_factor or round(payload.peak / max(0.001, payload.rms), 2),
        kurtosis=payload.kurtosis or 2.8,
        dominant_freq=payload.dominant_freq or 50.0,
        spectral_centroid=round((payload.dominant_freq or 50.0) * 1.05, 1)
    )
    db.add(feat)
    db.commit()
    db.refresh(feat)
    return {"status": "created", "id": feat.id, "rms": feat.rms, "peak": feat.peak}

@router.put("/database/features/{feat_id}")
def update_database_feature(feat_id: int, payload: FeatureRecordUpdateRequest, db: Session = Depends(get_db)):
    """Edits a vibration feature record directly in the database."""
    feat = db.query(FeatureRecord).filter(FeatureRecord.id == feat_id).first()
    if not feat:
        raise HTTPException(status_code=404, detail="Feature record not found")
    
    if payload.rms is not None:
        feat.rms = float(payload.rms)
    if payload.peak is not None:
        feat.peak = float(payload.peak)
        feat.peak_to_peak = round(float(payload.peak) * 1.95, 4)
    if payload.crest_factor is not None:
        feat.crest_factor = float(payload.crest_factor)
    elif payload.rms is not None or payload.peak is not None:
        feat.crest_factor = round(feat.peak / max(0.001, feat.rms), 2)
    if payload.kurtosis is not None:
        feat.kurtosis = float(payload.kurtosis)
    if payload.dominant_freq is not None:
        feat.dominant_freq = float(payload.dominant_freq)
        feat.spectral_centroid = round(float(payload.dominant_freq) * 1.05, 1)

    db.commit()
    db.refresh(feat)
    return {
        "status": "updated",
        "id": feat.id,
        "rms": feat.rms,
        "peak": feat.peak,
        "crest_factor": feat.crest_factor,
        "kurtosis": feat.kurtosis,
        "dominant_freq": feat.dominant_freq,
        "ts": feat.ts.isoformat() if feat.ts else None
    }

@router.delete("/database/features/{feat_id}")
def delete_database_feature(feat_id: int, db: Session = Depends(get_db)):
    """Deletes a vibration feature record from the database."""
    feat = db.query(FeatureRecord).filter(FeatureRecord.id == feat_id).first()
    if not feat:
        raise HTTPException(status_code=404, detail="Feature record not found")
    db.delete(feat)
    db.commit()
    return {"status": "deleted", "id": feat_id}

# --- DECISIONS TABLE ---

@router.get("/database/decisions")
def list_database_decisions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    state_filter: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Returns paginated safety decision records from the database."""
    query = db.query(DecisionRecord)
    if state_filter and state_filter.upper() != "ALL":
        query = query.filter(DecisionRecord.state == state_filter.upper())
    
    total = query.count()
    records = query.order_by(DecisionRecord.id.desc()).offset(offset).limit(limit).all()

    items = []
    for r in records:
        items.append({
            "id": r.id,
            "ts": r.ts.isoformat() if r.ts else None,
            "station_id": r.station_id,
            "device_id": r.device_id,
            "state": r.state,
            "reason": r.reason,
            "layer_caused": r.layer_caused,
            "commanded_speed_pct": r.commanded_speed_pct,
            "indicator_light": r.indicator_light,
        })
    return {"total": total, "limit": limit, "offset": offset, "data": items}

@router.put("/database/decisions/{dec_id}")
def update_database_decision(dec_id: int, payload: DecisionRecordUpdateRequest, db: Session = Depends(get_db)):
    """Edits a decision record directly in the database."""
    dec = db.query(DecisionRecord).filter(DecisionRecord.id == dec_id).first()
    if not dec:
        raise HTTPException(status_code=404, detail="Decision record not found")

    if payload.state is not None:
        dec.state = payload.state.strip().upper()
    if payload.reason is not None:
        dec.reason = payload.reason.strip()
    if payload.commanded_speed_pct is not None:
        dec.commanded_speed_pct = float(payload.commanded_speed_pct)
    if payload.indicator_light is not None:
        dec.indicator_light = payload.indicator_light.strip().upper()

    db.commit()
    db.refresh(dec)
    return {
        "status": "updated",
        "id": dec.id,
        "state": dec.state,
        "reason": dec.reason,
        "commanded_speed_pct": dec.commanded_speed_pct,
        "indicator_light": dec.indicator_light
    }

@router.delete("/database/decisions/{dec_id}")
def delete_database_decision(dec_id: int, db: Session = Depends(get_db)):
    """Deletes a decision record from the database."""
    dec = db.query(DecisionRecord).filter(DecisionRecord.id == dec_id).first()
    if not dec:
        raise HTTPException(status_code=404, detail="Decision record not found")
    db.delete(dec)
    db.commit()
    return {"status": "deleted", "id": dec_id}

# --- ANOMALY SCORES TABLE ---

@router.get("/database/anomaly-scores")
def list_database_anomaly_scores(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """Returns paginated AI anomaly score records from the database."""
    query = db.query(AnomalyScoreRecord)
    total = query.count()
    records = query.order_by(AnomalyScoreRecord.id.desc()).offset(offset).limit(limit).all()

    items = []
    for r in records:
        items.append({
            "id": r.id,
            "ts": r.ts.isoformat() if r.ts else None,
            "station_id": r.station_id,
            "device_id": r.device_id,
            "model_version": r.model_version,
            "raw_score": r.raw_score,
            "smoothed_score": r.smoothed_score,
            "state": r.state,
        })
    return {"total": total, "limit": limit, "offset": offset, "data": items}

@router.put("/database/anomaly-scores/{score_id}")
def update_database_anomaly_score(score_id: int, payload: AnomalyScoreUpdateRequest, db: Session = Depends(get_db)):
    """Edits an anomaly score record directly in the database."""
    sc = db.query(AnomalyScoreRecord).filter(AnomalyScoreRecord.id == score_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="Anomaly score record not found")

    if payload.raw_score is not None:
        sc.raw_score = float(payload.raw_score)
    if payload.smoothed_score is not None:
        sc.smoothed_score = float(payload.smoothed_score)
    if payload.state is not None:
        sc.state = payload.state.strip().upper()

    db.commit()
    db.refresh(sc)
    return {
        "status": "updated",
        "id": sc.id,
        "raw_score": sc.raw_score,
        "smoothed_score": sc.smoothed_score,
        "state": sc.state
    }

@router.delete("/database/anomaly-scores/{score_id}")
def delete_database_anomaly_score(score_id: int, db: Session = Depends(get_db)):
    """Deletes an anomaly score record from the database."""
    sc = db.query(AnomalyScoreRecord).filter(AnomalyScoreRecord.id == score_id).first()
    if not sc:
        raise HTTPException(status_code=404, detail="Anomaly score record not found")
    db.delete(sc)
    db.commit()
    return {"status": "deleted", "id": score_id}
