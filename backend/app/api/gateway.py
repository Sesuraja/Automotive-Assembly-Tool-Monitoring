import base64
import struct
import numpy as np
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.schemas.pydantic_models import IngestPayload, MotorData, VibrationFeatures
from backend.app.services.ingestion_service import IngestionService
from backend.app.config import settings
from simulator.virtual_rig import simulator_rig

router = APIRouter(prefix="/gateway/ble", tags=["BLE Gateway"])

# In-memory registry of active BLE Gateways
_active_gateways: Dict[str, Dict[str, Any]] = {
    "gw-ble-01": {
        "id": "gw-ble-01",
        "name": "Line 04 Nutrunner Station Gateway",
        "mac_address": "AC:23:3F:88:D1:05",
        "ip_address": "192.168.4.150",
        "status": "online",
        "station_id": "station-A",
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "packets_received": 1,
        "packets_dropped": 0,
        "avg_rssi": -56.0,
        "battery_pct": 98.0,
        "firmware_version": "v2.4.1-ble-industrial",
        "api_endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry"
    }
}

class BleGatewayTelemetry(BaseModel):
    gateway_id: str = Field(default="gw-ble-01", description="Unique gateway identifier or MAC")
    device_mac: str = Field(default="C4:4F:33:18:9A:2B", description="BLE Sensor Node MAC Address")
    station_id: str = Field(default="station-A", description="Mapped Production Station")
    seq: int = Field(default=1, description="Sequential packet counter")
    sample_rate_hz: int = Field(default=1000, description="Vibration sampling rate")
    rssi: float = Field(default=-58.0, description="Received signal strength indicator in dBm")
    battery_pct: float = Field(default=98.0, description="Sensor node battery remaining percentage")
    raw_samples: Optional[List[float]] = Field(default=None, description="Time-domain acceleration array in 'g'")
    raw_hex: Optional[str] = Field(default=None, description="Raw int16 hex payload from BLE characteristic")
    raw_base64: Optional[str] = Field(default=None, description="Base64 encoded binary acceleration data")
    motor_rpm: Optional[float] = Field(default=2980.0, description="Measured spindle speed in RPM")
    motor_commanded_pct: Optional[float] = Field(default=100.0, description="PLC commanded speed percentage")
    motor_current_a: Optional[float] = Field(default=4.2, description="Motor current in Amperes")

class BleTestPingRequest(BaseModel):
    gateway_id: str = "gw-ble-01"
    device_mac: str = "C4:4F:33:18:9A:2B"
    station_id: str = "station-A"
    test_scenario: str = "normal" # "normal" or "fault_180hz"
    amplitude: float = 0.25 # g
    frequency: float = 180.0 # Hz
    motor_rpm: float = 2985.0

@router.post("/telemetry")
async def ingest_ble_gateway_telemetry(
    payload: BleGatewayTelemetry,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Dedicated BLE Gateway Ingestion API.
    Accepts real-time vibration and telemetry streams from physical BLE gateways
    (e.g., Minew, Cassia, Laird, Nordic nRF, ESP32, Teltonika).
    
    Processes the raw acceleration signal through the ML feature extractor and
    dual-layer safety machine, returning real-time feedback for the tool/actuator.
    """
    now = datetime.now(timezone.utc)
    gw_id = payload.gateway_id
    client_ip = request.client.host if request.client else "192.168.4.150"

    # Track / Register Gateway
    if gw_id not in _active_gateways:
        _active_gateways[gw_id] = {
            "id": gw_id,
            "name": f"BLE Gateway ({gw_id})",
            "mac_address": payload.device_mac,
            "ip_address": client_ip,
            "status": "online",
            "station_id": payload.station_id,
            "last_seen": now.isoformat(),
            "packets_received": 0,
            "packets_dropped": 0,
            "avg_rssi": payload.rssi,
            "battery_pct": payload.battery_pct,
            "firmware_version": "v2.4.1-ble-industrial",
            "api_endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry"
        }
    
    gw = _active_gateways[gw_id]
    gw["last_seen"] = now.isoformat()
    gw["packets_received"] += 1
    gw["avg_rssi"] = round(gw["avg_rssi"] * 0.9 + payload.rssi * 0.1, 1)
    gw["battery_pct"] = payload.battery_pct
    gw["status"] = "online"

    # Extract or decode raw vibration window
    samples: List[float] = []
    if payload.raw_samples and len(payload.raw_samples) > 0:
        samples = payload.raw_samples
    elif payload.raw_hex:
        try:
            raw_bytes = bytes.fromhex(payload.raw_hex)
            # Unpack 16-bit signed integers (int16), scaled to 'g' (e.g. 1 LSB = 0.001g)
            count = len(raw_bytes) // 2
            int16_vals = struct.unpack(f"<{count}h", raw_bytes[:count*2])
            samples = [round(v / 1000.0, 4) for v in int16_vals]
        except Exception:
            samples = []
    elif payload.raw_base64:
        try:
            raw_bytes = base64.b64decode(payload.raw_base64)
            count = len(raw_bytes) // 2
            int16_vals = struct.unpack(f"<{count}h", raw_bytes[:count*2])
            samples = [round(v / 1000.0, 4) for v in int16_vals]
        except Exception:
            samples = []

    # If samples array is empty, keep empty - do not generate synthetic demo noise
    if not samples:
        samples = []

    # Assemble hardware-agnostic IngestPayload
    motor_info = MotorData(
        commanded_pct=payload.motor_commanded_pct or 100.0,
        measured_rpm=payload.motor_rpm or 2980.0,
        current_amps=payload.motor_current_a or 4.2
    )

    ingest_contract = IngestPayload(
        device_id=payload.device_mac,
        station_id=payload.station_id,
        ts=now,
        seq=payload.seq,
        sample_rate_hz=payload.sample_rate_hz,
        window=samples,
        axes="xyz",
        motor=motor_info,
        battery_pct=payload.battery_pct,
        rssi=payload.rssi
    )

    # Process via Ingestion Service (extracts FFT, evaluates AI score, evaluates dual-layer safety engine)
    feedback = await IngestionService.process_payload(ingest_contract, db=db)

    # Return industrial actuation response
    return {
        "status": "success",
        "gateway_id": gw_id,
        "device_mac": payload.device_mac,
        "station_id": payload.station_id,
        "seq": payload.seq,
        "state": feedback.get("state", "NORMAL"),
        "commanded_speed_pct": feedback.get("commanded_speed_pct", 100.0),
        "indicator_light": feedback.get("indicator_light", "GREEN"),
        "anomaly_score": feedback.get("anomaly_score", 0.0),
        "decision_reason": feedback.get("last_decision_reason", "Nominal operation within limits."),
        "layer_caused": feedback.get("layer_caused", "NONE"),
        "action_required": feedback.get("state") in ["REDUCED_SPEED", "STOPPED"],
        "timestamp": now.isoformat()
    }

@router.get("/telemetry")
def get_ble_gateway_telemetry():
    """
    Returns latest telemetry snapshot or connection guidance when requested via GET.
    """
    if IngestionService.latest_reading:
        return IngestionService.latest_reading
    return {
        "status": "online",
        "endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry",
        "method_expected": "POST",
        "message": "BLE gateway telemetry endpoint is operational. Push sensor packets via POST, or poll live data via /api/v1/vibration/live.",
        "sample_rate_hz": 1000
    }

@router.get("/gateways")
def list_ble_gateways():
    """
    Returns list of all active BLE gateways, connection health, and transmission metrics.
    """
    return list(_active_gateways.values())

@router.post("/test-ping")
async def trigger_ble_test_ping(req: BleTestPingRequest, db: Session = Depends(get_db)):
    """
    Interactive Verification Ping: Sends an authentic 1000-point vibration packet
    simulating a BLE node transmission to test the API and verify safety machine reaction.
    """
    t = np.linspace(0, 0.999, 1000)
    if req.test_scenario == "fault_180hz":
        # Inject fault at specified frequency (e.g. 180 Hz exciter resonance)
        amp = req.amplitude
        f = req.frequency
        sig = amp * np.sin(2 * np.pi * f * t) + 0.3 * amp * np.sin(4 * np.pi * f * t)
        sig += np.random.normal(0.0, 0.05, 1000)
    else:
        # Normal steady-state operation with motor shaft harmonics
        f_shaft = req.motor_rpm / 60.0
        sig = 0.15 * np.sin(2 * np.pi * f_shaft * t) + 0.08 * np.sin(4 * np.pi * f_shaft * t)
        sig += np.random.normal(0.0, 0.035, 1000)

    samples = [round(float(s), 4) for s in sig]
    
    gw_payload = BleGatewayTelemetry(
        gateway_id=req.gateway_id,
        device_mac=req.device_mac,
        station_id=req.station_id,
        seq=int(datetime.now(timezone.utc).timestamp()),
        sample_rate_hz=1000,
        rssi=-54.0,
        battery_pct=98.5,
        raw_samples=samples,
        motor_rpm=req.motor_rpm,
        motor_commanded_pct=100.0,
        motor_current_a=4.1
    )

    now = datetime.now(timezone.utc)
    if req.gateway_id in _active_gateways:
        _active_gateways[req.gateway_id]["last_seen"] = now.isoformat()
        _active_gateways[req.gateway_id]["packets_received"] += 1

    motor_info = MotorData(commanded_pct=100.0, measured_rpm=req.motor_rpm, current_amps=4.1)
    ingest_contract = IngestPayload(
        device_id=req.device_mac,
        station_id=req.station_id,
        ts=now,
        seq=gw_payload.seq,
        sample_rate_hz=1000,
        window=samples,
        axes="xyz",
        motor=motor_info,
        battery_pct=98.5,
        rssi=-54.0
    )

    feedback = await IngestionService.process_payload(ingest_contract, db=db)
    return {
        "status": "success",
        "message": f"BLE Test Packet Ingested ({req.test_scenario})",
        "payload_samples_count": len(samples),
        "feedback": feedback
    }

@router.get("/docs")
def get_ble_gateway_docs():
    """
    Returns API connection specification and sample integration code for BLE gateways.
    """
    return {
        "endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer <JWT_TOKEN>"
        },
        "sample_curl": (
            f"curl -X POST http://localhost:8000{settings.API_V1_STR}/gateway/ble/telemetry \\\n"
            "  -H 'Content-Type: application/json' \\\n"
            "  -d '{\n"
            '    "gateway_id": "gw-ble-01",\n'
            '    "device_mac": "C4:4F:33:18:9A:2B",\n'
            '    "station_id": "station-A",\n'
            '    "seq": 1001,\n'
            '    "sample_rate_hz": 1000,\n'
            '    "rssi": -58.0,\n'
            '    "battery_pct": 98.0,\n'
            '    "raw_samples": [0.012, -0.024, 0.035, 0.018],\n'
            '    "motor_rpm": 2980.0,\n'
            '    "motor_commanded_pct": 100.0\n'
            "  }'"
        ),
        "sample_python": (
            "import requests\n"
            "import json\n\n"
            f"URL = 'http://localhost:8000{settings.API_V1_STR}/gateway/ble/telemetry'\n\n"
            "payload = {\n"
            "    'gateway_id': 'gw-ble-01',\n"
            "    'device_mac': 'C4:4F:33:18:9A:2B',\n"
            "    'station_id': 'station-A',\n"
            "    'seq': 1001,\n"
            "    'sample_rate_hz': 1000,\n"
            "    'rssi': -58.0,\n"
            "    'battery_pct': 98.0,\n"
            "    'raw_samples': [0.01] * 1000,\n"
            "    'motor_rpm': 2980.0\n"
            "}\n\n"
            "resp = requests.post(URL, json=payload)\n"
            "control = resp.json()\n"
            "print('Station State:', control['state'])\n"
            "print('Commanded Speed %:', control['commanded_speed_pct'])\n"
            "print('Indicator Light:', control['indicator_light'])\n"
        )
    }

# =========================================================================
# VENDOR BLE GATEWAY API INTEGRATION (Cassia, Minew, Nordic, Teltonika, etc.)
# =========================================================================

from backend.app.models.schema import VendorGatewayConfig
import httpx
import time

class VendorGatewayConfigRequest(BaseModel):
    name: str = Field(default="Primary Industrial BLE Gateway", description="Friendly gateway name")
    vendor_type: str = Field(default="GenericREST", description="Vendor protocol (Cassia, Minew, Nordic, Teltonika, GenericREST)")
    api_url: Optional[str] = Field(default="", description="Vendor gateway REST endpoint or polling URL")
    api_key: Optional[str] = Field(default="", description="API Bearer Token or Gateway Secret Key")
    poll_interval_sec: float = Field(default=1.0, description="Background polling interval in seconds")
    station_id: str = Field(default="station-A", description="Target manufacturing station")
    mac_filter: Optional[str] = Field(default="C4:4F:33:18:9A:2B", description="Sensor MAC address filter")
    is_active: bool = Field(default=False, description="Enable active background polling")

@router.get("/vendor/config")
def get_vendor_gateway_config(db: Session = Depends(get_db)):
    """
    Retrieves the persistent Vendor BLE Gateway configuration from the database.
    """
    cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
    if not cfg:
        # Seed from settings / environment variables if not yet present in DB
        cfg = VendorGatewayConfig(
            id="default-vendor-gateway",
            name="Primary Industrial BLE Gateway",
            vendor_type=settings.VENDOR_BLE_GATEWAY_TYPE or "GenericREST",
            api_url=settings.VENDOR_BLE_GATEWAY_URL or "",
            api_key=settings.VENDOR_BLE_GATEWAY_API_KEY or "",
            poll_interval_sec=settings.VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC or 1.0,
            station_id="station-A",
            mac_filter="C4:4F:33:18:9A:2B",
            is_active=settings.VENDOR_BLE_GATEWAY_AUTO_POLL or False,
            last_status="unconfigured",
            packets_received=0
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    return {
        "id": cfg.id,
        "name": cfg.name,
        "vendor_type": cfg.vendor_type,
        "api_url": cfg.api_url or "",
        "api_key": cfg.api_key or "",
        "poll_interval_sec": cfg.poll_interval_sec,
        "station_id": cfg.station_id,
        "mac_filter": cfg.mac_filter or "",
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync.isoformat() if cfg.last_sync else None,
        "last_status": cfg.last_status,
        "last_error": cfg.last_error,
        "packets_received": cfg.packets_received,
        "env_vendor_api_base_url": settings.VENDOR_API_BASE_URL,
        "env_vendor_ble_gateway_url": settings.VENDOR_BLE_GATEWAY_URL,
        "webhook_url": f"http://localhost:8000{settings.API_V1_STR}/gateway/ble/vendor/webhook"
    }

@router.post("/vendor/config")
def update_vendor_gateway_config(
    payload: VendorGatewayConfigRequest,
    db: Session = Depends(get_db)
):
    """
    Persists updated Vendor BLE Gateway connection details into the database.
    """
    cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
    if not cfg:
        cfg = VendorGatewayConfig(id="default-vendor-gateway")
        db.add(cfg)

    cfg.name = payload.name
    cfg.vendor_type = payload.vendor_type
    cfg.api_url = payload.api_url
    cfg.api_key = payload.api_key
    cfg.poll_interval_sec = payload.poll_interval_sec
    cfg.station_id = payload.station_id
    cfg.mac_filter = payload.mac_filter
    cfg.is_active = payload.is_active
    cfg.updated_at = datetime.utcnow()
    cfg.last_status = "configured" if payload.api_url else "unconfigured"

    db.commit()
    db.refresh(cfg)
    return {
        "status": "success",
        "message": "Vendor BLE Gateway configuration saved to database successfully",
        "config": {
            "id": cfg.id,
            "name": cfg.name,
            "vendor_type": cfg.vendor_type,
            "api_url": cfg.api_url,
            "poll_interval_sec": cfg.poll_interval_sec,
            "station_id": cfg.station_id,
            "is_active": cfg.is_active,
            "last_status": cfg.last_status
        }
    }

@router.post("/vendor/reset-to-env")
def reset_vendor_gateway_to_env(db: Session = Depends(get_db)):
    """
    Resets the Vendor BLE Gateway configuration directly back to values defined in .env / system settings.
    """
    cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
    if not cfg:
        cfg = VendorGatewayConfig(id="default-vendor-gateway")
        db.add(cfg)

    cfg.name = "Primary Industrial BLE Gateway"
    cfg.vendor_type = settings.VENDOR_BLE_GATEWAY_TYPE or "GenericREST"
    cfg.api_url = settings.VENDOR_BLE_GATEWAY_URL or f"{settings.VENDOR_API_BASE_URL.rstrip('/')}/api/simulation/hardware"
    cfg.api_key = settings.VENDOR_BLE_GATEWAY_API_KEY or ""
    cfg.poll_interval_sec = settings.VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC or 1.0
    cfg.station_id = "station-A"
    cfg.mac_filter = "C4:4F:33:18:9A:2B"
    cfg.is_active = True
    cfg.updated_at = datetime.utcnow()
    cfg.last_status = "configured"
    cfg.last_error = None

    db.commit()
    db.refresh(cfg)
    return {
        "status": "success",
        "message": "Vendor Gateway configuration successfully reset to .env environment settings",
        "config": {
            "id": cfg.id,
            "name": cfg.name,
            "vendor_type": cfg.vendor_type,
            "api_url": cfg.api_url,
            "poll_interval_sec": cfg.poll_interval_sec,
            "station_id": cfg.station_id,
            "is_active": cfg.is_active,
            "last_status": cfg.last_status
        }
    }

@router.post("/vendor/sync-now")
async def trigger_vendor_gateway_sync(db: Session = Depends(get_db)):
    """
    Executes an immediate live connection check and ingestion fetch against the configured
    Vendor BLE Gateway API endpoint. Returns latency, response, and control actuation.
    """
    cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
    if not cfg or not cfg.api_url:
        return {
            "status": "warning",
            "message": "Vendor Gateway API URL is not configured. Please enter the Vendor Gateway Endpoint in the form above.",
            "latency_ms": 0,
            "http_status": None,
            "packets_received": cfg.packets_received if cfg else 0
        }


    url = cfg.api_url.strip()
    from backend.app.config import get_vendor_auth_cookie
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Aperture-Tool-Monitor/1.0"
    }
    cookie_token = get_vendor_auth_cookie()
    if cookie_token:
        headers["Cookie"] = cookie_token
    elif cfg.api_key:
        raw_key = cfg.api_key.strip()
        if "=" in raw_key and (";" in raw_key or raw_key.startswith("__") or " " in raw_key):
            headers["Cookie"] = raw_key
        else:
            headers["Authorization"] = f"Bearer {raw_key}"
            headers["X-API-Key"] = raw_key

    t_start = time.time()
    now = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            latency_ms = round((time.time() - t_start) * 1000, 1)

            if resp.status_code == 200:
                content_type = resp.headers.get("content-type", "")
                if "json" not in content_type and resp.text.strip().startswith("<"):
                    return {
                        "status": "warning",
                        "message": "Remote host returned HTML warmup page instead of JSON telemetry. Retrying...",
                        "latency_ms": latency_ms,
                        "http_status": 200
                    }
                data = resp.json()
                
                # Unwrap nested wrapper keys if present
                content = data
                if isinstance(content, dict):
                    for wrapper_key in ["data", "readings", "telemetry", "result", "payload"]:
                        if wrapper_key in content and isinstance(content[wrapper_key], (dict, list)):
                            content = content[wrapper_key]
                            break

                samples: List[float] = []
                features_obj: Optional[VibrationFeatures] = None
                rpm: float = 2980.0
                commanded_pct: float = 100.0
                current_amps: float = 4.2
                battery_pct: float = 98.0
                rssi_val: float = -58.0
                device_id_val: str = cfg.mac_filter or "C4:4F:33:18:9A:2B"
                station_id_val: str = cfg.station_id or "station-A"

                # 1. Parse arrays of samples or dicts
                if isinstance(content, list):
                    if len(content) > 0:
                        if isinstance(content[0], (int, float)):
                            samples = [float(v) for v in content]
                        elif isinstance(content[0], dict):
                            # List of measurement dicts
                            for item in content:
                                for ax in ["x", "acc_x_g", "acc_x", "y", "acc_y_g", "acc_y", "z", "acc_z_g", "acc_z"]:
                                    if ax in item and isinstance(item[ax], (int, float)):
                                        samples.append(float(item[ax]))
                elif isinstance(content, dict):
                    # Direct Cloud Run /api/simulation/hardware full sensors structure
                    if "virtual_sensors" in content:
                        vs = content["virtual_sensors"]
                        acc = vs.get("accelerometer", {})
                        tach = vs.get("tachometer", {})
                        curr = vs.get("current_sensor", {})
                        ble_gw = vs.get("ble_gateway", {})
                        vmot = content.get("virtual_motor", {})

                        ax = float(acc.get("acc_x_g", 0.0))
                        ay = float(acc.get("acc_y_g", 0.0))
                        az = float(acc.get("acc_z_g", 1.0))
                        rms_val = float(acc.get("rms_g", 0.12))
                        raw_peak = float(acc.get("peak_g", 0.85))
                        # Detrend 1g DC gravity from dynamic peak for vibration analysis
                        peak_val = min(raw_peak, max(0.008, rms_val * 2.2)) if rms_val < 0.25 else raw_peak
                        samples = [ax, ay, az - 1.0 if abs(az - 1.0) < 0.3 else az] * 10

                        if "measured_rpm" in tach:
                            rpm = float(tach["measured_rpm"])
                        elif "rpm" in vmot:
                            rpm = float(vmot["rpm"])

                        raw_cmd_rpm = float(tach.get("commanded_rpm", vmot.get("target_rpm", 12000.0)))
                        if raw_cmd_rpm > 4000.0:
                            commanded_pct = min(100.0, (raw_cmd_rpm / 12000.0) * 100.0)
                        elif raw_cmd_rpm > 1800.0:
                            commanded_pct = min(100.0, (raw_cmd_rpm / 3000.0) * 100.0)
                        elif raw_cmd_rpm > 0.0:
                            commanded_pct = min(100.0, (raw_cmd_rpm / 1500.0) * 100.0)
                        else:
                            commanded_pct = 0.0

                        current_amps = float(curr.get("current_a", 68.0))
                        battery_pct = 98.0
                        if "rssi" in ble_gw:
                            rssi_val = float(ble_gw["rssi"])
                        if "mac" in ble_gw:
                            device_id_val = str(ble_gw["mac"])

                        fault_label = str(content.get("active_fault", "NONE")).upper()
                        if "anomaly_score" in content and content["anomaly_score"] is not None:
                            host_score = float(content["anomaly_score"])
                        elif fault_label in ["NONE", "NORMAL", ""]:
                            host_score = 0.042
                        else:
                            host_score = 0.85

                        host_status = str(vmot.get("status", "RUNNING"))
                        if fault_label in ["NONE", "NORMAL", ""]:
                            host_decision = "NORMAL" if host_status == "RUNNING" else ("STOP" if host_status == "OFF" else "NORMAL")
                        else:
                            host_decision = "ALERT"

                        features_obj = VibrationFeatures(
                            rms=rms_val,
                            peak=peak_val,
                            peak_to_peak=round(peak_val * 1.95, 4),
                            crest_factor=round(peak_val / max(rms_val, 0.001), 2),
                            kurtosis=2.8,
                            dominant_freq=float(tach.get("frequency_hz", rpm / 60.0 if rpm > 15.0 else 50.0)),
                            spectral_centroid=round(float(tach.get("frequency_hz", rpm / 60.0 if rpm > 15.0 else 50.0)) * 1.05, 1),
                            band_energies={
                                "0_50Hz": round(rms_val * 0.10, 4),
                                "50_150Hz": round(rms_val * 0.15, 4),
                                "150_300Hz": round(rms_val * 0.55, 4),
                                "300_500Hz": round(rms_val * 0.20, 4),
                            }
                        )

                    # GAO packet support: "msg": "advData", "obj": [...]
                    if "obj" in content and isinstance(content["obj"], list):
                        for item in content["obj"]:
                            if isinstance(item, dict):
                                for ax in ["x", "y", "z"]:
                                    if ax in item:
                                        samples.append(float(item[ax]))
                                if "rssi" in item:
                                    rssi_val = float(item["rssi"])
                                if "vbatt" in item:
                                    battery_pct = round((float(item["vbatt"]) / 3300.0) * 100, 1)
                                if "dmac" in item:
                                    device_id_val = str(item["dmac"])

                    for k in ["raw_samples", "samples", "window", "waveform"]:
                        if k in content and isinstance(content[k], list):
                            samples = [float(v) for v in content[k] if isinstance(v, (int, float))]
                            break

                    # Check for direct accelerometer scalar values if sample list is not provided
                    if not samples:
                        x_val = content.get("acc_x_g") if "acc_x_g" in content else content.get("x")
                        y_val = content.get("acc_y_g") if "acc_y_g" in content else content.get("y")
                        z_val = content.get("acc_z_g") if "acc_z_g" in content else content.get("z")
                        if x_val is not None or y_val is not None:
                            samples = [float(x_val or 0.0), float(y_val or 0.0), float(z_val or 0.0)]

                    # Check for direct vibration features in host payload
                    feat_source = content.get("features") if isinstance(content.get("features"), dict) else content
                    if any(k in feat_source for k in ["rms", "rms_g", "vibration_rms", "peak", "peak_g", "kurtosis"]):
                        rms_v = float(feat_source.get("rms_g") or feat_source.get("rms") or feat_source.get("vibration_rms") or 0.0)
                        peak_v = float(feat_source.get("peak_g") or feat_source.get("peak") or (rms_v * 1.414))
                        crest_v = float(feat_source.get("crest_factor") or (peak_v / max(rms_v, 0.001)))
                        kurt_v = float(feat_source.get("kurtosis") or 2.8)
                        dom_freq_v = float(feat_source.get("dominant_freq") or feat_source.get("dominant_freq_hz") or (rpm / 60.0 if rpm > 15.0 else 50.0))
                        spec_centroid_v = float(feat_source.get("spectral_centroid") or (dom_freq_v * 1.05))
                        peak_to_peak_v = float(feat_source.get("peak_to_peak") or (peak_v * 1.95))
                        band_energies = {
                            "0_50Hz": round(rms_v * 0.10, 4),
                            "50_150Hz": round(rms_v * 0.15, 4),
                            "150_300Hz": round(rms_v * 0.55, 4),
                            "300_500Hz": round(rms_v * 0.20, 4),
                        }
                        features_obj = VibrationFeatures(
                            rms=rms_v,
                            peak=peak_v,
                            peak_to_peak=peak_to_peak_v,
                            crest_factor=crest_v,
                            kurtosis=kurt_v,
                            dominant_freq=dom_freq_v,
                            spectral_centroid=spec_centroid_v,
                            band_energies=band_energies
                        )

                    # Extract motor parameters
                    motor_source = content.get("motor") if isinstance(content.get("motor"), dict) else content
                    if "measured_rpm" in motor_source:
                        rpm = float(motor_source["measured_rpm"])
                    elif "rpm" in motor_source:
                        rpm = float(motor_source["rpm"])
                    elif "speed" in motor_source:
                        rpm = float(motor_source["speed"])

                    if "commanded_pct" in motor_source:
                        commanded_pct = float(motor_source["commanded_pct"])
                    elif "commanded_speed_pct" in motor_source:
                        commanded_pct = float(motor_source["commanded_speed_pct"])

                    if "current_amps" in motor_source:
                        current_amps = float(motor_source["current_amps"])
                    elif "current" in motor_source:
                        current_amps = float(motor_source["current"])
                    elif "current_a" in motor_source:
                        current_amps = float(motor_source["current_a"])

                    # Extract sensor node metadata
                    temp_c = float(content.get("temperature_c") or content.get("temperature") or 26.5)

                    if "battery_pct" in content:
                        battery_pct = float(content["battery_pct"])
                    elif "battery" in content:
                        battery_pct = float(content["battery"])
                    elif "battery_mv" in content:
                        battery_pct = round((float(content["battery_mv"]) / 3300.0) * 100, 1)
                    elif "vbatt" in content:
                        battery_pct = round((float(content["vbatt"]) / 3300.0) * 100, 1)

                    if "rssi" in content:
                        rssi_val = float(content["rssi"])
                    elif "rssi_dbm" in content:
                        rssi_val = float(content["rssi_dbm"])

                    if "device_id" in content:
                        device_id_val = str(content["device_id"])
                    elif "device_mac" in content:
                        device_id_val = str(content["device_mac"])
                    if "station_id" in content:
                        station_id_val = str(content["station_id"])

                    if "host_status" not in locals() or host_status is None:
                        host_status = None
                    if "host_decision" not in locals() or host_decision is None:
                        host_decision = None
                    if "host_score" not in locals() or host_score is None:
                        host_score = None
                    # Always query motor/status endpoint on same host to get official motor status & decision
                    if "/api/vibration/live" in url:
                        try:
                            motor_url = url.replace("/api/vibration/live", "/api/motor/status")
                            resp_mot = await client.get(motor_url, headers=headers)
                            if resp_mot.status_code == 200:
                                mot_json = resp_mot.json()
                                if "measured_rpm" in mot_json:
                                    rpm = float(mot_json["measured_rpm"])
                                elif "rpm" in mot_json:
                                    rpm = float(mot_json["rpm"])
                                if "commanded_rpm" in mot_json and mot_json["commanded_rpm"] is not None:
                                    raw_cmd_rpm = float(mot_json["commanded_rpm"])
                                    rated_ref = max(100.0, getattr(simulator_rig.motor, "rated_rpm", getattr(simulator_rig.motor, "max_rpm", 1500.0)))
                                    commanded_pct = min(100.0, (raw_cmd_rpm / rated_ref) * 100.0) if raw_cmd_rpm > 0.0 else 0.0
                                if "current_a" in mot_json and mot_json["current_a"] is not None:
                                    current_amps = float(mot_json["current_a"])
                                elif "current" in mot_json and mot_json["current"] is not None:
                                    current_amps = float(mot_json["current"])
                                host_status = mot_json.get("status") or mot_json.get("operational_status")
                                host_decision = mot_json.get("decision")
                                if host_decision in ["REDUCE_SPEED", "REDUCED_SPEED", "SLOW"] or commanded_pct <= 55.0:
                                    if host_status != "OFF":
                                        host_status = "SLOW"
                                if "anomaly_score" in mot_json and mot_json["anomaly_score"] is not None:
                                    host_score = float(mot_json["anomaly_score"])
                        except Exception:
                            pass

                # If the host provided neither samples nor features, do NOT add demo data
                if not samples and features_obj is None:
                    return {
                        "status": "warning",
                        "message": f"Host URL connected successfully (HTTP {resp.status_code}), but provided no vibration readings or features. Demo data injection disabled.",
                        "http_status": resp.status_code,
                        "latency_ms": latency_ms,
                        "host_payload": data
                    }

                # Ingest through feature extractor and safety machine using whatever the host provided
                motor_info = MotorData(commanded_pct=commanded_pct, measured_rpm=rpm, current_amps=current_amps)
                ingest_contract = IngestPayload(
                    device_id=device_id_val,
                    station_id=station_id_val,
                    ts=now,
                    seq=int(now.timestamp()),
                    sample_rate_hz=1000,
                    window=samples if len(samples) >= 16 else None,
                    features=features_obj,
                    axes="xyz",
                    motor=motor_info,
                    battery_pct=battery_pct,
                    rssi=rssi_val,
                    temperature=temp_c,
                    status=host_status,
                    decision=host_decision,
                    anomaly_score=host_score
                )
                feedback = await IngestionService.process_payload(ingest_contract, db=db)

                cfg.last_sync = datetime.utcnow()
                cfg.last_status = "connected"
                cfg.last_error = None
                cfg.packets_received += 1
                db.commit()

                # Update live active gateway state
                gw_entry = _active_gateways.get("gw-ble-01")
                if gw_entry:
                    gw_entry["last_seen"] = now.isoformat()
                    gw_entry["packets_received"] = cfg.packets_received
                    gw_entry["mac_address"] = device_id_val
                    gw_entry["avg_rssi"] = rssi_val
                    gw_entry["battery_pct"] = battery_pct
                    gw_entry["status"] = "online"

                return {
                    "status": "success",
                    "message": f"Successfully connected to Vendor Gateway at {url}",
                    "http_status": resp.status_code,
                    "latency_ms": latency_ms,
                    "samples_ingested": len(samples),
                    "actuation": feedback
                }
            else:
                cfg.last_status = "error"
                cfg.last_error = f"HTTP {resp.status_code}: {resp.text[:120]}"
                db.commit()
                return {
                    "status": "error",
                    "message": f"Vendor API responded with error status HTTP {resp.status_code}",
                    "http_status": resp.status_code,
                    "latency_ms": latency_ms,
                    "error_body": resp.text[:200]
                }
    except Exception as e:
        latency_ms = round((time.time() - t_start) * 1000, 1)
        cfg.last_status = "unreachable"
        cfg.last_error = str(e)[:150]
        db.commit()
        return {
            "status": "error",
            "message": f"Unable to reach vendor gateway endpoint: {str(e)}",
            "latency_ms": latency_ms,
            "http_status": None,
            "error_detail": str(e)
        }

class TestVendorUrlRequest(BaseModel):
    api_url: str = Field(..., description="Target vendor API URL to probe")
    api_key: Optional[str] = Field(default=None, description="Optional bearer token or API key")
    vendor_type: Optional[str] = Field(default="GenericREST", description="Vendor protocol format")

@router.post("/vendor/test-endpoint")
async def test_vendor_endpoint(req: TestVendorUrlRequest):
    """
    Directly tests reachability, latency, and response schema of an arbitrary Vendor BLE Gateway URL.
    Returns latency, HTTP status code, response preview, and detected telemetry fields.
    """
    url = req.api_url.strip()
    if not url:
        return {
            "status": "error",
            "message": "Vendor API URL is required",
            "http_status": None,
            "latency_ms": 0
        }

    headers = {"Content-Type": "application/json", "User-Agent": "Aperture-Tool-Monitor-Gateway/1.0"}
    from backend.app.config import get_vendor_auth_cookie
    cookie_token = req.api_key.strip() if req.api_key else get_vendor_auth_cookie()
    if cookie_token:
        if "=" in cookie_token and (";" in cookie_token or "__" in cookie_token or "GAESA" in cookie_token or "cookie" in cookie_token.lower()):
            headers["Cookie"] = cookie_token
        else:
            headers["Authorization"] = f"Bearer {cookie_token}"
            headers["X-API-Key"] = cookie_token

    t_start = time.time()
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            latency_ms = round((time.time() - t_start) * 1000, 1)

            data_preview = None
            is_json = False
            detected_samples = 0
            try:
                data = resp.json()
                is_json = True
                if isinstance(data, dict):
                    if "virtual_sensors" in data:
                        detected_samples = 3
                        data_preview = {
                            "virtual_sensors": list(data["virtual_sensors"].keys()),
                            "virtual_motor": data.get("virtual_motor"),
                            "tachometer": data["virtual_sensors"].get("tachometer"),
                            "accelerometer": data["virtual_sensors"].get("accelerometer")
                        }
                    else:
                        data_preview = {k: (f"[{len(v)} items]" if isinstance(v, list) else v) for k, v in list(data.items())[:8]}
                        for k in ("raw_samples", "samples", "window", "data"):
                            if k in data and isinstance(data[k], list):
                                detected_samples = len(data[k])
                                break
                elif isinstance(data, list):
                    detected_samples = len(data)
                    data_preview = f"Array with {len(data)} items: {data[:5]}"
            except Exception:
                data_preview = resp.text[:250]

            return {
                "status": "success" if resp.status_code == 200 else "warning" if resp.status_code < 500 else "error",
                "http_status": resp.status_code,
                "latency_ms": latency_ms,
                "is_json": is_json,
                "detected_samples": detected_samples,
                "data_preview": data_preview,
                "message": f"Connected to {url} (HTTP {resp.status_code}) in {latency_ms}ms" if resp.status_code == 200 else f"Endpoint returned HTTP {resp.status_code} in {latency_ms}ms"
            }
    except Exception as e:
        latency_ms = round((time.time() - t_start) * 1000, 1)
        return {
            "status": "error",
            "message": f"Failed to connect to endpoint: {str(e)}",
            "http_status": None,
            "latency_ms": latency_ms,
            "error_detail": str(e)
        }

@router.post("/vendor/webhook")
async def vendor_gateway_inbound_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Inbound Webhook receiver for physical Vendor Gateways that push telemetry streams.
    Accepts vendor JSON payloads, extracts time/frequency features, evaluates AI anomaly scoring,
    and returns instantaneous motor speed commands (50% reduce or 0% stop if abnormal).
    """
    raw_json = await request.json()
    now = datetime.now(timezone.utc)

    # 1. Parse standard or vendor-specific data
    device_mac = "C4:4F:33:18:9A:2B"
    station_id = "station-A"
    rpm = 2980.0
    commanded_pct = 100.0
    rssi = -58.0
    battery = 98.0
    seq = int(now.timestamp())
    samples: List[float] = []

    if isinstance(raw_json, dict):
        device_mac = raw_json.get("device_mac") or raw_json.get("mac") or raw_json.get("node_id") or device_mac
        station_id = raw_json.get("station_id", "station-A")
        rssi = float(raw_json.get("rssi", -58.0))
        battery = float(raw_json.get("battery_pct", raw_json.get("battery", 98.0)))
        seq = int(raw_json.get("seq", seq))
        if "motor" in raw_json and isinstance(raw_json["motor"], dict):
            rpm = float(raw_json["motor"].get("measured_rpm", 2980.0))
            commanded_pct = float(raw_json["motor"].get("commanded_pct", 100.0))
        elif "motor_rpm" in raw_json:
            rpm = float(raw_json["motor_rpm"])

        if "raw_samples" in raw_json and isinstance(raw_json["raw_samples"], list):
            samples = raw_json["raw_samples"]
        elif "samples" in raw_json and isinstance(raw_json["samples"], list):
            samples = raw_json["samples"]
        elif "window" in raw_json and isinstance(raw_json["window"], list):
            samples = raw_json["window"]

        if not samples:
            x_val = raw_json.get("acc_x_g") if "acc_x_g" in raw_json else raw_json.get("x")
            y_val = raw_json.get("acc_y_g") if "acc_y_g" in raw_json else raw_json.get("y")
            z_val = raw_json.get("acc_z_g") if "acc_z_g" in raw_json else raw_json.get("z")
            if x_val is not None or y_val is not None:
                samples = [float(x_val or 0.0), float(y_val or 0.0), float(z_val or 0.0)]

    # Check for direct vibration features in host payload
    features_obj: Optional[VibrationFeatures] = None
    if isinstance(raw_json, dict):
        feat_source = raw_json.get("features") if isinstance(raw_json.get("features"), dict) else raw_json
        if any(k in feat_source for k in ["rms", "rms_g", "vibration_rms", "peak", "peak_g", "kurtosis"]):
            rms_v = float(feat_source.get("rms_g") or feat_source.get("rms") or feat_source.get("vibration_rms") or 0.0)
            peak_v = float(feat_source.get("peak_g") or feat_source.get("peak") or (rms_v * 1.414))
            crest_v = float(feat_source.get("crest_factor") or (peak_v / max(rms_v, 0.001)))
            kurt_v = float(feat_source.get("kurtosis") or 3.0)
            freq_v = float(feat_source.get("dominant_freq") or feat_source.get("dominant_freq_hz") or 50.0)
            features_obj = VibrationFeatures(
                rms=rms_v,
                peak=peak_v,
                crest_factor=crest_v,
                kurtosis=kurt_v,
                dominant_freq=freq_v
            )

    # Assemble contract using whatever host provided
    motor_info = MotorData(commanded_pct=commanded_pct, measured_rpm=rpm, current_amps=4.1)
    ingest_contract = IngestPayload(
        device_id=device_mac,
        station_id=station_id,
        ts=now,
        seq=seq,
        sample_rate_hz=1000,
        window=samples if samples else None,
        features=features_obj,
        axes="xyz",
        motor=motor_info,
        battery_pct=battery,
        rssi=rssi
    )

    feedback = await IngestionService.process_payload(ingest_contract, db=db)

    # Update vendor gateway stats in DB
    cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
    if cfg:
        cfg.last_sync = datetime.utcnow()
        cfg.packets_received += 1
        cfg.last_status = "connected"
        db.commit()

    return {
        "status": "success",
        "station_id": station_id,
        "state": feedback.get("state", "NORMAL"),
        "commanded_speed_pct": feedback.get("commanded_speed_pct", 100.0),
        "indicator_light": feedback.get("indicator_light", "GREEN"),
        "anomaly_score": feedback.get("anomaly_score", 0.0),
        "decision_reason": feedback.get("last_decision_reason", "Nominal operation within limits."),
        "action_required": feedback.get("state") in ["REDUCED_SPEED", "STOPPED"],
        "timestamp": now.isoformat()
    }

