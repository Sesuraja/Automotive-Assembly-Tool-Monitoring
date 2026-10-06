import joblib
from backend.app.core.feature_extractor import extract_features, features_to_vector
from simulator.virtual_rig import simulator_rig

model = joblib.load(r'C:\Users\SESU\Downloads\Automotive Assembly Tool Monitoring_Lat\backend\artifacts\models\v1.4.0-tuned.joblib')

print("Model scaler mean:", getattr(model.scaler, "mean_", None))
print("Recent scores before reset:", model.recent_scores)
model.recent_scores.clear()

simulator_rig.set_scenario('normal')
simulator_rig.motor.current_rpm = 1500.0
for i in range(5):
    w = simulator_rig.generate_window()
    feats, _ = extract_features(w, 1000)
    vec = features_to_vector(feats)
    raw, smoothed = model.predict_score(vec)
    print(f"Normal {i}: raw={raw:.3f}, smoothed={smoothed:.3f}, rms={feats['rms']:.3f}")

simulator_rig.set_scenario('disturbance_on', amplitude=0.78, freq=180.0)
for i in range(5):
    w = simulator_rig.generate_window()
    feats, _ = extract_features(w, 1000)
    vec = features_to_vector(feats)
    raw, smoothed = model.predict_score(vec)
    print(f"Disturb 1500 RPM {i}: raw={raw:.3f}, smoothed={smoothed:.3f}, rms={feats['rms']:.3f}")
