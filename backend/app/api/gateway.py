import json
import base64
import struct
import collections
import numpy as np
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models.schema import SystemSetting, VendorGatewayConfig
from backend.app.schemas.pydantic_models import IngestPayload, MotorData, VibrationFeatures
from backend.app.services.ingestion_service import IngestionService
from backend.app.core.feature_extractor import extract_features
from backend.app.config import settings

router = APIRouter(prefix="/gateway/ble", tags=["BLE Gateway"])

# In-memory registry of active BLE Gateways - populated strictly from live API host URL
_active_gateways: Dict[str, Dict[str, Any]] = {}

# Live incoming packet memory buffer for real-time inspector
_latest_gateway_packet: Optional[Dict[str, Any]] = None
_incoming_packets_log: List[Dict[str, Any]] = []
_live_ble_samples_buffer = collections.deque(maxlen=1000)

# Live packet counters (Real-time in-memory streams, NOT stored DB lifetime counts)
_latest_batch_packets_count: int = 0
_live_session_packets_count: int = 0

# In-memory registry of active discovered BLE Sensor Devices (populated dynamically from live gateway)
_discovered_devices: Dict[str, Dict[str, Any]] = {}

async def sync_real_devices_from_vendor(db: Optional[Session] = None):
    """
    Connects to the real live Aperture BLE Gateway and dynamically registers
    all active industrial BLE sensor devices streaming advertisement packets.
    """
    global _discovered_devices, _active_gateways, _latest_batch_packets_count, _live_session_packets_count
    url = getattr(settings, "VENDOR_BLE_GATEWAY_URL", "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest")
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Aperture-Tool-Monitor/1.0", "Accept": "application/json"})
            if resp.status_code == 200:
                data = resp.json()
                content = data
                while isinstance(content, dict) and "data" in content and isinstance(content["data"], (dict, list)):
                    content = content["data"]

                objs = content.get("obj", []) if isinstance(content, dict) else []
                _latest_batch_packets_count = len(objs)
                _live_session_packets_count += len(objs)

                now_iso = datetime.now(timezone.utc).isoformat()
                gmac = content.get("gmac") if isinstance(content, dict) else None
                if gmac:
                    _active_gateways["gw-ble-01"] = {
                        "id": "gw-ble-01",
                        "name": f"Aperture Industrial Gateway ({gmac})",
                        "mac_address": gmac,
                        "gmac": gmac,
                        "ip_address": "gateway.apertureventurestudio.com",
                        "status": "online",
                        "station_id": "station-A",
                        "last_seen": now_iso,
                        "packets_received": _latest_batch_packets_count,
                        "latest_batch_packets": _latest_batch_packets_count,
                        "live_session_packets": _live_session_packets_count,
                        "packets_dropped": 0,
                        "avg_rssi": 0.0,
                        "battery_pct": 0.0,
                        "firmware_version": "v1.0.0",
                        "api_endpoint": url
                    }

                now_ts = datetime.now(timezone.utc).timestamp()
                live_dmacs_in_current_packet = set()
                for item in objs:
                    if not isinstance(item, dict):
                        continue
                    dmac = item.get("dmac")
                    if not dmac:
                        continue
                    live_dmacs_in_current_packet.add(dmac)
                    t = item.get("type", 4)
                    rssi_val = item.get("rssi")
                    time_val = item.get("time") or now_iso
                    dev_type = "Triaxial Accelerometer (Type 32)" if t == 32 else "Beacon Telemetry Node (Type 8)" if t == 8 else f"BLE Sensor Node (Type {t})"

                    if dmac not in _discovered_devices:
                        _discovered_devices[dmac] = {
                            "device_id": dmac,
                            "name": f"BLE Sensor {dmac}",
                            "station_id": "station-A",
                            "last_seen": time_val,
                            "_last_seen_ts": now_ts,
                            "packets_count": 1,
                            "rssi": float(rssi_val) if rssi_val is not None else 0.0,
                            "battery_pct": 0.0,
                            "temperature": 0.0,
                            "status": "online",
                            "device_type": dev_type,
                            "gateway_id": "gw-ble-01"
                        }
                    else:
                        dev = _discovered_devices[dmac]
                        dev["last_seen"] = time_val
                        dev["_last_seen_ts"] = now_ts
                        dev["packets_count"] += 1
                        dev["status"] = "online"
                        if rssi_val is not None:
                            try:
                                dev["rssi"] = float(rssi_val)
                            except (ValueError, TypeError):
                                pass

                    dev = _discovered_devices[dmac]
                    if "vbatt" in item and item["vbatt"] is not None:
                        try:
                            dev["battery_pct"] = round((float(item["vbatt"]) / 3300.0) * 100.0, 1)
                        except Exception:
                            pass
                    if "temp" in item and item["temp"] is not None:
                        try:
                            dev["temperature"] = float(item["temp"])
                        except Exception:
                            pass

                # Prune stale devices so discovered_devices strictly reflects live latest incoming devices (not stored historical data)
                cutoff = now_ts - 10.0
                stale_keys = [
                    k for k, d in _discovered_devices.items()
                    if k != gmac and d.get("_last_seen_ts", 0) < cutoff and k not in live_dmacs_in_current_packet
                ]
                for k in stale_keys:
                    _discovered_devices.pop(k, None)
    except Exception as e:
        print("[Gateway Live Sync Notice]", e)

def record_incoming_packet(
    source: str,
    device_id: str,
    payload_data: Dict[str, Any],
    feedback: Optional[Dict[str, Any]] = None,
    gateway_id: str = "gw-ble-01"
):
    global _latest_gateway_packet, _incoming_packets_log, _discovered_devices
    now_iso = datetime.now(timezone.utc).isoformat()
    entry = {
        "id": f"pkt-{int(datetime.now(timezone.utc).timestamp() * 1000) % 100000}",
        "timestamp": now_iso,
        "source": source,
        "device_id": device_id,
        "gateway_id": gateway_id,
        "payload": payload_data,
        "feedback": feedback or {}
    }
    _latest_gateway_packet = entry
    _incoming_packets_log.append(entry)
    if len(_incoming_packets_log) > 100:
        _incoming_packets_log = _incoming_packets_log[-100:]

    # Register or update discovered device
    now_ts = datetime.now(timezone.utc).timestamp()
    if device_id not in _discovered_devices:
        _discovered_devices[device_id] = {
            "device_id": device_id,
            "name": f"BLE Sensor Node ({device_id})",
            "station_id": payload_data.get("station_id", "station-A") if isinstance(payload_data, dict) else "station-A",
            "last_seen": now_iso,
            "_last_seen_ts": now_ts,
            "packets_count": 0,
            "rssi": 0.0,
            "battery_pct": 0.0,
            "temperature": 0.0,
            "status": "online",
            "device_type": "Triaxial Accelerometer",
            "gateway_id": gateway_id
        }

    dev = _discovered_devices[device_id]
    dev["last_seen"] = now_iso
    dev["_last_seen_ts"] = now_ts
    dev["packets_count"] += 1
    dev["status"] = "online"
    dev["gateway_id"] = gateway_id
    if isinstance(payload_data, dict):
        if payload_data.get("rssi") is not None:
            try:
                dev["rssi"] = float(payload_data["rssi"])
            except (ValueError, TypeError):
                pass
        if payload_data.get("battery_pct") is not None:
            try:
                dev["battery_pct"] = float(payload_data["battery_pct"])
            except (ValueError, TypeError):
                pass
        elif payload_data.get("vbatt") is not None:
            try:
                dev["battery_pct"] = round((float(payload_data["vbatt"]) / 3300.0) * 100, 1)
            except (ValueError, TypeError):
                pass
        if payload_data.get("temperature") is not None:
            try:
                dev["temperature"] = float(payload_data["temperature"])
            except (ValueError, TypeError):
                pass
        elif payload_data.get("temp") is not None:
            try:
                dev["temperature"] = float(payload_data["temp"])
            except (ValueError, TypeError):
                pass
        if payload_data.get("station_id"):
            dev["station_id"] = str(payload_data["station_id"])

class BleGatewayTelemetry(BaseModel):
    gateway_id: str = Field(default="gw-ble-01", description="Unique gateway identifier or MAC")
    device_mac: str = Field(default="304A2657BF44", description="BLE Sensor Node MAC Address")
    station_id: str = Field(default="station-A", description="Mapped Production Station")
    seq: int = Field(default=1, description="Sequential packet counter")
    sample_rate_hz: int = Field(default=1000, description="Vibration sampling rate")
    rssi: float = Field(default=0.0, description="Received signal strength indicator in dBm")
    battery_pct: float = Field(default=0.0, description="Sensor node battery remaining percentage")
    raw_samples: Optional[List[float]] = Field(default=None, description="Time-domain acceleration array in 'g'")
    raw_hex: Optional[str] = Field(default=None, description="Raw int16 hex payload from BLE characteristic")
    raw_base64: Optional[str] = Field(default=None, description="Base64 encoded binary acceleration data")
    motor_rpm: Optional[float] = Field(default=None, description="Measured spindle speed in RPM")
    motor_commanded_pct: Optional[float] = Field(default=100.0, description="PLC commanded speed percentage")
    motor_current_a: Optional[float] = Field(default=4.2, description="Motor current in Amperes")

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

    # Record into live packet stream buffer for real-time UI inspection
    record_incoming_packet(
        source="BLE Gateway REST Ingest",
        device_id=payload.device_mac,
        payload_data=payload.model_dump(),
        feedback=feedback
    )

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
async def get_ble_gateway_telemetry():
    """
    Returns latest telemetry snapshot directly from the Aperture BLE gateway.
    URL: /api/v1/gateway/ble/telemetry/
    """
    url = getattr(settings, "VENDOR_BLE_GATEWAY_STREAM_URL", "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/")
    gw_status = {
        "status": "online",
        "gateway_url": url,
        "endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry",
        "sample_rate_hz": 1000
    }
    try:
        async with httpx.AsyncClient(timeout=3.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Aperture-Tool-Monitor/1.0", "Accept": "application/json"})
            if resp.status_code == 200:
                gw_status.update(resp.json())
    except Exception:
        pass

    if IngestionService.latest_reading:
        gw_status["telemetry"] = IngestionService.latest_reading
        gw_status["latest_reading"] = IngestionService.latest_reading
    return gw_status

@router.get("/telemetry/latest")
@router.get("/live-stream")
async def get_ble_telemetry_latest(
    device_id: Optional[str] = None,
    device_ids: Optional[str] = None
):
    """
    Returns the real-time incoming BLE gateway telemetry packet stream,
    reporting total devices coming, total BLE gateways, and filtering
    visual telemetry by single or multiple selected devices in real time.
    URL: /api/v1/gateway/ble/telemetry/latest
    """
    # Prune stale devices so discovered_devices strictly reflects live latest incoming devices
    now_ts = datetime.now(timezone.utc).timestamp()
    cutoff = now_ts - 10.0
    stale_keys = [
        k for k, d in _discovered_devices.items()
        if d.get("_last_seen_ts", 0) < cutoff
    ]
    for k in stale_keys:
        _discovered_devices.pop(k, None)

    if not _discovered_devices:
        await sync_real_devices_from_vendor()

    if not IngestionService.latest_reading:
        from backend.app.api.vendor_motor_api import get_live_vibration
        fallback = await get_live_vibration()
        latest_reading = IngestionService.latest_reading or fallback
    else:
        latest_reading = IngestionService.latest_reading

    pkt_log = list(_incoming_packets_log)
    raw_query = device_ids or device_id or ""
    selected_ids = [d.strip() for d in raw_query.split(",") if d.strip() and d.strip().lower() != "all"]
    if not selected_ids:
        try:
            from backend.app.database import SessionLocal
            _db = SessionLocal()
            row = _db.query(SystemSetting).filter(SystemSetting.key == "selected_device_ids").first()
            if row and row.value:
                parsed = json.loads(row.value)
                if isinstance(parsed, list) and parsed:
                    selected_ids = [str(x).strip() for x in parsed if str(x).strip()]
            _db.close()
        except Exception:
            pass

    target_entry = None
    target_reading = dict(latest_reading) if isinstance(latest_reading, dict) else latest_reading
    devices_telemetry: Dict[str, Any] = {}

    if selected_ids:
        # Filter matching packets for any of the selected IDs
        matching_pkts = [
            p for p in pkt_log
            if p.get("device_id") in selected_ids
            or (isinstance(p.get("payload"), dict) and (p["payload"].get("device_id") in selected_ids or p["payload"].get("dmac") in selected_ids))
        ]

        for dev_id in selected_ids:
            dev_meta = _discovered_devices.get(dev_id, {})
            dev_pkts = [
                p for p in matching_pkts
                if p.get("device_id") == dev_id
                or (isinstance(p.get("payload"), dict) and (p["payload"].get("device_id") == dev_id or p["payload"].get("dmac") == dev_id))
            ]
            if dev_pkts:
                raw_p = dev_pkts[-1].get("payload", {})
                dev_telem = dict(raw_p) if isinstance(raw_p, dict) else dict(latest_reading)
            else:
                dev_telem = dict(latest_reading)

            dev_telem["device_id"] = dev_id
            dev_telem["name"] = dev_meta.get("name", f"BLE Sensor Node ({dev_id})")
            dev_telem["station_id"] = dev_meta.get("station_id", "station-A")
            dev_telem["device_type"] = dev_meta.get("device_type", "Triaxial Accelerometer")
            if dev_meta:
                dev_telem["rssi"] = dev_meta.get("rssi", 0.0)
                dev_telem["battery_pct"] = dev_meta.get("battery_pct", 0.0)
                dev_telem["temperature"] = dev_meta.get("temperature", 0.0)
            devices_telemetry[dev_id] = dev_telem

        primary_id = selected_ids[0]
        target_reading = devices_telemetry.get(primary_id, latest_reading)

        if matching_pkts:
            target_entry = matching_pkts[-1]
        else:
            target_entry = {
                "id": f"pkt-{primary_id[:6]}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "Aperture BLE Gateway Stream",
                "device_id": primary_id,
                "payload": target_reading,
                "feedback": {
                    "state": target_reading.get("state", "NORMAL"),
                    "commanded_speed_pct": target_reading.get("commanded_speed_pct", 100.0),
                    "indicator_light": target_reading.get("indicator_light", "GREEN"),
                    "anomaly_score": target_reading.get("anomaly_score", 0.042)
                }
            }
        recent_to_send = matching_pkts[-30:] if matching_pkts else []
    else:
        target_entry = _latest_gateway_packet
        if not target_entry and pkt_log:
            target_entry = pkt_log[-1]
        recent_to_send = pkt_log[-30:]

    if not target_entry:
        default_dev = selected_ids[0] if selected_ids else (list(_discovered_devices.keys())[0] if _discovered_devices else "304A2657BF44")
        target_entry = {
            "id": "pkt-stream-head",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "Aperture BLE Gateway Stream",
            "device_id": target_reading.get("device_id") or default_dev,
            "payload": target_reading,
            "feedback": {
                "state": target_reading.get("state", "NORMAL"),
                "commanded_speed_pct": target_reading.get("commanded_speed_pct", 100.0),
                "indicator_light": target_reading.get("indicator_light", "GREEN"),
                "anomaly_score": target_reading.get("anomaly_score", 0.042)
            }
        }

    gw_entry = _active_gateways.get("gw-ble-01", {})
    devices_list = list(_discovered_devices.values())
    gateways_list = list(_active_gateways.values())
    live_packets_val = _latest_batch_packets_count if _latest_batch_packets_count > 0 else (len(target_reading.get("obj", [])) if isinstance(target_reading, dict) and isinstance(target_reading.get("obj"), list) else len(pkt_log))

    return {
        "status": "online",
        "endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry/latest",
        "gateway_url": "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "device_id": target_entry.get("device_id") or target_reading.get("device_id") or "all",
        "selected_device_id": selected_ids[0] if len(selected_ids) == 1 else ("all" if not selected_ids else ",".join(selected_ids)),
        "selected_device_ids": selected_ids,
        "station_id": latest_reading.get("station_id") or "station-A",
        "latest_packet": target_entry,
        "packet": target_entry,
        "telemetry": target_reading,
        "live_reading": target_reading,
        "devices_telemetry": devices_telemetry,
        "recent_packets": recent_to_send,
        "active_gateway": gw_entry,
        "total_packets": live_packets_val,
        "latest_batch_packets": live_packets_val,
        "live_session_packets": _live_session_packets_count,
        "is_streaming": True,
        # Real-time Hardware Counters strictly from live stream
        "total_devices_coming": len(devices_list),
        "total_ble_gateways": len(gateways_list),
        "devices_count": len(devices_list),
        "gateways_count": len(gateways_list),
        "discovered_devices": devices_list,
        "active_gateways": gateways_list
    }

@router.get("/telemetry/history")
async def get_ble_telemetry_history(
    limit: int = 50,
    station_id: Optional[str] = None,
    device_id: Optional[str] = None,
    device_ids: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Returns chronological history of BLE gateway telemetry packets directly from Aperture BLE gateway,
    supporting multi-device selection filtering.
    URL: /api/v1/gateway/ble/telemetry/history
    """
    if not _discovered_devices:
        await sync_real_devices_from_vendor(db=db)

    url = getattr(settings, "VENDOR_BLE_GATEWAY_HISTORY_URL", "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/history")
    history_packets = []
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Aperture-Tool-Monitor/1.0", "Accept": "application/json"})
            if resp.status_code == 200:
                body = resp.json()
                raw_list = body.get("data", [])
                for idx, item in enumerate(raw_list[:limit]):
                    p_data = item.get("data", {}) if isinstance(item, dict) else {}
                    rec_at = item.get("received_at", datetime.now(timezone.utc).isoformat()) if isinstance(item, dict) else datetime.now(timezone.utc).isoformat()
                    gmac = p_data.get("gmac", "304A2657BF44")
                    objs = p_data.get("obj", [])
                    dmac = None
                    rssi_val = -70
                    for o in objs:
                        if isinstance(o, dict):
                            if o.get("dmac"):
                                dmac = o.get("dmac")
                            if o.get("rssi") is not None:
                                rssi_val = o.get("rssi")
                    d_id = dmac or gmac
                    history_packets.append({
                        "id": f"pkt-hist-{idx}",
                        "timestamp": rec_at,
                        "source": "Aperture BLE Gateway History",
                        "device_id": d_id,
                        "gmac": gmac,
                        "rssi": rssi_val,
                        "state": "NORMAL",
                        "payload": p_data
                    })
    except Exception:
        pass

    all_packets = []
    # 1. Put most recent live incoming packets first
    for p in reversed(list(_incoming_packets_log)):
        all_packets.append(p)

    # 2. Add vendor history packets
    for h in history_packets:
        if not any(p.get("id") == h.get("id") for p in all_packets):
            all_packets.append(h)

    # 3. Filter strictly by selected_ids if requested
    raw_query = device_ids or device_id or ""
    selected_ids = [d.strip() for d in raw_query.split(",") if d.strip() and d.strip().lower() != "all"]
    if not selected_ids:
        try:
            row = db.query(SystemSetting).filter(SystemSetting.key == "selected_device_ids").first()
            if row and row.value:
                parsed = json.loads(row.value)
                if isinstance(parsed, list) and parsed:
                    selected_ids = [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            pass

    if selected_ids:
        filtered = [
            p for p in all_packets
            if p.get("device_id") in selected_ids
            or (isinstance(p.get("payload"), dict) and (p["payload"].get("device_id") in selected_ids or p["payload"].get("dmac") in selected_ids))
        ]
    else:
        filtered = all_packets

    limited = filtered[:limit]

    return {
        "status": "success",
        "endpoint": f"{settings.API_V1_STR}/gateway/ble/telemetry/history",
        "gateway_url": url,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "count": len(limited),
        "total_recorded": len(history_packets),
        "total_devices_coming": len(_discovered_devices),
        "total_ble_gateways": len(_active_gateways),
        "selected_device_id": selected_ids[0] if len(selected_ids) == 1 else ("all" if not selected_ids else ",".join(selected_ids)),
        "selected_device_ids": selected_ids,
        "discovered_devices": list(_discovered_devices.values()),
        "history": limited,
        "recent_packets": limited,
        "packets": limited
    }

@router.get("/gateways")
def list_ble_gateways():
    """
    Returns list of all active BLE gateways, connection health, and transmission metrics.
    """
    return list(_active_gateways.values())

@router.get("/devices")
async def list_discovered_devices():
    """
    Returns dynamically discovered incoming BLE sensor devices and BLE gateways from real hardware.
    URL: /api/v1/gateway/ble/devices
    """
    now_ts = datetime.now(timezone.utc).timestamp()
    cutoff = now_ts - 10.0
    stale_keys = [
        k for k, d in _discovered_devices.items()
        if d.get("_last_seen_ts", 0) < cutoff
    ]
    for k in stale_keys:
        _discovered_devices.pop(k, None)

    if not _discovered_devices:
        await sync_real_devices_from_vendor()

    devices_list = list(_discovered_devices.values())
    gateways_list = list(_active_gateways.values())
    return {
        "status": "success",
        "total_devices_coming": len(devices_list),
        "total_ble_gateways": len(gateways_list),
        "latest_batch_packets": _latest_batch_packets_count,
        "live_session_packets": _live_session_packets_count,
        "devices": devices_list,
        "gateways": gateways_list,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

class SelectedDevicesPayload(BaseModel):
    selected_device_ids: List[str]

@router.get("/selected-devices")
def get_selected_devices(db: Session = Depends(get_db)):
    """
    Returns the persisted list of selected hardware device IDs from the database SystemSetting.
    URL: /api/v1/gateway/ble/selected-devices
    """
    row = db.query(SystemSetting).filter(SystemSetting.key == "selected_device_ids").first()
    if row and row.value:
        try:
            ids = json.loads(row.value)
            if isinstance(ids, list):
                return {"status": "success", "selected_device_ids": ids}
        except Exception:
            ids = [x.strip() for x in row.value.split(",") if x.strip()]
            return {"status": "success", "selected_device_ids": ids}
    return {"status": "success", "selected_device_ids": []}

@router.post("/selected-devices")
def save_selected_devices(payload: SelectedDevicesPayload, db: Session = Depends(get_db)):
    """
    Persists user's selected hardware devices into database SystemSetting and VendorGatewayConfig.
    All dashboard telemetry across all pages will filter exclusively to these selected devices.
    URL: /api/v1/gateway/ble/selected-devices
    """
    cleaned_ids = [str(d).strip() for d in payload.selected_device_ids if str(d).strip() and str(d).strip().lower() != "all"]
    val_str = json.dumps(cleaned_ids)

    # 1. Update SystemSetting
    setting = db.query(SystemSetting).filter(SystemSetting.key == "selected_device_ids").first()
    if not setting:
        setting = SystemSetting(key="selected_device_ids", value=val_str)
        db.add(setting)
    else:
        setting.value = val_str

    # 2. Update VendorGatewayConfig mac_filter
    cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
    if cfg:
        cfg.mac_filter = ",".join(cleaned_ids)

    db.commit()
    return {
        "status": "success",
        "selected_device_ids": cleaned_ids,
        "message": f"Successfully persisted {len(cleaned_ids)} hardware device(s) to database"
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
            '    "device_mac": "304A2657BF44",\n'
            '    "station_id": "station-A",\n'
            '    "seq": 1001,\n'
            '    "sample_rate_hz": 1000,\n'
            '    "rssi": -73.0,\n'
            '    "battery_pct": 98.0,\n'
            '    "raw_samples": [0.012, -0.024, 0.035, 0.018],\n'
            '    "motor_rpm": 1500.0,\n'
            '    "motor_commanded_pct": 100.0\n'
            "  }'"
        ),
        "sample_python": (
            "import requests\n"
            "import json\n\n"
            f"URL = 'http://localhost:8000{settings.API_V1_STR}/gateway/ble/telemetry'\n\n"
            "payload = {\n"
            "    'gateway_id': 'gw-ble-01',\n"
            "    'device_mac': '304A2657BF44',\n"
            "    'station_id': 'station-A',\n"
            "    'seq': 1001,\n"
            "    'sample_rate_hz': 1000,\n"
            "    'rssi': -73.0,\n"
            "    'battery_pct': 98.0,\n"
            "    'raw_samples': [0.01] * 1000,\n"
            "    'motor_rpm': 1500.0\n"
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
    mac_filter: Optional[str] = Field(default="", description="Sensor MAC address filter")
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
            mac_filter="",
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
    cfg.api_url = settings.VENDOR_BLE_GATEWAY_URL or "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest"
    cfg.api_key = settings.VENDOR_BLE_GATEWAY_API_KEY or ""
    cfg.poll_interval_sec = settings.VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC or 1.0
    cfg.station_id = "station-A"
    cfg.mac_filter = ""
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
    global _discovered_devices, _active_gateways, _latest_batch_packets_count, _live_session_packets_count
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
                while isinstance(content, dict) and "data" in content and isinstance(content["data"], (dict, list)):
                    content = content["data"]

                samples: List[float] = []
                vbatt_vals: List[float] = []
                temp_vals: List[float] = []
                rssi_vals: List[float] = []
                active_dmac: Optional[str] = None
                gmac = content.get("gmac") if isinstance(content, dict) else "304A2657BF44"
                features_obj: Optional[VibrationFeatures] = None

                # 1. Parse BLE objects from Aperture gateway format: "msg": "advData", "obj": [...]
                if gmac and gmac not in _discovered_devices:
                    _discovered_devices[gmac] = {
                        "device_id": gmac,
                        "name": f"Aperture Gateway Hub ({gmac})",
                        "station_id": cfg.station_id if cfg else "station-A",
                        "last_seen": now.isoformat(),
                        "packets_count": 1,
                        "rssi": 0.0,
                        "battery_pct": 0.0,
                        "temperature": 0.0,
                        "status": "online",
                        "device_type": "Triaxial Accelerometer",
                        "gateway_id": "gw-ble-01"
                    }

                # Check if there are user-configured selected device(s) / mac filter
                selected_filter = [x.strip() for x in (cfg.mac_filter or "").split(",") if x.strip() and x.strip().lower() != "all"] if cfg else []

                # Group candidate devices by type
                triaxial_candidates = []  # list of (dmac, samples, rssi, item)
                beacon_candidates = {}    # dmac -> item (battery, temp, rssi)

                raw_objs = content.get("obj", []) if isinstance(content, dict) and isinstance(content.get("obj"), list) else []
                _latest_batch_packets_count = len(raw_objs)
                _live_session_packets_count += len(raw_objs)
                live_dmacs_in_current_batch = set()
                now_ts = now.timestamp()
                now_iso = now.isoformat()

                if raw_objs:
                    for item in raw_objs:
                        if not isinstance(item, dict):
                            continue
                        dmac = item.get("dmac")
                        if dmac:
                            live_dmacs_in_current_batch.add(dmac)
                            t = item.get("type", 4)
                            dev_type = "Triaxial Accelerometer (Type 32)" if t == 32 else "Beacon Telemetry Node (Type 8)" if t == 8 else f"BLE Sensor Node (Type {t})"
                            rssi_item = item.get("rssi")
                            rssi_val_item = float(rssi_item) if rssi_item is not None else 0.0

                            if dmac not in _discovered_devices:
                                _discovered_devices[dmac] = {
                                    "device_id": dmac,
                                    "name": f"BLE Sensor Node ({dmac})",
                                    "station_id": cfg.station_id if cfg else "station-A",
                                    "last_seen": now_iso,
                                    "_last_seen_ts": now_ts,
                                    "packets_count": 1,
                                    "rssi": rssi_val_item,
                                    "battery_pct": 0.0,
                                    "temperature": 0.0,
                                    "status": "online",
                                    "device_type": dev_type,
                                    "gateway_id": "gw-ble-01"
                                }
                            else:
                                dev = _discovered_devices[dmac]
                                dev["last_seen"] = now_iso
                                dev["_last_seen_ts"] = now_ts
                                dev["packets_count"] += 1
                                dev["status"] = "online"
                                dev["rssi"] = rssi_val_item
                                dev["device_type"] = dev_type

                            if "vbatt" in item and item["vbatt"] is not None:
                                try:
                                    _discovered_devices[dmac]["battery_pct"] = round((float(item["vbatt"]) / 3300.0) * 100.0, 1)
                                except Exception:
                                    pass
                            if "temp" in item and item["temp"] is not None:
                                try:
                                    _discovered_devices[dmac]["temperature"] = float(item["temp"])
                                except Exception:
                                    pass

                            beacon_candidates[dmac] = item

                        t = item.get("type")
                        rssi = item.get("rssi")
                        if rssi is not None:
                            try:
                                rssi_vals.append(float(rssi))
                            except (ValueError, TypeError):
                                pass

                        # Extract battery and temperature (Type 8 or direct properties)
                        if t == 8 or "vbatt" in item or "temp" in item:
                            if "vbatt" in item and item["vbatt"] is not None:
                                try:
                                    vbatt_vals.append(float(item["vbatt"]))
                                except (ValueError, TypeError):
                                    pass
                            if "temp" in item and item["temp"] is not None:
                                try:
                                    temp_vals.append(float(item["temp"]))
                                except (ValueError, TypeError):
                                    pass

                        # Extract raw accelerometer frames from Type 32 advertisement payloads (data1 hex)
                        if (t == 32 or "data1" in item) and item.get("data1"):
                            hex_str = str(item["data1"]).strip()
                            try:
                                raw_b = bytes.fromhex(hex_str)
                                if len(raw_b) >= 6:
                                    if b"\xaa\xfe" in raw_b and len(raw_b) >= 14:
                                        idx = raw_b.find(b"\xaa\xfe")
                                        tail = raw_b[idx+2:]
                                        if len(tail) >= 6:
                                            x, y, z = struct.unpack(">3h", tail[-6:])
                                            gx, gy, gz = x / 1000.0, y / 1000.0, z / 1000.0
                                            # Detrend 1g gravity from dominant static axis
                                            if abs(abs(gy) - 1.0) < 0.35:
                                                gy = gy - (1.0 if gy > 0 else -1.0)
                                            elif abs(abs(gz) - 1.0) < 0.35:
                                                gz = gz - (1.0 if gz > 0 else -1.0)
                                            elif abs(abs(gx) - 1.0) < 0.35:
                                                gx = gx - (1.0 if gx > 0 else -1.0)
                                            triaxial_candidates.append((dmac, [round(gx, 4), round(gy, 4), round(gz, 4)], float(rssi or -70.0), item))
                                    else:
                                        x, y, z = struct.unpack(">3h", raw_b[-6:])
                                        gx, gy, gz = x / 1000.0, y / 1000.0, z / 1000.0
                                        if max(abs(gx), abs(gy), abs(gz)) < 8.0:
                                            triaxial_candidates.append((dmac, [round(gx, 4), round(gy, 4), round(gz, 4)], float(rssi or -70.0), item))
                            except Exception:
                                pass

                        # Direct acceleration axes if decoded
                        if "x" in item and "y" in item:
                            try:
                                triaxial_candidates.append((dmac, [float(item.get("x", 0.0)), float(item.get("y", 0.0)), float(item.get("z", 0.0))], float(rssi or -70.0), item))
                            except (ValueError, TypeError):
                                pass

                    # Strictly prune stale devices so _discovered_devices only reflects devices active in the latest live stream
                    cutoff = now_ts - 10.0
                    stale_keys = [
                        k for k, d in _discovered_devices.items()
                        if k != gmac and d.get("_last_seen_ts", 0) < cutoff and k not in live_dmacs_in_current_batch
                    ]
                    for k in stale_keys:
                        _discovered_devices.pop(k, None)

                # Determine primary active sensor and extract its vibration samples
                chosen_dmac = None
                chosen_samples = []
                chosen_battery = 0.0
                chosen_temp = 0.0
                chosen_rssi = 0.0

                if selected_filter:
                    for cand_mac, cand_s, cand_rssi, cand_item in triaxial_candidates:
                        if cand_mac in selected_filter:
                            chosen_dmac = cand_mac
                            chosen_samples = cand_s
                            chosen_rssi = cand_rssi
                            break
                    if not chosen_dmac:
                        for sel_id in selected_filter:
                            if sel_id in beacon_candidates:
                                chosen_dmac = sel_id
                                b_item = beacon_candidates[sel_id]
                                if "vbatt" in b_item and b_item["vbatt"] is not None:
                                    try:
                                        chosen_battery = round((float(b_item["vbatt"]) / 3300.0) * 100, 1)
                                    except Exception:
                                        pass
                                if "temp" in b_item and b_item["temp"] is not None:
                                    try:
                                        chosen_temp = float(b_item["temp"])
                                    except Exception:
                                        pass
                                if "rssi" in b_item and b_item["rssi"] is not None:
                                    try:
                                        chosen_rssi = float(b_item["rssi"])
                                    except Exception:
                                        pass
                                if triaxial_candidates:
                                    chosen_samples = triaxial_candidates[0][1]
                                break

                if not chosen_dmac:
                    if triaxial_candidates:
                        chosen_dmac = triaxial_candidates[0][0]
                        chosen_samples = triaxial_candidates[0][1]
                        chosen_rssi = triaxial_candidates[0][2]
                    elif selected_filter:
                        chosen_dmac = selected_filter[0]
                    else:
                        chosen_dmac = gmac or "304A2657BF44"

                if chosen_dmac in beacon_candidates:
                    b_item = beacon_candidates[chosen_dmac]
                    if "vbatt" in b_item and b_item["vbatt"] is not None:
                        try:
                            chosen_battery = round((float(b_item["vbatt"]) / 3300.0) * 100, 1)
                        except Exception:
                            pass
                    if "temp" in b_item and b_item["temp"] is not None:
                        try:
                            chosen_temp = float(b_item["temp"])
                        except Exception:
                            pass
                    if "rssi" in b_item and b_item["rssi"] is not None:
                        try:
                            chosen_rssi = float(b_item["rssi"])
                        except Exception:
                            pass
                elif vbatt_vals:
                    chosen_battery = round((sum(vbatt_vals) / len(vbatt_vals) / 3300.0) * 100, 1)

                samples = chosen_samples
                active_dmac = chosen_dmac

                # 2. Check for sample lists or raw arrays
                if isinstance(content, list):
                    if len(content) > 0:
                        if isinstance(content[0], (int, float)):
                            samples.extend([float(v) for v in content])
                        elif isinstance(content[0], dict):
                            for item in content:
                                for ax in ["x", "acc_x_g", "acc_x", "y", "acc_y_g", "acc_y", "z", "acc_z_g", "acc_z"]:
                                    if ax in item and isinstance(item[ax], (int, float)):
                                        samples.append(float(item[ax]))
                elif isinstance(content, dict):
                    for k in ["raw_samples", "samples", "window", "waveform"]:
                        if k in content and isinstance(content[k], list):
                            samples.extend([float(v) for v in content[k] if isinstance(v, (int, float))])
                            break

                    # Check for direct accelerometer scalar values
                    if not samples:
                        x_val = content.get("acc_x_g") if "acc_x_g" in content else content.get("x")
                        y_val = content.get("acc_y_g") if "acc_y_g" in content else content.get("y")
                        z_val = content.get("acc_z_g") if "acc_z_g" in content else content.get("z")
                        if x_val is not None or y_val is not None:
                            samples = [float(x_val or 0.0), float(y_val or 0.0), float(z_val or 0.0)]

                    # Check for precomputed vibration features if host provided them
                    feat_source = content.get("features") if isinstance(content.get("features"), dict) else content
                    if any(k in feat_source for k in ["rms", "rms_g", "vibration_rms"]):
                        rms_v = float(feat_source.get("rms_g") or feat_source.get("rms") or feat_source.get("vibration_rms") or 0.0)
                        peak_v = float(feat_source.get("peak_g") or feat_source.get("peak") or (rms_v * 1.414))
                        features_obj = VibrationFeatures(
                            rms=rms_v,
                            peak=peak_v,
                            peak_to_peak=round(peak_v * 1.95, 4),
                            crest_factor=round(peak_v / max(rms_v, 0.001), 2),
                            kurtosis=float(feat_source.get("kurtosis") or 2.8),
                            dominant_freq=float(feat_source.get("dominant_freq") or 50.0),
                            spectral_centroid=round(float(feat_source.get("dominant_freq") or 50.0) * 1.05, 1),
                            band_energies={
                                "0_50Hz": round(rms_v * 0.10, 4),
                                "50_150Hz": round(rms_v * 0.15, 4),
                                "150_300Hz": round(rms_v * 0.55, 4),
                                "300_500Hz": round(rms_v * 0.20, 4),
                            }
                        )

                # Append freshly extracted live acceleration readings into rolling circular buffer
                if samples:
                    _live_ble_samples_buffer.extend(samples)

                # Compute spectral and statistical features directly from live sensor samples
                if len(_live_ble_samples_buffer) >= 16:
                    buf_samples = list(_live_ble_samples_buffer)
                    feats, _ = extract_features(buf_samples, 1000)
                    features_obj = VibrationFeatures(
                        rms=feats["rms"],
                        peak=feats["peak"],
                        peak_to_peak=feats["peak_to_peak"],
                        crest_factor=feats["crest_factor"],
                        kurtosis=feats["kurtosis"],
                        dominant_freq=feats["dominant_freq"],
                        spectral_centroid=feats["spectral_centroid"],
                        band_energies=feats["band_energies"]
                    )
                elif samples:
                    s_arr = np.array(samples, dtype=float)
                    rms_v = float(np.sqrt(np.mean(np.square(s_arr))))
                    peak_v = float(np.max(np.abs(s_arr)))
                    features_obj = VibrationFeatures(
                        rms=round(rms_v, 4),
                        peak=round(peak_v, 4),
                        peak_to_peak=round(peak_v * 1.9, 4),
                        crest_factor=round(peak_v / max(rms_v, 0.001), 2),
                        kurtosis=3.0,
                        dominant_freq=50.0,
                        spectral_centroid=52.5,
                        band_energies={"0_50Hz": round(rms_v * 0.1, 4), "50_150Hz": round(rms_v * 0.2, 4), "150_300Hz": round(rms_v * 0.5, 4), "300_500Hz": round(rms_v * 0.2, 4)}
                    )

                # Sensor metadata extracted from live BLE frames
                battery_pct = round((sum(vbatt_vals) / len(vbatt_vals) / 3300.0) * 100, 1) if vbatt_vals else 0.0
                temp_c = round(sum(temp_vals) / len(temp_vals), 1) if temp_vals else 0.0
                rssi_val = round(sum(rssi_vals) / len(rssi_vals), 1) if rssi_vals else 0.0
                device_id_val = active_dmac or gmac or "304A2657BF44"
                station_id_val = cfg.station_id if cfg else "station-A"

                # Dynamic Motor RPM and drive status - sourced from station state & configured settings
                from backend.app.models.schema import Station
                from backend.app.api.vendor_motor_api import get_dynamic_motor_rated_rpm
                from backend.app.core.decision_engine import get_decision_engine
                st_obj = db.query(Station).filter(Station.id == station_id_val).first() if db else None
                st_state = st_obj.state if st_obj else "NORMAL"
                commanded_pct = float(st_obj.commanded_speed_pct if st_obj and st_obj.commanded_speed_pct is not None else 100.0)
                rated_rpm = get_dynamic_motor_rated_rpm(get_decision_engine(station_id_val))
                if st_state == "STOPPED" or commanded_pct <= 0:
                    rpm = 0.0
                    commanded_pct = 0.0
                    current_amps = 0.0
                elif st_state in ["REDUCED_SPEED", "WARNING"] or commanded_pct <= 55.0:
                    rpm = round(rated_rpm * 0.5, 1)
                    current_amps = 2.1
                else:
                    rpm = round(rated_rpm, 1)
                    current_amps = round(4.2 * (commanded_pct / 100.0), 2)

                # Ingest through feature extractor and dual-layer safety engine
                motor_info = MotorData(commanded_pct=commanded_pct, measured_rpm=rpm, current_amps=current_amps)
                ingest_contract = IngestPayload(
                    device_id=device_id_val,
                    station_id=station_id_val,
                    ts=now,
                    seq=int(now.timestamp()),
                    sample_rate_hz=1000,
                    window=list(_live_ble_samples_buffer) if len(_live_ble_samples_buffer) >= 16 else (samples if samples else None),
                    features=features_obj,
                    axes="xyz",
                    motor=motor_info,
                    battery_pct=battery_pct,
                    rssi=rssi_val,
                    temperature=temp_c
                )
                feedback = await IngestionService.process_payload(ingest_contract, db=db)
                if selected_filter and IngestionService.latest_reading:
                    for sf in selected_filter:
                        IngestionService.latest_readings_by_device[sf] = IngestionService.latest_reading

                if cfg:
                    cfg.last_sync = datetime.utcnow()
                    cfg.last_status = "connected"
                    cfg.last_error = None
                    cfg.packets_received += 1
                    db.commit()

                # Update live active gateway state
                gw_entry = _active_gateways.get("gw-ble-01")
                if gw_entry:
                    gw_entry["last_seen"] = now.isoformat()
                    gw_entry["packets_received"] = _latest_batch_packets_count
                    gw_entry["latest_batch_packets"] = _latest_batch_packets_count
                    gw_entry["live_session_packets"] = _live_session_packets_count
                    gw_entry["mac_address"] = gmac or "304A2657BF44"
                    gw_entry["gmac"] = gmac or "304A2657BF44"
                    gw_entry["ip_address"] = content.get("wanIP") if isinstance(content, dict) and content.get("wanIP") else "gateway.apertureventurestudio.com"
                    gw_entry["status"] = "online"
                    gw_entry["avg_rssi"] = rssi_val
                    gw_entry["battery_pct"] = battery_pct

                # Record packet in memory stream buffer
                record_incoming_packet("Aperture BLE Gateway Stream", device_id_val, data if isinstance(data, dict) else {"data": data}, feedback)

                return {
                    "status": "success",
                    "message": f"Successfully ingested live BLE packet from {url}",
                    "http_status": resp.status_code,
                    "latency_ms": latency_ms,
                    "gateway_mac": gmac,
                    "sensor_dmac": active_dmac,
                    "samples_ingested": len(samples),
                    "incoming_data": data,
                    "actuation": feedback
                }
            else:
                if cfg:
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
            is_html = False
            content_type = resp.headers.get("content-type", "").lower()
            raw_text = resp.text.strip()

            if "html" in content_type or raw_text.startswith("<!doctype") or raw_text.startswith("<html") or "<title>" in raw_text:
                is_html = True
                data_preview = raw_text[:350]
                return {
                    "status": "warning",
                    "http_status": resp.status_code,
                    "latency_ms": latency_ms,
                    "is_json": False,
                    "is_html": True,
                    "detected_samples": 0,
                    "data_preview": data_preview,
                    "message": f"Server reached (HTTP {resp.status_code}) in {latency_ms}ms, but returned an HTML page instead of JSON telemetry (Warmup/Cold-Start or authentication required). Waiting for JSON API stream."
                }

            try:
                data = resp.json()
                is_json = True
                if isinstance(data, dict):
                    if data.get("status") == "waiting_for_hardware":
                        return {
                            "status": "success",
                            "http_status": 200,
                            "latency_ms": latency_ms,
                            "is_json": True,
                            "detected_samples": 0,
                            "data_preview": data,
                            "message": f"Connected to {url} (HTTP 200). Gateway receiver is active and listening for first transmission from physical BLE hardware."
                        }

                    data_preview = data
                    for k in ("raw_samples", "samples", "window", "data"):
                        if k in data and isinstance(data[k], list):
                            detected_samples = len(data[k])
                            break
                elif isinstance(data, list):
                    detected_samples = len(data)
                    data_preview = data
            except Exception:
                data_preview = resp.text[:250]

            return {
                "status": "success" if resp.status_code == 200 else "warning" if resp.status_code < 500 else "error",
                "http_status": resp.status_code,
                "latency_ms": latency_ms,
                "is_json": is_json,
                "is_html": False,
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
    device_mac = "304A2657BF44"
    station_id = "station-A"
    rpm = 0.0
    commanded_pct = 100.0
    rssi = 0.0
    battery = 0.0
    seq = int(now.timestamp())
    samples: List[float] = []

    if isinstance(raw_json, dict):
        device_mac = raw_json.get("device_mac") or raw_json.get("mac") or raw_json.get("node_id") or device_mac
        station_id = raw_json.get("station_id", "station-A")
        rssi = float(raw_json.get("rssi", 0.0))
        battery = float(raw_json.get("battery_pct", raw_json.get("battery", 0.0)))
        seq = int(raw_json.get("seq", seq))
        if "motor" in raw_json and isinstance(raw_json["motor"], dict):
            rpm = float(raw_json["motor"].get("measured_rpm", 0.0))
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

    # Record in memory stream buffer
    record_incoming_packet("Vendor Inbound Webhook", device_mac, raw_json if isinstance(raw_json, dict) else {"data": raw_json}, feedback)

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

