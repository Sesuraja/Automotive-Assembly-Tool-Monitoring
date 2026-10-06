import os
import joblib
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
from collections import deque
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import confusion_matrix, roc_auc_score, accuracy_score, precision_score, recall_score
from backend.app.config import settings

class AnomalyModelWrapper:
    """
    Wraps an anomaly detection model (Isolation Forest or Supervised Random Forest)
    with standardization, score calibration to [0..1], and moving-average smoothing.
    """
    def __init__(self, model_version: str, model_type: str = "IsolationForest"):
        self.version = model_version
        self.model_type = model_type
        self.scaler = StandardScaler()
        self.model = None
        self.recent_scores = deque(maxlen=5) # 5-window moving average
        self.thresholds = {
            "warn_threshold": settings.AI_WARN_THRESHOLD,
            "critical_threshold": settings.AI_CRITICAL_THRESHOLD
        }
        self.metrics: Dict[str, Any] = {}
        self.df_norm_mean: float = 0.0
        self.df_dist_mean: float = -0.20

    def fit_isolation_forest(
        self, 
        X_normal: np.ndarray, 
        X_val_disturbed: Optional[np.ndarray] = None,
        contamination: float = 0.05
    ) -> Dict[str, Any]:
        self.model_type = "IsolationForest"
        self.scaler.fit(X_normal)
        X_norm_scaled = self.scaler.transform(X_normal)
        
        self.model = IsolationForest(
            n_estimators=100,
            contamination=contamination,
            random_state=42
        )
        self.model.fit(X_norm_scaled)
        
        normal_scores_raw = self.model.decision_function(X_norm_scaled)
        self.df_norm_mean = float(np.mean(normal_scores_raw))
        std_norm = float(np.std(normal_scores_raw))
        
        if X_val_disturbed is not None and len(X_val_disturbed) > 0:
            X_dist_scaled = self.scaler.transform(X_val_disturbed)
            dist_scores_raw = self.model.decision_function(X_dist_scaled)
            self.df_dist_mean = float(np.mean(dist_scores_raw))
        else:
            self.df_dist_mean = self.df_norm_mean - max(0.1, 3.0 * std_norm)
            
        metrics = {
            "model_type": "IsolationForest",
            "normal_samples": len(X_normal),
            "disturbed_samples": len(X_val_disturbed) if X_val_disturbed is not None else 0,
            "status": "trained"
        }
        
        if X_val_disturbed is not None and len(X_val_disturbed) > 0:
            # Calibrate scores for metrics evaluation
            scores_norm = [self._calibrate_if_score(df) for df in normal_scores_raw]
            scores_dist = [self._calibrate_if_score(df) for df in dist_scores_raw]
            
            y_true = np.array([0] * len(X_normal) + [1] * len(X_val_disturbed))
            scores_all = np.array(scores_norm + scores_dist)
            y_pred = (scores_all >= self.thresholds["warn_threshold"]).astype(int)
            
            cm = confusion_matrix(y_true, y_pred).tolist()
            roc = float(roc_auc_score(y_true, scores_all)) if len(np.unique(y_true)) > 1 else 1.0
            acc = float(accuracy_score(y_true, y_pred))
            prec = float(precision_score(y_true, y_pred, zero_division=0))
            rec = float(recall_score(y_true, y_pred, zero_division=0))
            
            hist_normal, bins = np.histogram(scores_norm, bins=10, range=(0, 1))
            hist_dist, _ = np.histogram(scores_dist, bins=10, range=(0, 1))
            
            metrics.update({
                "confusion_matrix": cm,
                "roc_auc": round(roc, 4),
                "accuracy": round(acc, 4),
                "precision": round(prec, 4),
                "recall": round(rec, 4),
                "histogram": {
                    "bins": [round(float(b), 2) for b in bins],
                    "normal_counts": hist_normal.tolist(),
                    "disturbed_counts": hist_dist.tolist()
                }
            })
            
        self.metrics = metrics
        return metrics

    def _calibrate_if_score(self, raw_df: float) -> float:
        denom = max(1e-4, self.df_norm_mean - self.df_dist_mean)
        norm_dev = (self.df_norm_mean - raw_df) / denom
        # Sigmoid centered at 0.85 dev, ensuring < 0.25 for normal variations, > 0.80 for genuine faults
        score = 1.0 / (1.0 + np.exp(-8.0 * (norm_dev - 0.85)))
        return float(np.clip(score, 0.0, 1.0))

    def fit_random_forest(
        self,
        X_normal: np.ndarray,
        X_disturbed: np.ndarray
    ) -> Dict[str, Any]:
        self.model_type = "RandomForest"
        X = np.vstack([X_normal, X_disturbed])
        y = np.array([0] * len(X_normal) + [1] * len(X_disturbed))
        
        self.scaler.fit(X)
        X_scaled = self.scaler.transform(X)
        
        self.model = RandomForestClassifier(n_estimators=100, random_state=42, max_depth=8)
        self.model.fit(X_scaled, y)
        
        probs = self.model.predict_proba(X_scaled)[:, 1]
        preds = (probs >= self.thresholds["warn_threshold"]).astype(int)
        
        cm = confusion_matrix(y, preds).tolist()
        roc = float(roc_auc_score(y, probs))
        acc = float(accuracy_score(y, preds))
        prec = float(precision_score(y, preds, zero_division=0))
        rec = float(recall_score(y, preds, zero_division=0))
        
        hist_normal, bins = np.histogram(probs[:len(X_normal)], bins=10, range=(0, 1))
        hist_dist, _ = np.histogram(probs[len(X_normal):], bins=10, range=(0, 1))
        
        self.metrics = {
            "model_type": "RandomForest",
            "normal_samples": len(X_normal),
            "disturbed_samples": len(X_disturbed),
            "confusion_matrix": cm,
            "roc_auc": round(roc, 4),
            "accuracy": round(acc, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "histogram": {
                "bins": [round(float(b), 2) for b in bins],
                "normal_counts": hist_normal.tolist(),
                "disturbed_counts": hist_dist.tolist()
            }
        }
        return self.metrics

    def _fit_default_baseline(self):
        """Emergency automatic fitting to ensure model is calibrated for 12,000 RPM nutrunner and bench rigs."""
        np.random.seed(42)
        n_norm = 150
        X_norm = np.zeros((n_norm, 12))
        # 12,000 RPM industrial nutrunner baseline (200 Hz fundamental)
        X_norm[:100, 0] = np.random.uniform(0.22, 0.35, 100) # RMS
        X_norm[:100, 1] = X_norm[:100, 0] * np.random.uniform(1.8, 2.3, 100) # Peak
        X_norm[:100, 2] = X_norm[:100, 1] * 1.95 # Peak to peak
        X_norm[:100, 3] = X_norm[:100, 1] / np.maximum(X_norm[:100, 0], 1e-4) # Crest
        X_norm[:100, 4] = np.random.normal(2.1, 0.3, 100) # Kurtosis
        X_norm[:100, 5] = np.random.normal(0.05, 0.05, 100) # Skewness
        X_norm[:100, 6] = np.random.uniform(195, 205, 100) # Dominant freq 200 Hz
        X_norm[:100, 7] = X_norm[:100, 6] * 1.05 # Centroid
        X_norm[:100, 8] = X_norm[:100, 0] * 0.10 # band 0-50
        X_norm[:100, 9] = X_norm[:100, 0] * 0.15 # band 50-150
        X_norm[:100, 10] = X_norm[:100, 0] * 0.55 # band 150-300
        X_norm[:100, 11] = X_norm[:100, 0] * 0.20 # band 300-500

        # 1,500 RPM bench baseline
        X_norm[100:, 0] = np.random.uniform(0.06, 0.16, 50)
        X_norm[100:, 1] = X_norm[100:, 0] * np.random.uniform(1.5, 2.1, 50)
        X_norm[100:, 2] = X_norm[100:, 1] * 1.9
        X_norm[100:, 3] = X_norm[100:, 1] / np.maximum(X_norm[100:, 0], 1e-4)
        X_norm[100:, 4] = np.random.normal(2.5, 0.3, 50)
        X_norm[100:, 5] = np.random.normal(0.02, 0.03, 50)
        X_norm[100:, 6] = np.random.uniform(23, 27, 50)
        X_norm[100:, 7] = X_norm[100:, 6] * 1.1
        X_norm[100:, 8] = X_norm[100:, 0] * 0.25
        X_norm[100:, 9] = X_norm[100:, 0] * 0.45
        X_norm[100:, 10] = X_norm[100:, 0] * 0.20
        X_norm[100:, 11] = X_norm[100:, 0] * 0.10

        # Severe anomalies
        n_dist = 60
        X_dist = np.zeros((n_dist, 12))
        X_dist[:, 0] = np.random.uniform(0.85, 2.0, n_dist)
        X_dist[:, 1] = X_dist[:, 0] * np.random.uniform(2.6, 4.2, n_dist)
        X_dist[:, 2] = X_dist[:, 1] * 2.1
        X_dist[:, 3] = X_dist[:, 1] / np.maximum(X_dist[:, 0], 1e-4)
        X_dist[:, 4] = np.random.normal(6.5, 1.5, n_dist)
        X_dist[:, 5] = np.random.normal(1.2, 0.3, n_dist)
        X_dist[:, 6] = np.random.uniform(170, 190, n_dist)
        X_dist[:, 7] = X_dist[:, 6] * 1.2
        X_dist[:, 8] = X_dist[:, 0] * 0.10
        X_dist[:, 9] = X_dist[:, 0] * 0.15
        X_dist[:, 10] = X_dist[:, 0] * 0.65
        X_dist[:, 11] = X_dist[:, 0] * 0.10

        if self.model_type == "IsolationForest":
            self.fit_isolation_forest(X_norm, X_dist)
        else:
            self.fit_random_forest(X_norm, X_dist)

    def predict_score(
        self,
        feature_vector: np.ndarray,
        operating_rpm: Optional[float] = None,
        rated_rpm: Optional[float] = None
    ) -> Tuple[float, float]:
        vec = np.nan_to_num(np.asarray(feature_vector, dtype=np.float64), nan=0.0, posinf=1.0, neginf=-1.0)
        if self.model is None:
            self._fit_default_baseline()

        # Dynamic Speed-Aware Normalization:
        # Machine vibration energy scales with spindle rotational frequency (ISO 10816/20816)
        # e.g., 1500 RPM angle tool vs 3200 RPM nutrunner vs 6000 RPM spindle vs 20000 RPM router
        target_rpm = float(rated_rpm or operating_rpm or 1500.0)
        effective_rpm = max(500.0, target_rpm)
        speed_factor = float(np.sqrt(effective_rpm / 1500.0))

        # Speed-normalize raw vibration features so high-RPM centrifugal baseline is not misclassified as a defect
        vec_normalized = vec.copy()
        if len(vec_normalized) >= 4:
            vec_normalized[0] /= speed_factor  # RMS
            vec_normalized[1] /= speed_factor  # Peak
            vec_normalized[2] /= speed_factor  # Peak-to-Peak

        x_scaled = self.scaler.transform(vec_normalized.reshape(1, -1))
        if self.model_type == "IsolationForest":
            raw_df = self.model.decision_function(x_scaled)[0]
            raw_score = self._calibrate_if_score(raw_df)
        else:  # RandomForest
            if hasattr(self.model, "predict_proba"):
                raw_score = float(self.model.predict_proba(x_scaled)[0, 1])
            else:
                raw_score = float(self.model.predict(x_scaled)[0])

        # Dynamic Physical consistency check:
        # A 1500 RPM tool is nominal at <= 0.20g RMS.
        # A 20000 RPM tool is nominal at <= 0.75g RMS due to centrifugal rotor dynamics.
        rms_val = float(vec[0]) if len(vec) > 0 else 0.0
        peak_val = float(vec[1]) if len(vec) > 1 else 0.0
        nominal_rms_limit = 0.22 * speed_factor
        nominal_peak_limit = nominal_rms_limit * 2.3

        if rms_val <= nominal_rms_limit and peak_val <= nominal_peak_limit:
            nominal_cap = max(0.02, min(0.20, (rms_val / max(1e-4, nominal_rms_limit)) * 0.20))
            raw_score = min(raw_score, nominal_cap)

        raw_score = float(np.clip(raw_score, 0.0, 1.0))
        self.recent_scores.append(raw_score)
        smoothed_score = float(np.mean(self.recent_scores))

        return round(raw_score, 4), round(smoothed_score, 4)

    def save(self, filepath: str):
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        joblib.dump(self, filepath)

    @classmethod
    def load(cls, filepath: str) -> "AnomalyModelWrapper":
        return joblib.load(filepath)

_active_model: Optional[AnomalyModelWrapper] = None

def get_active_model() -> AnomalyModelWrapper:
    global _active_model
    if _active_model is not None and getattr(_active_model, "model", None) is not None:
        return _active_model

    # 1. Check SQLite database for the active production model record
    try:
        from backend.app.database import SessionLocal
        from backend.app.models.schema import MLModelRecord
        db = SessionLocal()
        try:
            active_rec = db.query(MLModelRecord).filter(MLModelRecord.active_flag == True).first()
            if active_rec and active_rec.artifact_path and os.path.exists(active_rec.artifact_path):
                _active_model = AnomalyModelWrapper.load(active_rec.artifact_path)
                return _active_model
            # If no active model marked True, find latest model in DB
            latest_rec = db.query(MLModelRecord).order_by(MLModelRecord.created_at.desc()).first()
            if latest_rec and latest_rec.artifact_path and os.path.exists(latest_rec.artifact_path):
                latest_rec.active_flag = True
                db.commit()
                _active_model = AnomalyModelWrapper.load(latest_rec.artifact_path)
                return _active_model
        finally:
            db.close()
    except Exception as e:
        print(f"[ModelLoad Notice] {e}")

    # 2. Check filesystem for existing trained models
    if os.path.exists(settings.MODELS_DIR):
        for candidate in ["Latest.joblib", "v1.4.0-tuned.joblib", "v1.3.0-tuned.joblib", "v1.0.0-baseline.joblib"]:
            cand_path = os.path.join(settings.MODELS_DIR, candidate)
            if os.path.exists(cand_path):
                try:
                    loaded = AnomalyModelWrapper.load(cand_path)
                    if getattr(loaded, "model", None) is not None:
                        _active_model = loaded
                        return _active_model
                except Exception:
                    pass
        for fname in os.listdir(settings.MODELS_DIR):
            if fname.endswith(".joblib"):
                try:
                    loaded = AnomalyModelWrapper.load(os.path.join(settings.MODELS_DIR, fname))
                    if getattr(loaded, "model", None) is not None:
                        _active_model = loaded
                        return _active_model
                except Exception:
                    pass

    # 3. Create, fit, and persist fallback Isolation Forest model
    fallback = AnomalyModelWrapper("v1.0.0-baseline", "IsolationForest")
    fallback._fit_default_baseline()
    fallback_path = os.path.join(settings.MODELS_DIR, "v1.0.0-baseline.joblib")
    fallback.save(fallback_path)
    _active_model = fallback
    return _active_model

def set_active_model(model: AnomalyModelWrapper):
    global _active_model
    _active_model = model
