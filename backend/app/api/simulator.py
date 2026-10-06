import asyncio
from fastapi import APIRouter, Depends, BackgroundTasks
from backend.app.database import get_db, SessionLocal
from backend.app.schemas.pydantic_models import (
    SimulatorScenarioRequest,
    SimulatorStateResponse,
    MotorSpeedCommandRequest,
)
from simulator.virtual_rig import simulator_rig
from backend.app.services.ingestion_service import IngestionService
from backend.app.core.decision_engine import get_decision_engine

router = APIRouter(prefix="/sim", tags=["Hardware Simulator"])

# Background task runner for simulator
_sim_task: Optional[asyncio.Task] = None

def ensure_simulator_task():
    global _sim_task
    simulator_rig.is_running = True
    if _sim_task is None or _sim_task.done():
        try:
            loop = asyncio.get_running_loop()
            _sim_task = loop.create_task(_simulator_loop())
        except RuntimeError:
            pass

async def _simulator_loop():
    while simulator_rig.is_running:
        dt = 0.1 # 10 Hz telemetry loop (1000 sample windows)
        payload = simulator_rig.step(dt=dt)
        
        db = SessionLocal()
        try:
            if payload:
                # Ingest into system
                feedback = await IngestionService.process_payload(payload, db=db)
                # Apply feedback to virtual motor
                st = feedback.get("state", "NORMAL")
                cmd_pct = feedback.get("commanded_speed_pct", 100.0)
                if st == "STOPPED" or cmd_pct <= 0.0:
                    simulator_rig.motor.is_stalled = True
                    simulator_rig.motor.commanded_pct = 0.0
                    simulator_rig.motor.current_rpm = 0.0
                simulator_rig.apply_backend_command(
                    commanded_speed_pct=cmd_pct,
                    indicator_light=feedback.get("indicator_light", "GREEN"),
                    station_state=st
                )
            else:
                # Packet dropped or sensor dropout scenario: check watchdog
                await IngestionService.trigger_link_loss_check(station_id="station-A", timeout_sec=1.0, db=db)
        except Exception as e:
            print(f"[Simulator Loop Error] {e}")
        finally:
            db.close()
            
        await asyncio.sleep(dt)

@router.get("/state", response_model=SimulatorStateResponse)
def get_sim_state():
    engine = get_decision_engine("station-A")
    return SimulatorStateResponse(
        is_running=simulator_rig.is_running,
        scenario=simulator_rig.scenario,
        exciter_amplitude=simulator_rig.exciter_amplitude,
        exciter_freq_hz=simulator_rig.exciter_freq_hz,
        commanded_speed_pct=simulator_rig.motor.commanded_pct,
        virtual_rpm=round(simulator_rig.motor.get_measured_rpm(), 1),
        last_seq=simulator_rig.seq,
        is_dropout=(simulator_rig.scenario == "sensor_dropout"),
        is_packet_loss=(simulator_rig.scenario == "packet_loss"),
        indicator_light=engine.indicator_light,
        station_state=engine.state
    )

@router.post("/scenario")
def set_sim_scenario(req: SimulatorScenarioRequest):
    simulator_rig.set_scenario(
        scenario=req.scenario,
        amplitude=req.exciter_amplitude,
        freq=req.exciter_freq_hz,
        seed=req.random_seed
    )
    engine = get_decision_engine("station-A")
    rated_target = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
    if req.scenario == "normal":
        if engine.state in ["STOPPED", "REDUCED_SPEED", "WARNING"]:
            engine.reset(operator="Operator (Scenario Selection)")
        simulator_rig.motor.is_stalled = False
        simulator_rig.motor.commanded_pct = 100.0
        simulator_rig.motor.current_rpm = rated_target
        simulator_rig.is_running = True
        simulator_rig.apply_backend_command(100.0, "GREEN", "NORMAL")
    else:
        # If tool was stopped, clear interlock so new disturbance cycle starts from nominal
        if engine.state == "STOPPED":
            engine.reset(operator="Operator (Disturbance Scenario Test)")
            simulator_rig.motor.is_stalled = False
            simulator_rig.motor.commanded_pct = 100.0
            simulator_rig.motor.current_rpm = rated_target
            simulator_rig.is_running = True
            simulator_rig.apply_backend_command(100.0, "GREEN", "NORMAL")
    if req.commanded_speed_pct is not None:
        simulator_rig.motor.commanded_pct = req.commanded_speed_pct
    ensure_simulator_task()
    return {"status": "scenario_updated", "scenario": req.scenario}

@router.post("/motor-speed")
def set_motor_speed(req: MotorSpeedCommandRequest):
    """
    Directly command motor target speed percentage (0.0 to 100.0%).
    First-order physics lag will decelerate/accelerate the rotor accordingly.
    """
    pct = max(0.0, min(100.0, float(req.commanded_speed_pct)))
    engine = get_decision_engine("station-A")
    if pct > 0 and engine.state == "STOPPED":
        engine.reset(operator="Operator (Speed Command)")
        if simulator_rig.scenario in ["disturbance_on", "disturbance_ramp", "sensor_dropout", "packet_loss", "critical_failure"]:
            simulator_rig.set_scenario("normal", amplitude=0.08, freq=180.0)
        simulator_rig.motor.is_stalled = False
        simulator_rig.motor.current_rpm = (pct / 100.0) * simulator_rig.motor.max_rpm
        simulator_rig.is_running = True
        simulator_rig.apply_backend_command(pct, "GREEN", "NORMAL")
    elif pct == 0.0:
        simulator_rig.motor.commanded_pct = 0.0
        simulator_rig.motor.current_rpm = 0.0
        engine.manual_stop(operator="Operator (Speed Command)")
    else:
        simulator_rig.motor.commanded_pct = pct

    ensure_simulator_task()
    target_rpm = (pct / 100.0) * simulator_rig.motor.max_rpm
    return {
        "status": "speed_commanded",
        "commanded_speed_pct": pct,
        "target_rpm": target_rpm,
        "current_rpm": round(simulator_rig.motor.get_measured_rpm(), 1)
    }

@router.post("/start")
async def start_simulator():
    ensure_simulator_task()
    return {"status": "started", "is_running": True}

@router.post("/stop")
def stop_simulator():
    simulator_rig.is_running = False
    return {"status": "stopped", "is_running": False}

@router.post("/tick")
async def tick_simulator(db: Session = Depends(get_db)):
    """Single step tick for automated testing"""
    payload = simulator_rig.step(dt=0.1)
    if payload:
        feedback = await IngestionService.process_payload(payload, db=db)
        simulator_rig.apply_backend_command(
            commanded_speed_pct=feedback.get("commanded_speed_pct", 100.0),
            indicator_light=feedback.get("indicator_light", "GREEN"),
            station_state=feedback.get("state", "NORMAL")
        )
        return {"stepped": True, "feedback": feedback}
    else:
        await IngestionService.trigger_link_loss_check(station_id="station-A", timeout_sec=1.0, db=db)
        return {"stepped": True, "dropped": True}
