import asyncio
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.schemas.pydantic_models import (
    SimulatorScenarioRequest,
    SimulatorStateResponse,
    MotorSpeedCommandRequest,
)
from backend.app.services.ingestion_service import IngestionService
from backend.app.core.decision_engine import get_decision_engine

router = APIRouter(prefix="/sim", tags=["Hardware Simulator"])

# Simulator loop permanently disabled - strictly operate on live API host data
def ensure_simulator_task():
    """No-op: Simulation is permanently disabled."""
    pass

@router.get("/state", response_model=SimulatorStateResponse)
def get_sim_state():
    """
    Returns station operational state based strictly on live API host telemetry.
    Simulation is permanently disabled.
    """
    engine = get_decision_engine("station-A")
    rec = IngestionService.latest_reading or {}
    meas_rpm = float(rec.get("measured_rpm", 0.0))
    cmd_pct = float(rec.get("commanded_speed_pct", 0.0 if engine.state == "STOPPED" else 100.0))
    
    return SimulatorStateResponse(
        is_running=False,
        scenario="live_api_host",
        exciter_amplitude=0.0,
        exciter_freq_hz=0.0,
        commanded_speed_pct=cmd_pct,
        virtual_rpm=round(meas_rpm, 1),
        last_seq=int(rec.get("seq", 0)),
        is_dropout=False,
        is_packet_loss=False,
        indicator_light=engine.indicator_light,
        station_state=engine.state
    )

@router.post("/scenario")
def set_sim_scenario(req: SimulatorScenarioRequest):
    """Simulation scenarios disabled - system strictly operates on real API host data."""
    return {
        "status": "simulation_disabled",
        "scenario": "live_api_host",
        "message": "Synthetic disturbance simulation is disabled. Operating strictly on real API host URL telemetry."
    }

@router.post("/motor-speed")
def set_motor_speed(req: MotorSpeedCommandRequest):
    """
    Commands motor speed setpoint through real station engine.
    """
    pct = max(0.0, min(100.0, float(req.commanded_speed_pct)))
    engine = get_decision_engine("station-A")
    if pct == 0.0:
        engine.manual_stop(operator="Operator (Speed Command)")
    else:
        if engine.state == "STOPPED":
            engine.reset(operator="Operator (Speed Command)")
        engine.commanded_speed_pct = pct

    if IngestionService.latest_reading:
        IngestionService.latest_reading["commanded_speed_pct"] = pct
        if pct == 0.0:
            IngestionService.latest_reading["state"] = "STOPPED"
            IngestionService.latest_reading["indicator_light"] = "RED"
            IngestionService.latest_reading["measured_rpm"] = 0.0

    return {
        "status": "speed_commanded",
        "commanded_speed_pct": pct,
        "current_rpm": float(IngestionService.latest_reading.get("measured_rpm", 0.0)) if IngestionService.latest_reading else 0.0
    }

@router.post("/start")
async def start_simulator():
    return {"status": "simulation_disabled", "is_running": False}

@router.post("/stop")
def stop_simulator():
    return {"status": "stopped", "is_running": False}

@router.post("/tick")
async def tick_simulator(db: Session = Depends(get_db)):
    return {"stepped": False, "simulation_disabled": True}
