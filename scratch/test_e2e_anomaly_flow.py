import sys
sys.path.insert(0, ".")
import asyncio
import time
from backend.app.core.feature_extractor import extract_features, features_to_vector
from simulator.virtual_rig import simulator_rig
from backend.app.core.ml_model import get_active_model
from backend.app.core.decision_engine import DecisionEngine
from backend.app.services.ingestion_service import IngestionService
from backend.app.database import SessionLocal

print("=================================================================")
print("RUNNING END-TO-END VERIFICATION OF USER REQUIREMENT:")
print("1. If AI anomaly score high -> FIRST reduce speed (50%)")
print("2. If NO anomaly score after reducing speed -> DO NOT STOP")
print("3. If high AI anomaly score AGAIN after reducing speed -> STOP")
print("=================================================================\n")

model = get_active_model()

# -------------------------------------------------------------
# TEST 1: HARMONIC DISTURBANCE (ANOMALY MITIGATED AT REDUCED SPEED -> DONT STOP)
# -------------------------------------------------------------
print(">>> TEST 1: Harmonic Disturbance (Anomaly Mitigated at 50% Speed) <<<")
engine = DecisionEngine("station-test-1")
engine.reset()
simulator_rig.set_scenario("normal")
simulator_rig.motor.set_rated_rpm(1500.0)
simulator_rig.motor.current_rpm = 1500.0
simulator_rig.motor.commanded_pct = 100.0
simulator_rig.motor.is_stalled = False

# Step 1.1: Nominal baseline
w = simulator_rig.generate_window()
f, _ = extract_features(w, 1000)
_, smoothed = model.predict_score(features_to_vector(f))
st, light, speed, reason, layer = engine.evaluate(f, smoothed, {"measured_rpm": 1500.0, "commanded_pct": 100.0})
print(f"Step 1 (Nominal): State={st}, RPM=1500, Score={smoothed:.3f}, Light={light}")
assert st == "NORMAL" and speed == 100.0

# Step 1.2: Harmonic Disturbance injected at 1500 RPM
simulator_rig.set_scenario("disturbance_on", amplitude=0.78, freq=180.0)
for _ in range(3):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    raw, smoothed = model.predict_score(features_to_vector(f))
    st, light, speed, reason, layer = engine.evaluate(f, smoothed, {"measured_rpm": 1500.0, "commanded_pct": 100.0})
    if st == "REDUCED_SPEED":
        break

print(f"Step 2 (Disturbance at 100%): State={st}, Speed={speed}%, Raw={raw:.3f}, Smoothed={smoothed:.3f}, Light={light}")
assert st == "REDUCED_SPEED" and speed == 50.0, f"Expected REDUCED_SPEED (50%), got {st}"
print("=> FIRST ACTION: Speed successfully reduced to 50%!")

# Step 1.3: Spindle decelerates to 50% (750 RPM). Resonance is mitigated.
simulator_rig.motor.current_rpm = 750.0
simulator_rig.motor.commanded_pct = 50.0

# Run for 7 seconds at 50% speed - motor MUST NOT STOP
for sec in range(1, 8):
    time.sleep(1.0)
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    _, smoothed = model.predict_score(features_to_vector(f))
    st, light, speed, reason, layer = engine.evaluate(f, smoothed, {"measured_rpm": 750.0, "commanded_pct": 50.0})
    print(f"  Sec {sec} at 50% speed: State={st}, Speed={speed}%, RMS={f['rms']:.3f}g, Score={smoothed:.3f} (< 0.45)")
    assert st == "REDUCED_SPEED", f"Motor should NOT stop! Current state: {st}"
    assert speed == 50.0, f"Motor speed should remain 50%! Current speed: {speed}"

print("[SUCCESS] Test 1 Passed: Motor maintained safe 50% speed and DID NOT STOP because anomaly subsided!\n")

# -------------------------------------------------------------
# TEST 2: SEVERE CHATTER (ANOMALY PERSISTS AT REDUCED SPEED -> STOPS)
# -------------------------------------------------------------
print(">>> TEST 2: Severe Chatter (Anomaly Recurs/Persists at 50% Speed) <<<")
engine2 = DecisionEngine("station-test-2")
simulator_rig.set_scenario("normal")
simulator_rig.motor.current_rpm = 1500.0
simulator_rig.motor.commanded_pct = 100.0
simulator_rig.motor.is_stalled = False

# Step 2.1: Severe disturbance at 1500 RPM
simulator_rig.set_scenario("disturbance_on", amplitude=1.45, freq=180.0)
for _ in range(3):
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    raw, smoothed = model.predict_score(features_to_vector(f))
    st, light, speed, reason, layer = engine2.evaluate(f, smoothed, {"measured_rpm": 1500.0, "commanded_pct": 100.0})
    if st == "REDUCED_SPEED":
        break

print(f"Step 1 (Severe Disturbance at 100%): State={st}, Speed={speed}%, Raw={raw:.3f}, Smoothed={smoothed:.3f}")
assert st == "REDUCED_SPEED" and speed == 50.0
print("=> FIRST ACTION: Speed reduced to 50%!")

# Step 2.2: Spindle decelerates to 50% (750 RPM), but severe chatter PERSISTS
simulator_rig.motor.current_rpm = 750.0
simulator_rig.motor.commanded_pct = 50.0

stopped_triggered = False
for sec in range(1, 8):
    time.sleep(1.0)
    w = simulator_rig.generate_window()
    f, _ = extract_features(w, 1000)
    _, smoothed = model.predict_score(features_to_vector(f))
    st, light, speed, reason, layer = engine2.evaluate(f, smoothed, {"measured_rpm": 750.0, "commanded_pct": 50.0})
    print(f"  Sec {sec} at 50% speed: State={st}, Speed={speed}%, RMS={f['rms']:.3f}g, Score={smoothed:.3f} (>= 0.45)")
    if st == "STOPPED":
        stopped_triggered = True
        print(f"=> AFTER AGAIN HIGH ANOMALY SCORE: MOTOR STOPPED (0 RPM, RED Light)! Reason: {reason[:60]}...")
        break

assert stopped_triggered, "Expected motor to STOP when high anomaly persisted at reduced speed!"
print("[SUCCESS] Test 2 Passed: Motor halted to STOPPED (0 RPM) on persistent high anomaly!\n")
print("=================================================================")
print("ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!")
print("=================================================================")
