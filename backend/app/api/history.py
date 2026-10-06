import csv
import io
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models.schema import FeatureRecord, AnomalyScoreRecord, DecisionRecord, EventRecord

router = APIRouter(prefix="/history", tags=["History & Telemetry Archive"])

def _to_iso_z(dt):
    if not dt:
        return None
    iso = dt.isoformat()
    return iso if iso.endswith("Z") else (iso + "Z")

@router.get("/features")
def get_historical_features(limit: int = 100, db: Session = Depends(get_db)):
    records = db.query(FeatureRecord).order_by(FeatureRecord.ts.desc()).limit(limit).all()
    return [{
        "id": r.id,
        "device_id": r.device_id,
        "ts": _to_iso_z(r.ts),
        "rms": r.rms,
        "peak": r.peak,
        "crest_factor": r.crest_factor,
        "kurtosis": r.kurtosis,
        "dominant_freq": r.dominant_freq,
        "band_energies": r.band_energies
    } for r in reversed(records)]

@router.get("/scores")
def get_historical_scores(limit: int = 100, db: Session = Depends(get_db)):
    records = db.query(AnomalyScoreRecord).order_by(AnomalyScoreRecord.ts.desc()).limit(limit).all()
    return [{
        "id": r.id,
        "ts": _to_iso_z(r.ts),
        "raw_score": r.raw_score,
        "smoothed_score": r.smoothed_score,
        "state": r.state
    } for r in reversed(records)]

@router.get("/decisions")
def get_historical_decisions(limit: int = 100, db: Session = Depends(get_db)):
    records = db.query(DecisionRecord).order_by(DecisionRecord.ts.desc()).limit(limit).all()
    return [{
        "id": r.id,
        "ts": _to_iso_z(r.ts),
        "state": r.state,
        "reason": r.reason,
        "layer_caused": r.layer_caused,
        "commanded_speed_pct": r.commanded_speed_pct,
        "indicator_light": r.indicator_light
    } for r in reversed(records)]

@router.get("/events")
def get_historical_events(limit: int = 50, db: Session = Depends(get_db)):
    records = db.query(EventRecord).order_by(EventRecord.ts.desc()).limit(limit).all()
    return [{
        "id": r.id,
        "ts": _to_iso_z(r.ts),
        "event_type": r.event_type,
        "details": r.details,
        "operator": r.operator,
        "notes": r.notes
    } for r in records]

@router.get("/export")
def export_csv_history(limit: int = 500, db: Session = Depends(get_db)):
    records = db.query(FeatureRecord).order_by(FeatureRecord.ts.desc()).limit(limit).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "device_id", "station_id", "timestamp", "rms_g", "peak_g", "crest_factor", "kurtosis", "dominant_freq_hz"])
    for r in reversed(records):
        writer.writerow([r.id, r.device_id, r.station_id, r.ts.isoformat(), r.rms, r.peak, r.crest_factor, r.kurtosis, r.dominant_freq])
        
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=vibration_features_export.csv"}
    )
