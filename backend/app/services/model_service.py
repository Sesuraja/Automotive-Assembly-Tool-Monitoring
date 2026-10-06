import os
import json
import numpy as np
from datetime import datetime, timezone
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.core.ml_model import AnomalyModelWrapper, set_active_model, get_active_model
from backend.app.core.decision_engine import get_decision_engine
from backend.app.models.schema import MLModelRecord, Recording
from simulator.virtual_rig import simulator_rig
from backend.app.core.feature_extractor import extract_features, features_to_vector

class ModelService:
    @staticmethod
    def train_model(
        version: str,
        model_type: str,
        normal_recording_ids: List[str],
        disturbed_recording_ids: List[str],
        warn_threshold: float = 0.45,
        critical_threshold: float = 0.70,
        contamination: float = 0.05,
        db: Session = None
    ) -> Dict[str, Any]:
        """
        Loads recorded feature datasets and trains Isolation Forest or Random Forest.
        Computes ROC-AUC, Confusion Matrix, and score histogram.
        """
        X_norm_list = []
        X_dist_list = []

        if db:
            norm_recs = db.query(Recording).filter(Recording.id.in_(normal_recording_ids)).all()
            for r in norm_recs:
                if os.path.exists(r.file_path):
                    with open(r.file_path, "r") as f:
                        data = json.load(f)
                        for item in data:
                            if "features_vector" in item:
                                X_norm_list.append(item["features_vector"])

            dist_recs = db.query(Recording).filter(Recording.id.in_(disturbed_recording_ids)).all()
            for r in dist_recs:
                if os.path.exists(r.file_path):
                    with open(r.file_path, "r") as f:
                        data = json.load(f)
                        for item in data:
                            if "features_vector" in item:
                                X_dist_list.append(item["features_vector"])

        # If recordings are empty, generate directly from simulator rig to avoid feature drift
        if len(X_norm_list) < 20:
            sim_state_save = simulator_rig.scenario
            simulator_rig.set_scenario("normal")
            for _ in range(60):
                w = simulator_rig.generate_window()
                f, _ = extract_features(w, 1000)
                X_norm_list.append(features_to_vector(f).tolist())
            simulator_rig.set_scenario(sim_state_save)

        if len(X_dist_list) < 20:
            sim_state_save = simulator_rig.scenario
            simulator_rig.set_scenario("disturbance_on", amplitude=0.85, freq=180.0)
            for _ in range(50):
                w = simulator_rig.generate_window()
                f, _ = extract_features(w, 1000)
                X_dist_list.append(features_to_vector(f).tolist())
            simulator_rig.set_scenario(sim_state_save)

        X_norm = np.array(X_norm_list, dtype=np.float64)
        X_dist = np.array(X_dist_list, dtype=np.float64)

        wrapper = AnomalyModelWrapper(model_version=version, model_type=model_type)
        wrapper.thresholds["warn_threshold"] = warn_threshold
        wrapper.thresholds["critical_threshold"] = critical_threshold

        if model_type == "IsolationForest":
            metrics = wrapper.fit_isolation_forest(X_norm, X_dist, contamination=contamination)
        else:
            metrics = wrapper.fit_random_forest(X_norm, X_dist)

        # Save artifact
        artifact_filename = f"{version}.joblib"
        artifact_path = os.path.join(settings.MODELS_DIR, artifact_filename)
        wrapper.save(artifact_path)

        # Store in DB
        if db:
            db_model = MLModelRecord(
                id=version,
                version=version,
                model_type=model_type,
                metrics=metrics,
                thresholds={"warn_threshold": warn_threshold, "critical_threshold": critical_threshold},
                artifact_path=artifact_path,
                active_flag=False,
                created_at=datetime.now(timezone.utc)
            )
            db.merge(db_model)
            db.commit()

        return {
            "version": version,
            "model_type": model_type,
            "metrics": metrics,
            "thresholds": wrapper.thresholds,
            "artifact_path": artifact_path
        }

    @staticmethod
    def activate_model(version: str, db: Session) -> Dict[str, Any]:
        """
        Activates specified model version, updates decision engine thresholds,
        and sets DB active flags.
        """
        model_rec = db.query(MLModelRecord).filter(MLModelRecord.version == version).first()
        if not model_rec:
            raise ValueError(f"Model version '{version}' not found")

        # Deactivate others
        db.query(MLModelRecord).update({MLModelRecord.active_flag: False})
        model_rec.active_flag = True
        db.commit()

        # Load into memory
        loaded_model = AnomalyModelWrapper.load(model_rec.artifact_path)
        set_active_model(loaded_model)

        # Update decision engine thresholds
        thresh = model_rec.thresholds or {}
        warn = thresh.get("warn_threshold", settings.AI_WARN_THRESHOLD)
        crit = thresh.get("critical_threshold", settings.AI_CRITICAL_THRESHOLD)
        engine = get_decision_engine()
        engine.update_thresholds(warn, crit)

        return {
            "status": "activated",
            "version": version,
            "model_type": model_rec.model_type,
            "thresholds": {"warn_threshold": warn, "critical_threshold": crit}
        }
