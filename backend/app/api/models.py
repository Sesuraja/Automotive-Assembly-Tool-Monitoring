from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from backend.app.database import get_db
from backend.app.models.schema import MLModelRecord
from backend.app.schemas.pydantic_models import TrainModelRequest, ModelResponse
from backend.app.services.model_service import ModelService
from backend.app.core.security import require_role
from backend.app.core.ml_model import get_active_model

router = APIRouter(prefix="/models", tags=["Machine Learning Models"])

@router.get("", response_model=List[ModelResponse])
def list_models(db: Session = Depends(get_db)):
    models = db.query(MLModelRecord).order_by(MLModelRecord.created_at.desc()).all()
    return models

@router.get("/active")
def get_active_model_info():
    active = get_active_model()
    return {
        "version": active.version,
        "model_type": active.model_type,
        "thresholds": active.thresholds,
        "metrics": active.metrics
    }

@router.post("/train")
def train_new_model(
    req: TrainModelRequest,
    current_user: dict = Depends(require_role(["Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    try:
        result = ModelService.train_model(
            version=req.model_version,
            model_type=req.model_type,
            normal_recording_ids=req.normal_recording_ids,
            disturbed_recording_ids=req.disturbed_recording_ids,
            warn_threshold=req.warn_threshold or 0.45,
            critical_threshold=req.critical_threshold or 0.70,
            contamination=req.contamination or 0.05,
            db=db
        )
        return {"status": "trained", "model": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

from fastapi.responses import FileResponse
import os
import time
from typing import Optional
from backend.app.core.feature_extractor import extract_features, features_to_vector
from simulator.virtual_rig import simulator_rig

@router.post("/{version}/activate")
def activate_model_version(
    version: str,
    current_user: dict = Depends(require_role(["Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    try:
        result = ModelService.activate_model(version, db=db)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class EditModelRequest(BaseModel):
    version: Optional[str] = None
    warn_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    model_type: Optional[str] = None

@router.put("/{version}")
def edit_model(
    version: str,
    req: EditModelRequest,
    current_user: dict = Depends(require_role(["Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    from backend.app.core.decision_engine import get_decision_engine
    model_rec = db.query(MLModelRecord).filter(MLModelRecord.version == version).first()
    if not model_rec:
        raise HTTPException(status_code=404, detail=f"Model version '{version}' not found")

    if req.version and req.version != version:
        existing = db.query(MLModelRecord).filter(MLModelRecord.version == req.version).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Model version '{req.version}' already exists")
        model_rec.version = req.version

    current_thresh = dict(model_rec.thresholds or {})
    if req.warn_threshold is not None:
        current_thresh["warn_threshold"] = req.warn_threshold
    if req.critical_threshold is not None:
        current_thresh["critical_threshold"] = req.critical_threshold
    model_rec.thresholds = current_thresh

    if model_rec.active_flag:
        from backend.app.models.schema import SystemSetting
        from backend.app.core.decision_engine import _station_engines, get_decision_engine

        w_val = current_thresh.get("warn_threshold", 0.45)
        c_val = current_thresh.get("critical_threshold", 0.70)

        for eng in set(list(_station_engines.values()) + [get_decision_engine("station-A")]):
            eng.update_thresholds(w_val, c_val)

        # Persist to SystemSetting
        w_set = db.query(SystemSetting).filter(SystemSetting.key == "warn_threshold").first()
        if w_set:
            w_set.value = str(w_val)
        else:
            db.add(SystemSetting(key="warn_threshold", value=str(w_val)))

        c_set = db.query(SystemSetting).filter(SystemSetting.key == "critical_threshold").first()
        if c_set:
            c_set.value = str(c_val)
        else:
            db.add(SystemSetting(key="critical_threshold", value=str(c_val)))

    db.commit()
    db.refresh(model_rec)
    return {
        "status": "updated",
        "id": model_rec.id,
        "version": model_rec.version,
        "model_type": model_rec.model_type,
        "thresholds": model_rec.thresholds,
        "active_flag": model_rec.active_flag
    }

@router.delete("/{version}")
def delete_model(
    version: str,
    current_user: dict = Depends(require_role(["Engineer", "Admin"])),
    db: Session = Depends(get_db)
):
    model_rec = db.query(MLModelRecord).filter(MLModelRecord.version == version).first()
    if not model_rec:
        raise HTTPException(status_code=404, detail=f"Model version '{version}' not found")

    if model_rec.active_flag:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete currently active production model. Please activate another model version before deleting."
        )

    if model_rec.artifact_path and os.path.exists(model_rec.artifact_path):
        try:
            os.remove(model_rec.artifact_path)
        except Exception:
            pass

    db.delete(model_rec)
    db.commit()
    return {"status": "deleted", "version": version}

@router.get("/{version}/download")
def download_model_artifact(
    version: str,
    db: Session = Depends(get_db)
):
    model_rec = db.query(MLModelRecord).filter(MLModelRecord.version == version).first()
    if not model_rec or not model_rec.artifact_path or not os.path.exists(model_rec.artifact_path):
        raise HTTPException(status_code=404, detail=f"Model artifact for '{version}' not found on disk")
    return FileResponse(
        path=model_rec.artifact_path,
        filename=f"{version}.joblib",
        media_type="application/octet-stream"
    )

@router.post("/test-inference")
def test_model_inference(
    version: Optional[str] = None,
    db: Session = Depends(get_db)
):
    start_t = time.perf_counter()
    from backend.app.api.vendor_motor_api import get_live_vibration
    live_vib = get_live_vibration()
    
    rms_val = float(live_vib.get("rms_g") or live_vib.get("rms") or 0.48)
    peak_val = float(live_vib.get("peak_g") or live_vib.get("peak") or (rms_val * 1.414))
    crest_val = float(live_vib.get("crest_factor") or (peak_val / max(rms_val, 0.001)))
    kurt_val = float(live_vib.get("kurtosis") or 3.02)
    rpm_val = float(live_vib.get("measured_rpm") or 1500.0)
    dom_freq = round((rpm_val / 60.0) * 13.33, 1) if rpm_val > 15.0 else 0.0

    feat_dict = {
        "rms": round(rms_val, 4),
        "peak": round(peak_val, 4),
        "peak_to_peak": round(peak_val * 1.5, 4),
        "crest_factor": round(crest_val, 4),
        "kurtosis": round(kurt_val, 4),
        "skewness": 0.02,
        "dominant_freq": dom_freq,
        "spectral_centroid": round(dom_freq * 1.05, 1),
        "band_energies": {
            "0_50Hz": round(rms_val * 0.15, 4),
            "50_150Hz": round(rms_val * 0.25, 4),
            "150_300Hz": round(rms_val * 0.10, 4),
            "300_500Hz": round(rms_val * 0.50, 4),
        }
    }
    feat_vector = features_to_vector(feat_dict)

    if version:
        model_rec = db.query(MLModelRecord).filter(MLModelRecord.version == version).first()
        if model_rec and model_rec.artifact_path and os.path.exists(model_rec.artifact_path):
            from backend.app.core.ml_model import AnomalyModelWrapper
            eval_model = AnomalyModelWrapper.load(model_rec.artifact_path)
        else:
            eval_model = get_active_model()
    else:
        eval_model = get_active_model()

    raw_score, smoothed_score = eval_model.predict_score(feat_vector)
    elapsed_ms = round((time.perf_counter() - start_t) * 1000.0, 2)

    warn = eval_model.thresholds.get("warn_threshold", 0.45)
    crit = eval_model.thresholds.get("critical_threshold", 0.70)
    if smoothed_score >= crit:
        classification = "CRITICAL_ANOMALY"
        recommended_action = "EMERGENCY_STOP"
    elif smoothed_score >= warn:
        classification = "ELEVATED_VIBRATION"
        recommended_action = "REDUCE_SPEED_50_PCT"
    else:
        classification = "NOMINAL_HEALTHY"
        recommended_action = "CONTINUE_100_PCT"

    return {
        "status": "success",
        "model_version": eval_model.version,
        "model_type": eval_model.model_type,
        "raw_score": round(float(raw_score), 4),
        "smoothed_score": round(float(smoothed_score), 4),
        "classification": classification,
        "recommended_action": recommended_action,
        "warn_threshold": warn,
        "critical_threshold": crit,
        "latency_ms": elapsed_ms,
        "features": {
            "rms": round(float(feat_dict.get("rms", 0.0)), 4),
            "peak": round(float(feat_dict.get("peak", 0.0)), 4),
            "crest_factor": round(float(feat_dict.get("crest_factor", 0.0)), 2),
            "kurtosis": round(float(feat_dict.get("kurtosis", 0.0)), 2),
            "dominant_freq": round(float(feat_dict.get("dominant_freq", 0.0)), 1),
        }
    }
