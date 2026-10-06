from backend.app.core.feature_extractor import extract_features, features_to_vector
from simulator.virtual_rig import simulator_rig
from backend.app.core.ml_model import get_active_model
from backend.app.core.decision_engine import DecisionEngine
import time

model = get_active_model()
engine = DecisionEngine("test-st")

print(f"Warn threshold: {engine.warn_threshold}, Critical threshold: {engine.critical_threshold}")

# Test 1: Normal
simulator_rig.set_scenario("normal")
simulator_rig.motor.current_rpm = 1500.0
w = simulator_rig.generate_window()
feats, _ = extract_features(w, 1000)
vec = features_to_vector(feats)
raw, smoothed = model.predict_score(vec)
print(f"Normal: RMS={feats['rms']:.3f}, raw={raw:.3f}, smoothed={smoothed:.3f}")
st, light, speed, reason, layer = engine.evaluate(feats, smoothed, {"measured_rpm": 1500.0, "commanded_pct": 100.0})
print(f"State: {st}, Light: {light}, Speed: {speed}% | Reason: {reason}")

# Test 2: Harmonic Disturbance (amplitude 0.78) at full speed (1500 RPM)
simulator_rig.set_scenario("disturbance_on", amplitude=0.78, freq=180.0)
simulator_rig.motor.current_rpm = 1500.0
w = simulator_rig.generate_window()
feats, _ = extract_features(w, 1000)
vec = features_to_vector(feats)
raw, smoothed = model.predict_score(vec)
print(f"\nDisturbance at 1500 RPM: RMS={feats['rms']:.3f}, raw={raw:.3f}, smoothed={smoothed:.3f}")
st, light, speed, reason, layer = engine.evaluate(feats, smoothed, {"measured_rpm": 1500.0, "commanded_pct": 100.0})
print(f"State: {st}, Light: {light}, Speed: {speed}% | Reason: {reason}")

# Test 3: If at reduced speed, disturbance remains high (amplitude 0.78)
for i in range(7):
    time.sleep(1.0)
    w = simulator_rig.generate_window()
    feats, _ = extract_features(w, 1000)
    vec = features_to_vector(feats)
    raw, smoothed = model.predict_score(vec)
    st, light, speed, reason, layer = engine.evaluate(feats, smoothed, {"measured_rpm": 750.0, "commanded_pct": 50.0})
    print(f"Sec {i+1}: RMS={feats['rms']:.3f}, smoothed={smoothed:.3f} => State: {st}, Speed: {speed}%, Reason: {reason[:60]}...")
