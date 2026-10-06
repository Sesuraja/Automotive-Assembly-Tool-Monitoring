import joblib
from simulator.virtual_rig import simulator_rig
from backend.app.core.feature_extractor import extract_features, features_to_vector

model = joblib.load('backend/artifacts/models/v1.4.0-tuned.joblib')

def test_condition(name, scenario, amp, rpm):
    simulator_rig.set_scenario(scenario, amplitude=amp, freq=180.0)
    simulator_rig.motor.current_rpm = rpm
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    vec = features_to_vector(f)
    raw, sm = model.predict_score(vec)
    print(f"{name} => RMS={f['rms']:.3f}g | Anomaly Score={raw:.3f}")

test_condition("1. Normal (1500 RPM)", "normal", 0.85, 1500.0)
test_condition("2. Harmonic Disturbance (1500 RPM)", "disturbance_on", 0.78, 1500.0)
test_condition("3. Harmonic Disturbance at Reduced Speed (750 RPM)", "disturbance_on", 0.78, 750.0)
test_condition("4. Severe Chatter (1500 RPM)", "disturbance_on", 1.45, 1500.0)
test_condition("5. Severe Chatter at Reduced Speed (750 RPM)", "disturbance_on", 1.45, 750.0)
