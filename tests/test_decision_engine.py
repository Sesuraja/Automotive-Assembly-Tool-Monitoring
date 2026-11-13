import pytest
from datetime import datetime, timezone, timedelta
from backend.app.core.decision_engine import DecisionEngine

def test_decision_engine_initial_state():
    engine = DecisionEngine("station-test-init")
    assert engine.state == "NORMAL"
    assert engine.indicator_light == "GREEN"
    assert engine.commanded_speed_pct == 100.0

def test_nominal_evaluation():
    engine = DecisionEngine("station-test-nominal")
    engine.reset()
    features = {"rms": 0.12, "peak": 0.35}
    state, light, speed, reason, layer = engine.evaluate(
        features=features,
        anomaly_score=0.10,
        motor={"measured_rpm": 1500.0, "commanded_pct": 100.0}
    )
    assert state == "NORMAL"
    assert light == "GREEN"
    assert speed == 100.0
    assert layer == "NONE"

def test_fixed_limit_hard_trip():
    engine = DecisionEngine("station-test-hard-limit")
    engine.reset()
    # RMS 1.45g exceeds HARD_LIMIT_RMS (1.25g)
    features = {"rms": 1.45, "peak": 3.50}
    state, light, speed, reason, layer = engine.evaluate(
        features=features,
        anomaly_score=0.20,
        motor={"measured_rpm": 1500.0, "commanded_pct": 100.0}
    )
    assert state == "STOPPED"
    assert light == "RED"
    assert speed == 0.0
    assert layer == "FIXED_LIMIT"

def test_two_stage_ai_anomaly_flow_mitigated():
    engine = DecisionEngine("station-test-two-stage-mitigated")
    engine.reset()

    # Stage 1: Anomaly detected at normal speed -> FIRST reduce speed to 50%
    features = {"rms": 0.55, "peak": 1.20}
    state, light, speed, reason, layer = engine.evaluate(
        features=features,
        anomaly_score=0.60, # >= warn_threshold (0.45)
        motor={"measured_rpm": 1500.0, "commanded_pct": 100.0}
    )
    assert state == "REDUCED_SPEED"
    assert light == "AMBER"
    assert speed == 50.0
    assert layer == "AI_LAYER"

    # Stage 2a: Tool runs at 50% speed, resonance subsides -> DO NOT STOP!
    features_mitigated = {"rms": 0.08, "peak": 0.20}
    for _ in range(5):
        state, light, speed, reason, layer = engine.evaluate(
            features=features_mitigated,
            anomaly_score=0.08, # anomaly subsided
            motor={"measured_rpm": 750.0, "commanded_pct": 50.0}
        )
        assert state == "REDUCED_SPEED"
        assert speed == 50.0
        assert light == "AMBER"
        # Must NOT trip to STOPPED

def test_two_stage_ai_anomaly_flow_persistent_trips():
    engine = DecisionEngine("station-test-two-stage-trip")
    engine.reset()

    # Stage 1: Anomaly detected -> Speed reduced to 50%
    features = {"rms": 0.60, "peak": 1.30}
    state, light, speed, reason, layer = engine.evaluate(
        features=features,
        anomaly_score=0.65,
        motor={"measured_rpm": 1500.0, "commanded_pct": 100.0}
    )
    assert state == "REDUCED_SPEED"
    assert speed == 50.0

    # Simulate stage2_high_start elapsed past stage_duration_sec (5.0s)
    engine.stage2_high_start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=6.0)

    # Stage 2b: High anomaly again at 50% speed -> COMPLETE STOP (0 RPM)
    state, light, speed, reason, layer = engine.evaluate(
        features=features,
        anomaly_score=0.75,
        motor={"measured_rpm": 750.0, "commanded_pct": 50.0}
    )
    assert state == "STOPPED"
    assert light == "RED"
    assert speed == 0.0

def test_manual_stop_and_reset():
    engine = DecisionEngine("station-test-manual-control")
    engine.reset()
    assert engine.state == "NORMAL"

    # Command manual emergency stop
    stop_res = engine.manual_stop(operator="SeniorOperator", notes="E-Stop activated")
    assert stop_res["current_state"] == "STOPPED"
    assert engine.state == "STOPPED"
    assert engine.commanded_speed_pct == 0.0
    assert engine.indicator_light == "RED"

    # Explicit reset restores normal operation
    reset_res = engine.reset(operator="SeniorOperator", notes="Cleared")
    assert reset_res["current_state"] == "NORMAL"
    assert engine.state == "NORMAL"
    assert engine.commanded_speed_pct == 100.0
    assert engine.indicator_light == "GREEN"

