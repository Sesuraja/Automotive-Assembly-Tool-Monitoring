from backend.app.database import SessionLocal
from backend.app.models.schema import SystemSetting
from backend.app.api.admin import update_settings, SystemSettingsPayload
from simulator.virtual_rig import simulator_rig
from backend.app.core.decision_engine import get_decision_engine

print("=== TESTING DYNAMIC MOTOR RATED RPM CALIBRATION ===")

db = SessionLocal()
try:
    # 1. Update settings to 3,200 RPM (High-Speed Nutrunner)
    print("\n--- Test 1: Updating to 3,200 RPM in Settings ---")
    payload = SystemSettingsPayload(
        motor_rated_rpm=3200.0,
        motor_max_rpm=4000.0
    )
    res = update_settings(payload, db=db)
    
    print(f"Simulator Motor Rated RPM: {simulator_rig.motor.rated_rpm}")
    print(f"Simulator Motor Current RPM at 100%: {simulator_rig.motor.current_rpm}")
    assert simulator_rig.motor.rated_rpm == 3200.0
    assert simulator_rig.motor.current_rpm == 3200.0

    eng = get_decision_engine("station-A")
    print(f"Decision Engine motor_rated_rpm: {getattr(eng, 'motor_rated_rpm', None)}")
    assert getattr(eng, "motor_rated_rpm", None) == 3200.0

    # Test 50% speed reduction at 3,200 RPM
    simulator_rig.motor.commanded_pct = 50.0
    for _ in range(10):
        simulator_rig.motor.update(dt=0.2, commanded_pct=50.0)
    print(f"Motor RPM at 50% Speed: {simulator_rig.motor.current_rpm:.0f} RPM (Expected: 1,600 RPM)")
    assert abs(simulator_rig.motor.current_rpm - 1600.0) < 10.0

    # 2. Update settings to 6,000 RPM (Robotic Torque Spindle)
    print("\n--- Test 2: Dynamically Increasing to 6,000 RPM in Settings ---")
    payload2 = SystemSettingsPayload(
        motor_rated_rpm=6000.0,
        motor_max_rpm=8000.0
    )
    update_settings(payload2, db=db)
    print(f"Simulator Motor Rated RPM: {simulator_rig.motor.rated_rpm}")
    print(f"Simulator Motor Max RPM: {simulator_rig.motor.max_rpm}")
    assert simulator_rig.motor.rated_rpm == 6000.0

    # Reset to 100% speed
    simulator_rig.motor.commanded_pct = 100.0
    simulator_rig.motor.current_rpm = 6000.0
    print(f"Motor RPM at 100% Speed: {simulator_rig.motor.current_rpm:.0f} RPM")
    assert simulator_rig.motor.current_rpm == 6000.0

    # 3. Update settings to 2,000 RPM
    print("\n--- Test 3: Dynamically Decreasing to 2,000 RPM in Settings ---")
    payload3 = SystemSettingsPayload(
        motor_rated_rpm=2000.0,
        motor_max_rpm=2500.0
    )
    update_settings(payload3, db=db)
    print(f"Simulator Motor Rated RPM: {simulator_rig.motor.rated_rpm}")
    assert simulator_rig.motor.rated_rpm == 2000.0
    print(f"Decision Engine motor_rated_rpm: {getattr(eng, 'motor_rated_rpm', None)}")
    assert getattr(eng, "motor_rated_rpm", None) == 2000.0

    print("\n[SUCCESS] ALL DYNAMIC MOTOR RPM TESTS PASSED!")
finally:
    db.close()
