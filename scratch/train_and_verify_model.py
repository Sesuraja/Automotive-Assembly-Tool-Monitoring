import os
import json
import joblib
import numpy as np
from datetime import datetime, timezone
from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.models.schema import MLModelRecord, SystemSetting
from backend.app.core.feature_extractor import extract_features, features_to_vector
from simulator.virtual_rig import simulator_rig
from backend.app.core.ml_model import AnomalyModelWrapper, set_active_model

# 1. Update virtual rig disturbance physics to accurately model resonance mitigation
# In virtual_rig.py:
# When exciter_amplitude < 1.20 (harmonic resonance), reducing spindle speed (speed_factor <= 0.6)
# mitigates the resonance so amp drops to baseline (~0.04g).
# When exciter_amplitude >= 1.20 (severe chatter / physical breakage), it persists even at reduced speed.

print("--- Generating synthetic dataset covering all operational modes ---")
# Mode A: Nominal operation at 100% speed (1500 RPM)
X_norm_list = []
simulator_rig.set_scenario("normal")
simulator_rig.motor.current_rpm = 1500.0
for _ in range(80):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    X_norm_list.append(features_to_vector(f).tolist())

# Mode B: Nominal / Mitigated operation at 50% speed (750 RPM)
simulator_rig.motor.current_rpm = 750.0
for _ in range(80):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    X_norm_list.append(features_to_vector(f).tolist())

# Mode C: High Disturbance at 100% speed (1500 RPM, 0.78g and 1.45g)
X_dist_list = []
simulator_rig.set_scenario("disturbance_on", amplitude=0.78, freq=180.0)
simulator_rig.motor.current_rpm = 1500.0
for _ in range(60):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    X_dist_list.append(features_to_vector(f).tolist())

simulator_rig.set_scenario("disturbance_on", amplitude=1.45, freq=180.0)
simulator_rig.motor.current_rpm = 1500.0
for _ in range(50):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    X_dist_list.append(features_to_vector(f).tolist())

# Mode D: Severe disturbance persisting at 50% speed (750 RPM, 1.45g)
simulator_rig.motor.current_rpm = 750.0
for _ in range(50):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    X_dist_list.append(features_to_vector(f).tolist())

X_norm = np.array(X_norm_list, dtype=np.float64)
X_dist = np.array(X_dist_list, dtype=np.float64)
print(f"Normal samples (1500 RPM + 750 RPM): {len(X_norm)}, Disturbed samples: {len(X_dist)}")

version = "v1.4.0-tuned"
wrapper = AnomalyModelWrapper(model_version=version, model_type="IsolationForest")
wrapper.thresholds["warn_threshold"] = 0.45
wrapper.thresholds["critical_threshold"] = 0.70
metrics = wrapper.fit_isolation_forest(X_norm, X_dist, contamination=0.03)

# Save artifact
artifact_path = os.path.join(settings.MODELS_DIR, f"{version}.joblib")
wrapper.save(artifact_path)
print(f"Saved {version} to {artifact_path}")

# Update DB
db = SessionLocal()
try:
    rec = db.query(MLModelRecord).filter(MLModelRecord.version == version).first()
    if rec:
        rec.metrics = metrics
        rec.thresholds = {"warn_threshold": 0.45, "critical_threshold": 0.70}
        rec.artifact_path = artifact_path
        rec.active_flag = True
    else:
        rec = MLModelRecord(
            id=version,
            version=version,
            model_type="IsolationForest",
            metrics=metrics,
            thresholds={"warn_threshold": 0.45, "critical_threshold": 0.70},
            artifact_path=artifact_path,
            active_flag=True,
            created_at=datetime.now(timezone.utc)
        )
        db.add(rec)
    
    # Ensure other models are inactive
    for other in db.query(MLModelRecord).filter(MLModelRecord.version != version).all():
        other.active_flag = False
    db.commit()
    print("Database MLModelRecord updated successfully.")
finally:
    db.close()
