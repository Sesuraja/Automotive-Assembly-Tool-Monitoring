import asyncio
import json
import random
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

import numpy as np
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from backend.app.database import get_db, SessionLocal
from simulator.virtual_rig import simulator_rig
from backend.app.core.decision_engine import get_decision_engine
from backend.app.models.schema import VendorGatewayConfig, EventRecord
from backend.app.services.ingestion_service import IngestionService
from backend.app.schemas.pydantic_models import IngestPayload, MotorData
from backend.app.config import settings

router = APIRouter(tags=["D1 Assembly Tool Hardware & Vibration API"])

# History buffer for rolling vibration readings
_history_buffer: List[Dict[str, Any]] = []
_MAX_HISTORY = 100

class MotorCommandRequest(BaseModel):
    command: str = Field(..., description="Action command: 'SET_SPEED', 'REDUCE_SPEED', 'STOP', 'RESET'")
    rpm: Optional[float] = Field(default=None, description="Target RPM when command is 'SET_SPEED'")
    station_id: Optional[str] = Field(default="station-A", description="Target station identifier")
    forward_to_vendor: Optional[bool] = Field(default=True, description="Forward command to configured remote Vendor API Base URL")

class RemoteVendorProbeRequest(BaseModel):
    target: str = Field(default="local", description="'remote' for Cloud Run or 'local' for local engine")
    command: Optional[str] = Field(default="STOP", description="Command to dispatch: 'STOP', 'SET_SPEED', 'REDUCE_SPEED', 'RESET'")
    rpm: Optional[float] = Field(default=1500.0, description="Target RPM")
    custom_url: Optional[str] = Field(default=None, description="Optional custom base URL")

class GaoObject(BaseModel):
    dmac: str = "AC233F88D105"
    rssi: int = -58
    time: str = ""
    vbatt: int = 3020
    temp: float = 26.4
    x: float = 0.0412
    y: float = -0.0185
    z: float = 0.9854

class GaoPacket(BaseModel):
    msg: str = "advData"
    gmac: str = "CC1BE0E24419"
    obj: List[GaoObject]

class FaultInjectionRequest(BaseModel):
    duration_ms: int = Field(default=8000, description="Duration in ms to inject chatter anomaly")

class SimulationModeRequest(BaseModel):
    mode: str = Field(..., description="'normal', 'mild', 'missing'")

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _get_active_motor_status():
    st_id = "station-A"
    if IngestionService.latest_reading:
        st_id = IngestionService.latest_reading.get("station_id", "station-A")
    engine = get_decision_engine(st_id)
    if engine.state == "STOPPED" or simulator_rig.motor.is_stalled or simulator_rig.motor.commanded_pct <= 0.0:
        return "OFF", 0.0, False, False, True

    if IngestionService.latest_reading:
        rec = IngestionService.latest_reading
        st = rec.get("state", "NORMAL")
        meas_rpm = float(rec.get("measured_rpm", 0.0))
        is_off = st == "STOPPED" or meas_rpm < 15.0 or engine.state == "STOPPED"
        if is_off:
            return "OFF", 0.0, False, False, True
        cmd_p = float(rec.get("commanded_speed_pct", 100.0))
        is_slow = st in ["REDUCED_SPEED", "WARNING"] or cmd_p <= 55.0 or (15.0 <= meas_rpm < 800.0) or (15.0 <= meas_rpm <= 6500.0 and cmd_p <= 60.0)
        is_running = not is_off and not is_slow
        mot_status = "OFF" if is_off else ("SLOW" if is_slow else "RUNNING")
        return mot_status, meas_rpm, is_running, is_slow, is_off

    rpm = simulator_rig.motor.get_measured_rpm()
    is_stalled = simulator_rig.motor.is_stalled or engine.state == "STOPPED" or simulator_rig.motor.commanded_pct == 0.0

    if is_stalled or rpm < 15.0:
        return "OFF", 0.0, False, False, True
    elif rpm < 800.0 or simulator_rig.motor.commanded_pct <= 55.0 or engine.state == "REDUCED_SPEED" or engine.commanded_speed_pct <= 55.0:
        return "SLOW", rpm, False, True, False
    else:
        return "RUNNING", rpm, True, False, False

def _record_history_sample(item: Dict[str, Any]):
    global _history_buffer
    _history_buffer.append(item)
    if len(_history_buffer) > _MAX_HISTORY:
        _history_buffer.pop(0)

# ===========================================================================
# 1. MOTOR STATUS & CONTROL
# ===========================================================================

@router.get("/motor/status")
@router.get("/v1/motor/status")
def get_motor_status():
    """
    Instant check returning whether the spindle motor is RUNNING (>800 RPM),
    SLOW (50-800 RPM), or OFF (0 RPM), along with slip percentage and safety interlock state.
    Conforms to official Postman tests:
      pm.expect(["RUNNING", "SLOW", "OFF"]).to.include(res.status)
      pm.expect(res).to.have.property("measured_rpm")
      pm.expect(res).to.have.property("is_running")
      pm.expect(res).to.have.property("is_slow")
      pm.expect(res).to.have.property("is_off")
    """
    st_id = "station-A"
    if IngestionService.latest_reading:
        st_id = IngestionService.latest_reading.get("station_id", "station-A")
    engine = get_decision_engine(st_id)
    is_engine_stopped = (engine.state == "STOPPED")

    if IngestionService.latest_reading:
        rec = IngestionService.latest_reading
        st = "STOPPED" if is_engine_stopped else rec.get("state", "NORMAL")
        meas_rpm = 0.0 if (is_engine_stopped or st == "STOPPED") else float(rec.get("measured_rpm", 0.0))
        is_off = st == "STOPPED" or meas_rpm < 15.0 or is_engine_stopped
        cmd_speed = 0.0 if is_off else float(rec.get("commanded_speed_pct", 100.0))
        is_slow = not is_off and (st in ["REDUCED_SPEED", "WARNING"] or cmd_speed <= 55.0 or (15.0 <= meas_rpm < 800.0) or (15.0 <= meas_rpm <= 6500.0 and cmd_speed <= 60.0))
        is_running = not is_off and not is_slow
        mot_status = "OFF" if is_off else ("SLOW" if is_slow else "RUNNING")
        light = "RED" if is_off else ("AMBER" if is_slow else rec.get("indicator_light", "GREEN"))
        return {
            "status": mot_status,
            "measured_rpm": 0.0 if is_off else round(meas_rpm, 1),
            "is_running": is_running,
            "is_slow": is_slow,
            "is_off": is_off,
            "slip_pct": 0.0,
            "interlock_state": "TRIPPED" if is_off else "ARMED",
            "commanded_speed_pct": cmd_speed,
            "current_amps": 0.0 if is_off else round(4.2 * (cmd_speed / 100.0), 2),
            "indicator_light": light,
            "station_id": st_id,
            "timestamp": rec.get("ts", datetime.now(timezone.utc).isoformat())
        }

    status, rpm, is_running, is_slow, is_off = _get_active_motor_status()
    engine = get_decision_engine("station-A")
    now_iso = datetime.now(timezone.utc).isoformat()
    slip_pct = round(random.uniform(1.5, 2.8), 2) if is_running else 0.0

    return {
        "status": status,
        "measured_rpm": round(rpm, 1),
        "is_running": is_running,
        "is_slow": is_slow,
        "is_off": is_off,
        "slip_pct": slip_pct,
        "interlock_state": "TRIPPED" if is_off else "ARMED",
        "commanded_speed_pct": 0.0 if is_off else (50.0 if is_slow else 100.0),
        "current_amps": 0.0 if is_off else round(2.1 if is_slow else 4.2, 2),
        "indicator_light": "RED" if is_off else ("AMBER" if is_slow else "GREEN"),
        "station_id": "station-A",
        "timestamp": now_iso
    }

@router.get("/motor/state")
@router.get("/v1/motor/state")
def get_motor_state():
    """
    Detailed motor telemetry including encoder measured RPM, vibration RMS,
    anomaly score, persistence counter, and trip reason.
    """
    status, rpm, is_running, is_slow, is_off = _get_active_motor_status()
    engine = get_decision_engine("station-A")
    now_iso = datetime.now(timezone.utc).isoformat()

    if IngestionService.latest_reading:
        rec = IngestionService.latest_reading
        feat = rec.get("features", {})
        rms = float(feat.get("rms", 0.005 if is_off else 0.035))
        score = float(rec.get("smoothed_anomaly_score", 0.05 if is_off else 0.04))
        cmd_speed = float(rec.get("commanded_speed_pct", 0.0 if is_off else 100.0))
        light = rec.get("indicator_light", "RED" if is_off else "GREEN")
        current_amps = 0.0 if is_off else round(4.2 * (cmd_speed / 100.0), 2)
        sync_rpm = 12000.0 if rpm > 4000.0 else 1500.0
        slip_pct = round(abs(sync_rpm - rpm) / (sync_rpm / 100.0), 2) if is_running else 0.0
        return {
            "status": status,
            "measured_rpm": round(rpm, 1),
            "commanded_speed_pct": cmd_speed,
            "vibration_rms": rms,
            "anomaly_score": score,
            "persistence_counter": getattr(engine, "consecutive_warn_count", 0) + getattr(engine, "consecutive_critical_count", 0),
            "trip_reason": rec.get("last_decision_reason") if is_off else None,
            "station_id": rec.get("station_id", "station-A"),
            "interlock_state": "TRIPPED" if is_off else "ARMED",
            "indicator_light": light,
            "slip_pct": slip_pct,
            "current_amps": current_amps,
            "timestamp": rec.get("ts", now_iso)
        }

    rms = 0.005 if is_off else (0.12 if is_slow else 0.245)
    score = 0.05 if is_off else (0.48 if is_slow else 0.12)

    return {
        "status": status,
        "measured_rpm": round(rpm, 1),
        "commanded_speed_pct": simulator_rig.motor.commanded_pct,
        "vibration_rms": rms,
        "anomaly_score": score,
        "persistence_counter": getattr(engine, "consecutive_warn_count", 0) + getattr(engine, "consecutive_critical_count", 0),
        "trip_reason": engine.last_decision_reason if is_off else None,
        "station_id": "station-A",
        "interlock_state": "TRIPPED" if is_off else "ARMED",
        "indicator_light": engine.indicator_light,
        "slip_pct": 0.0,
        "current_amps": round(4.2 * (simulator_rig.motor.commanded_pct / 100.0), 2) if not is_off else 0.0,
        "timestamp": now_iso
    }

@router.post("/motor/command")
@router.post("/v1/motor/command")
async def execute_motor_command(req: MotorCommandRequest):
    """
    Commands the motor:
      - SET_SPEED: target rpm (e.g. 1500) -> status: RUNNING
      - REDUCE_SPEED: 500 rpm -> status: SLOW
      - STOP: 0 rpm -> status: OFF (Vibration X, Y drop to 0.00g and RMS to 0.005g)
      - RESET: Restores motor to nominal speed
    Also forwards to remote Vendor API (configured via VENDOR_API_BASE_URL) when requested.
    """
    cmd = req.command.strip().upper()
    engine = get_decision_engine(req.station_id or "station-A")
    now_iso = datetime.now(timezone.utc).isoformat()
    remote_feedback = None

    if cmd == "STOP":
        simulator_rig.motor.is_stalled = True
        simulator_rig.motor.commanded_pct = 0.0
        simulator_rig.motor.current_rpm = 0.0
        simulator_rig.apply_backend_command(0.0, "RED", "STOPPED")

        engine.manual_stop(operator="Operator (/api/motor/command)")

        if IngestionService.latest_reading:
            IngestionService.latest_reading["state"] = "STOPPED"
            IngestionService.latest_reading["indicator_light"] = "RED"
            IngestionService.latest_reading["commanded_speed_pct"] = 0.0
            IngestionService.latest_reading["measured_rpm"] = 0.0
            IngestionService.latest_reading["motor_status"] = "OFF"
            IngestionService.latest_reading["current_amps"] = 0.0
            IngestionService.latest_reading["is_running"] = False
            IngestionService.latest_reading["is_slow"] = False
            IngestionService.latest_reading["is_off"] = True
            if "features" in IngestionService.latest_reading and isinstance(IngestionService.latest_reading["features"], dict):
                IngestionService.latest_reading["features"]["rms"] = 0.005
                IngestionService.latest_reading["features"]["peak"] = 0.008

        from backend.app.core.live_hub import live_hub
        if IngestionService.latest_reading:
            asyncio.create_task(live_hub.broadcast(IngestionService.latest_reading))

        db = SessionLocal()
        try:
            evt = EventRecord(
                station_id=req.station_id or "station-A",
                event_type="TRIP",
                details="Motor STOP command received via /api/motor/command. Speed reduced to 0 RPM, safety interlock engaged.",
                operator="Operator (/api/motor/command)"
            )
            db.add(evt)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        if req.forward_to_vendor:
            remote_feedback = await _forward_command_to_vendor(cmd, req.rpm)

        return {
            "status": "OFF",
            "command": "STOP",
            "measured_rpm": 0.0,
            "is_running": False,
            "is_slow": False,
            "is_off": True,
            "vibration_x_g": 0.00,
            "vibration_y_g": 0.00,
            "vibration_rms_g": 0.005,
            "message": "Motor STOP command executed. Motor status is OFF; X and Y dropped to 0.00g, RMS dropped to 0.005g.",
            "remote_forwarding": remote_feedback,
            "timestamp": now_iso
        }

    elif cmd == "REDUCE_SPEED":
        simulator_rig.motor.is_stalled = False
        rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
        target_rpm = rated_ref * 0.5
        simulator_rig.motor.commanded_pct = 50.0
        simulator_rig.motor.current_rpm = target_rpm
        simulator_rig.apply_backend_command(50.0, "AMBER", "REDUCED_SPEED")

        engine.state = "REDUCED_SPEED"
        engine.indicator_light = "AMBER"
        engine.commanded_speed_pct = 50.0

        if req.forward_to_vendor:
            remote_feedback = await _forward_command_to_vendor(cmd, target_rpm)

        return {
            "status": "SLOW",
            "command": "REDUCE_SPEED",
            "measured_rpm": target_rpm,
            "is_running": False,
            "is_slow": True,
            "is_off": False,
            "message": f"Motor speed throttled to {target_rpm:.0f} RPM (50% rated). Status is SLOW.",
            "remote_forwarding": remote_feedback,
            "timestamp": now_iso
        }

    elif cmd == "SET_SPEED":
        rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
        target_rpm = req.rpm if req.rpm is not None else rated_ref
        simulator_rig.motor.is_stalled = False
        simulator_rig.motor.commanded_pct = min(100.0, (target_rpm / rated_ref) * 100.0)
        simulator_rig.motor.current_rpm = target_rpm
        simulator_rig.apply_backend_command(100.0, "GREEN", "NORMAL")

        engine.reset(operator="Operator (SET_SPEED)")

        if req.forward_to_vendor:
            remote_feedback = await _forward_command_to_vendor(cmd, target_rpm)

        status_str = "SLOW" if target_rpm < (rated_ref * 0.65) else "RUNNING"
        return {
            "status": status_str,
            "command": "SET_SPEED",
            "measured_rpm": target_rpm,
            "is_running": status_str == "RUNNING",
            "is_slow": status_str == "SLOW",
            "is_off": False,
            "message": f"Motor speed commanded to {target_rpm} RPM. Status is {status_str}.",
            "remote_forwarding": remote_feedback,
            "timestamp": now_iso
        }

    elif cmd in ["RESET", "START", "RUN"]:
        from backend.app.core.decision_engine import reset_all_decision_engines
        reset_all_decision_engines(operator=f"Operator ({cmd})")
        db = SessionLocal()
        try:
            from backend.app.models.schema import Station
            for st in db.query(Station).all():
                st.state = "NORMAL"
                st.indicator_light = "GREEN"
                st.commanded_speed_pct = 100.0
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
        simulator_rig.motor.is_stalled = False
        simulator_rig.motor.commanded_pct = 100.0
        target_rpm = rated_ref
        simulator_rig.motor.current_rpm = target_rpm
        simulator_rig.apply_backend_command(100.0, "GREEN", "NORMAL")

        if IngestionService.latest_reading:
            IngestionService.latest_reading["state"] = "NORMAL"
            IngestionService.latest_reading["indicator_light"] = "GREEN"
            IngestionService.latest_reading["commanded_speed_pct"] = 100.0
            IngestionService.latest_reading["measured_rpm"] = target_rpm
            IngestionService.latest_reading["motor_status"] = "RUNNING"
            IngestionService.latest_reading["is_running"] = True
            IngestionService.latest_reading["is_slow"] = False
            IngestionService.latest_reading["is_off"] = False

        from backend.app.core.live_hub import live_hub
        if IngestionService.latest_reading:
            asyncio.create_task(live_hub.broadcast(IngestionService.latest_reading))

        if req.forward_to_vendor:
            remote_feedback = await _forward_command_to_vendor(cmd, target_rpm)

        return {
            "status": "RUNNING",
            "command": cmd,
            "measured_rpm": target_rpm,
            "is_running": True,
            "is_slow": False,
            "is_off": False,
            "message": f"Safety reset executed. Motor restored to normal nominal speed ({target_rpm:.0f} RPM).",
            "remote_forwarding": remote_feedback,
            "timestamp": now_iso
        }
    else:
        raise HTTPException(status_code=400, detail=f"Unrecognized command '{req.command}'. Supported: SET_SPEED, REDUCE_SPEED, STOP, RESET")

# ===========================================================================
# 2. BLE GATEWAY (GAO 217030)
# ===========================================================================

@router.get("/gateway/gao217030/packet")
@router.get("/v1/gateway/gao217030/packet")
async def get_gao217030_packet():
    """
    Returns the exact JSON payload format transmitted by the GAO 217030 gateway over HTTP POST.
    Conforms to Postman tests:
      pm.expect(res.msg).to.eql("advData")
      pm.expect(res).to.have.property("gmac")
      pm.expect(res.obj).to.be.an("array")
    """
    vendor_base = settings.VENDOR_API_BASE_URL.strip().rstrip("/")
    if vendor_base:
        url = f"{vendor_base}/api/gateway/gao217030/packet"
        headers = {"Accept": "application/json"}
        cookie_token = settings.VENDOR_BLE_GATEWAY_API_KEY.strip()
        if cookie_token:
            if "=" in cookie_token:
                headers["Cookie"] = cookie_token
            else:
                headers["Authorization"] = f"Bearer {cookie_token}"
        try:
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            pass

    status, rpm, _, _, is_off = _get_active_motor_status()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    x, y, z = 0.0412, -0.0185, 0.9854
    vbatt = 3020
    rssi_val = -58
    if IngestionService.latest_reading:
        rec = IngestionService.latest_reading
        feat = rec.get("features", {})
        x = round(float(feat.get("acc_x", 0.0412)), 4)
        y = round(float(feat.get("acc_y", -0.0185)), 4)
        z = round(float(feat.get("acc_z", 0.9854)), 4)
        vbatt = int((float(rec.get("battery_pct", 98.0)) / 100.0) * 3300)
        rssi_val = int(rec.get("rssi", -58))

    return {
        "msg": "advData",
        "gmac": "CC1BE0E24419",
        "obj": [
            {
                "dmac": "AC233F88D105",
                "rssi": rssi_val,
                "time": now_str,
                "vbatt": vbatt,
                "temp": 27.1,
                "x": x,
                "y": y,
                "z": z
            }
        ]
    }

@router.post("/gateway/gao217030/ingest")
@router.post("/v1/gateway/gao217030/ingest")
async def ingest_gao217030_payload(packet: GaoPacket, db=Depends(get_db)):
    """
    Ingestion endpoint for external physical gateways or scripts to post real BLE advertisement frames into the safety engine.
    """
    now = datetime.now(timezone.utc)
    feedback_list = []

    for item in packet.obj:
        samples = [item.x, item.y, item.z] * 333
        status, rpm, _, _, _ = _get_active_motor_status()
        motor_info = MotorData(commanded_pct=100.0, measured_rpm=rpm, current_amps=4.2)

        ingest_payload = IngestPayload(
            device_id=item.dmac,
            station_id="station-A",
            ts=now,
            seq=int(now.timestamp()),
            sample_rate_hz=1000,
            window=samples,
            axes="xyz",
            motor=motor_info,
            battery_pct=round((item.vbatt / 3300.0) * 100, 1),
            rssi=float(item.rssi)
        )
        fb = await IngestionService.process_payload(ingest_payload, db=db)
        feedback_list.append({"device": item.dmac, "feedback": fb})

    return {
        "status": "success",
        "gmac": packet.gmac,
        "frames_processed": len(packet.obj),
        "results": feedback_list
    }

@router.get("/gateways")
@router.get("/v1/gateways")
def list_configured_gateways():
    """
    List configured industrial BLE gateways.
    """
    return [
        {
            "id": "gw-gao-01",
            "name": "GAO 217030 BLE Industrial Gateway",
            "gmac": "CC1BE0E24419",
            "ip_address": "192.168.4.150",
            "status": "online",
            "station_id": "station-A",
            "protocol": "GAO-advData-JSON",
            "last_seen": datetime.now(timezone.utc).isoformat()
        },
        {
            "id": "gw-ble-cloud",
            "name": "Cloud Run Remote Gateway Relay",
            "gmac": "AC233F8912D4",
            "ip_address": settings.VENDOR_API_BASE_URL,
            "status": "connected",
            "station_id": "station-A",
            "protocol": "GenericREST",
            "last_seen": datetime.now(timezone.utc).isoformat()
        }
    ]

@router.get("/devices")
@router.get("/v1/devices")
def list_configured_devices():
    """
    List configured beacon devices.
    """
    vbatt = 3020
    rssi_val = -58
    if IngestionService.latest_reading:
        rec = IngestionService.latest_reading
        vbatt = int((float(rec.get("battery_pct", 98.0)) / 100.0) * 3300)
        rssi_val = int(rec.get("rssi", -58))

    return [
        {
            "dmac": "AC233F88D105",
            "name": "KKM S5 Triaxial Vibration Sensor (AC:23:3F:88:D1:05)",
            "model": "KKM-S5",
            "station_id": "station-A",
            "sample_rate_hz": 1000,
            "battery_mv": vbatt,
            "temp_c": 27.1,
            "rssi": rssi_val,
            "status": "active"
        }
    ]

# ===========================================================================
# 3. VIBRATION TELEMETRY & ANALYTICS
# ===========================================================================

@router.get("/vibration/live")
@router.get("/v1/vibration/live")
def get_live_vibration():
    """
    Normalized real-time triaxial metrics.
    Conforms to Postman tests:
      pm.expect(res).to.have.property("acc_x_g")
      pm.expect(res).to.have.property("acc_y_g")
      pm.expect(res).to.have.property("acc_z_g")
      pm.expect(res).to.have.property("rms_g")
    When motor is STOPPED:
      - acc_x_g and acc_y_g drop to 0.00g
      - rms_g drops to 0.005g
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    if IngestionService.latest_reading:
        rec = IngestionService.latest_reading
        feat = rec.get("features", {})
        acc_x = float(feat.get("acc_x", 0.0))
        acc_y = float(feat.get("acc_y", 0.0))
        acc_z = float(feat.get("acc_z", 0.0))
        rms = float(feat.get("rms", 0.0))
        peak = float(feat.get("peak", 0.0))
        crest = float(feat.get("crest_factor", 0.0))
        kurt = float(feat.get("kurtosis", 0.0))
        engine = get_decision_engine(rec.get("station_id", "station-A"))
        is_engine_stopped = (engine.state == "STOPPED")
        st = "STOPPED" if is_engine_stopped else rec.get("state", "NORMAL")
        meas_rpm = 0.0 if (is_engine_stopped or st == "STOPPED") else float(rec.get("measured_rpm", 0.0))
        cmd_speed = 0.0 if is_engine_stopped or st == "STOPPED" else float(rec.get("commanded_speed_pct", 100.0))
        is_slow_vib = not is_engine_stopped and (st in ["REDUCED_SPEED", "WARNING"] or cmd_speed <= 55.0 or (15.0 <= meas_rpm < 800.0) or (15.0 <= meas_rpm <= 6500.0 and cmd_speed <= 60.0))
        mot_status = "OFF" if (st == "STOPPED" or meas_rpm < 15.0 or is_engine_stopped) else ("SLOW" if is_slow_vib else "RUNNING")
        if mot_status == "OFF":
            acc_x = 0.00
            acc_y = 0.00
            rms = 0.005
            peak = 0.008
        light = "RED" if mot_status == "OFF" else ("AMBER" if mot_status == "SLOW" else rec.get("indicator_light", "GREEN"))
        data = {
            "acc_x_g": acc_x,
            "acc_y_g": acc_y,
            "acc_z_g": acc_z,
            "rms_g": rms,
            "peak_g": peak,
            "crest_factor": crest,
            "kurtosis": kurt,
            "temp": 26.4,
            "vbatt": int((float(rec.get("battery_pct", 98.0)) / 100.0) * 3300),
            "motor_status": mot_status,
            "status": mot_status,
            "state": st,
            "indicator_light": light,
            "commanded_speed_pct": cmd_speed,
            "anomaly_score": float(rec.get("smoothed_anomaly_score", 0.0)),
            "measured_rpm": round(meas_rpm, 1),
            "x": acc_x,
            "y": acc_y,
            "z": acc_z,
            "rms": rms,
            "timestamp": rec.get("ts", now_iso)
        }
        _record_history_sample(data)
        return data

    status, rpm, _, _, is_off = _get_active_motor_status()

    if is_off:
        acc_x = 0.00
        acc_y = 0.00
        acc_z = 0.01
        rms = 0.005
        peak = 0.008
        crest = 1.414
        kurt = 0.0
        temp = 26.4
        vbatt = 3020
    else:
        rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
        factor = rpm / rated_ref
        acc_x = round(0.0412 * factor, 4)
        acc_y = round(-0.0185 * factor, 4)
        acc_z = 0.9854
        rms = round(float(np.sqrt((acc_x**2 + acc_y**2 + (acc_z - 0.98)**2) / 3.0 + 0.05)), 3)
        peak = round(rms * 1.45, 3)
        crest = round(peak / max(rms, 0.001), 2)
        kurt = 3.02
        temp = 26.4
        vbatt = 3020

    data = {
        "acc_x_g": acc_x,
        "acc_y_g": acc_y,
        "acc_z_g": acc_z,
        "rms_g": rms,
        "peak_g": peak,
        "crest_factor": crest,
        "kurtosis": kurt,
        "temp": temp,
        "vbatt": vbatt,
        "motor_status": status,
        "status": status,
        "measured_rpm": round(rpm, 1),
        # Extra aliases for backward compatibility
        "x": acc_x,
        "y": acc_y,
        "z": acc_z,
        "rms": rms,
        "timestamp": now_iso
    }
    _record_history_sample(data)
    return data

@router.get("/vibration/history")
@router.get("/v1/vibration/history")
def get_vibration_history(limit: int = Query(default=30, ge=1, le=100)):
    """
    Retrieves rolling window of historical accelerometer samples for time-series charts or FFT analysis.
    """
    global _history_buffer
    if not _history_buffer:
        # Populate initial samples
        for _ in range(limit):
            get_live_vibration()
    return _history_buffer[-limit:]

@router.get("/readings/latest")
@router.get("/v1/readings/latest")
def get_latest_reading():
    """
    Get latest ingestion reading.
    """
    if IngestionService.latest_reading:
        return IngestionService.latest_reading
    return get_live_vibration()

# ===========================================================================
# 4. SIMULATION & FAULT INJECTION
# ===========================================================================

@router.get("/simulation/config")
@router.get("/v1/simulation/config")
def get_simulation_config():
    """
    Get simulation engine configuration.
    """
    return {
        "scenario": simulator_rig.scenario,
        "exciter_amplitude_g": simulator_rig.exciter_amplitude,
        "exciter_freq_hz": simulator_rig.exciter_freq_hz,
        "sample_rate_hz": simulator_rig.sample_rate_hz,
        "motor_max_rpm": float(getattr(simulator_rig.motor, "max_rpm", 2000.0)),
        "motor_nominal_rpm": float(getattr(simulator_rig.motor, "rated_rpm", 1500.0)),
        "vendor_api_base_url": settings.VENDOR_API_BASE_URL,
        "vendor_ble_gateway_url": settings.VENDOR_BLE_GATEWAY_URL
    }

@router.post("/simulation/inject-fault")
@router.post("/v1/simulation/inject-fault")
async def inject_fault(req: FaultInjectionRequest):
    """
    Injects severe vibration chatter (>1.2g) into the motor for specified duration (e.g. 8s)
    to test automated safety tripping in your application.
    """
    from backend.app.api.simulator import ensure_simulator_task
    ensure_simulator_task()
    simulator_rig.set_scenario("disturbance_on", amplitude=1.35, freq=180.0)

    # Schedule auto-reset after duration
    async def _reset_after():
        await asyncio.sleep(req.duration_ms / 1000.0)
        simulator_rig.set_scenario("normal")
    asyncio.create_task(_reset_after())

    return {
        "status": "fault_injected",
        "duration_ms": req.duration_ms,
        "amplitude_g": 1.35,
        "frequency_hz": 180.0,
        "message": f"Injected bearing chatter anomaly for {req.duration_ms} ms."
    }

@router.post("/simulation/mode")
@router.post("/v1/simulation/mode")
def set_simulation_mode(req: SimulationModeRequest):
    """
    Set simulation mode: 'normal', 'mild', 'missing' (RF packet loss).
    """
    from backend.app.api.simulator import ensure_simulator_task
    ensure_simulator_task()
    mode = req.mode.lower()
    if mode == "normal":
        simulator_rig.set_scenario("normal")
    elif mode == "mild":
        simulator_rig.set_scenario("disturbance_on", amplitude=0.55, freq=120.0)
    elif mode == "missing":
        simulator_rig.set_scenario("packet_loss")
    else:
        raise HTTPException(status_code=400, detail=f"Invalid mode '{req.mode}'. Use: normal, mild, missing")

    return {
        "status": "mode_updated",
        "mode": mode,
        "message": f"Simulation mode switched to {mode}."
    }

# ===========================================================================
# 5. REAL-TIME SSE STREAMS
# ===========================================================================

@router.get("/stream/motor")
@router.get("/v1/stream/motor")
async def stream_motor_status():
    """
    Streams continuous motor status (RUNNING / SLOW / OFF), measured RPM, and slip percentage at 4 Hz.
    """
    async def event_generator():
        while True:
            data = get_motor_status()
            yield f"data: {json.dumps(data)}\n\n"
            await asyncio.sleep(0.25)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/stream/live")
@router.get("/v1/stream/live")
async def stream_live_telemetry():
    """
    Synchronized full telemetry (SSE).
    """
    async def event_generator():
        while True:
            vib = get_live_vibration()
            mot = get_motor_status()
            payload = {**vib, "motor": mot}
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(0.2)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/stream/gateway")
@router.get("/v1/stream/gateway")
async def stream_gateway_packets():
    """
    Stream GAO 217030 gateway packets (SSE).
    """
    async def event_generator():
        while True:
            packet = get_gao217030_packet()
            yield f"data: {json.dumps(packet)}\n\n"
            await asyncio.sleep(0.5)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/stream/vibration")
@router.get("/v1/stream/vibration")
async def stream_vibration_telemetry():
    """
    Stream vibration telemetry (SSE).
    """
    async def event_generator():
        while True:
            vib = get_live_vibration()
            yield f"data: {json.dumps(vib)}\n\n"
            await asyncio.sleep(0.1)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ===========================================================================
# 6. API SPECIFICATION & DOCUMENTATION
# ===========================================================================

# Cache the official Postman collection schema
POSTMAN_COLLECTION_JSON = {
    "info": {
        "_postman_id": "e60c90db-3b31-4a09-b79c-19960ad1f570-postman",
        "name": "D1 Assembly Tool Hardware Simulation & Vibration Telemetry API",
        "description": "Official Postman Collection for the D1 Automotive Assembly Tool Guardian simulation engine.\n\nIncludes:\n- Real-time Motor Status detection (RUNNING, SLOW, OFF)\n- GAO 217030 BLE Gateway packets\n- KKM S5 Triaxial Vibration Telemetry & FFT feature extraction\n- Deterministic Machine Safety Interlocks & E-Stop\n- Server-Sent Events (SSE) live streams",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        "version": "1.2.0"
    },
    "variable": [
        {
            "key": "baseUrl",
            "value": settings.VENDOR_API_BASE_URL or "http://localhost:8000",
            "type": "string",
            "description": "Target API Host (Cloud or local dev server)"
        }
    ]
}

@router.get("/export/postman")
@router.get("/v1/export/postman")
def export_postman_collection():
    """
    Export official Postman Collection v2.1 JSON with dynamically resolved baseUrl from environment.
    """
    POSTMAN_COLLECTION_JSON["variable"][0]["value"] = settings.VENDOR_API_BASE_URL or "http://localhost:8000"
    return POSTMAN_COLLECTION_JSON

@router.get("/docs/openapi.json")
def get_custom_openapi(request: Request):
    """
    Export OpenAPI v3.0 JSON Spec.
    """
    return request.app.openapi()

# ===========================================================================
# REMOTE VENDOR FORWARDING HELPER (Zero Hardcoded URLs)
# ===========================================================================

async def _forward_command_to_vendor(cmd: str, rpm: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """
    Forwards motor command to the external vendor base URL configured via environment:
    settings.VENDOR_API_BASE_URL with authentication cookie.
    """
    vendor_base = settings.VENDOR_API_BASE_URL.strip().rstrip("/")
    if not vendor_base:
        return None

    target_url = f"{vendor_base}/api/motor/command"
    payload: Dict[str, Any] = {"command": cmd}
    if rpm is not None and cmd == "SET_SPEED":
        payload["rpm"] = float(rpm)

    from backend.app.config import get_vendor_auth_cookie
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Aperture-Tool-Monitor/1.0"
    }
    cookie_token = get_vendor_auth_cookie()
    if cookie_token:
        headers["Cookie"] = cookie_token

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.post(target_url, json=payload, headers=headers)
            res_data = None
            try:
                res_data = resp.json()
            except Exception:
                res_data = resp.text[:200]

            if isinstance(res_data, dict):
                rem_status = res_data.get("operational_status") or res_data.get("status")
                rem_meas_rpm = res_data.get("measured_rpm")
                rem_cmd_rpm = res_data.get("commanded_rpm")
                if IngestionService.latest_reading:
                    if rem_meas_rpm is not None:
                        IngestionService.latest_reading["measured_rpm"] = float(rem_meas_rpm)
                    if rem_cmd_rpm is not None:
                        raw_c = float(rem_cmd_rpm)
                        rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
                        IngestionService.latest_reading["commanded_speed_pct"] = min(100.0, (raw_c / rated_ref) * 100.0)
                    if cmd in ["STOP", "EMERGENCY_STOP"]:
                        IngestionService.latest_reading["state"] = "STOPPED"
                        IngestionService.latest_reading["indicator_light"] = "RED"
                        IngestionService.latest_reading["commanded_speed_pct"] = 0.0
                        IngestionService.latest_reading["measured_rpm"] = 0.0
                        IngestionService.latest_reading["motor_status"] = "OFF"
                        IngestionService.latest_reading["is_running"] = False
                        IngestionService.latest_reading["is_slow"] = False
                        IngestionService.latest_reading["is_off"] = True
                    elif cmd == "REDUCE_SPEED":
                        IngestionService.latest_reading["state"] = "REDUCED_SPEED"
                        IngestionService.latest_reading["indicator_light"] = "AMBER"
                        IngestionService.latest_reading["commanded_speed_pct"] = 50.0
                        IngestionService.latest_reading["motor_status"] = "SLOW"
                    elif cmd in ["RESET", "START", "RUN", "SET_SPEED"]:
                        IngestionService.latest_reading["state"] = "NORMAL"
                        IngestionService.latest_reading["indicator_light"] = "GREEN"
                        IngestionService.latest_reading["commanded_speed_pct"] = 100.0
                        IngestionService.latest_reading["motor_status"] = "RUNNING"
                        IngestionService.latest_reading["is_running"] = True
                        IngestionService.latest_reading["is_slow"] = False
                        IngestionService.latest_reading["is_off"] = False
                    elif rem_status is not None:
                        IngestionService.latest_reading["motor_status"] = rem_status
                        if rem_status == "OFF":
                            IngestionService.latest_reading["state"] = "STOPPED"
                            IngestionService.latest_reading["indicator_light"] = "RED"
                        elif rem_status in ["SLOW", "REDUCED_SPEED"] or IngestionService.latest_reading["commanded_speed_pct"] <= 55.0:
                            IngestionService.latest_reading["state"] = "REDUCED_SPEED"
                            IngestionService.latest_reading["indicator_light"] = "AMBER"
                        else:
                            IngestionService.latest_reading["state"] = "NORMAL"
                            IngestionService.latest_reading["indicator_light"] = "GREEN"

            return {
                "endpoint": target_url,
                "http_status": resp.status_code,
                "success": resp.status_code < 400,
                "response": res_data
            }
    except Exception as e:
        return {
            "endpoint": target_url,
            "error": str(e),
            "note": "Remote vendor host unreachable or returned connection error."
        }
