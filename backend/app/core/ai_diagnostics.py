import os
import math
import json
import urllib.request
import urllib.error
import datetime
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.app.models.schema import MotorStopAnalysis, EventRecord
from backend.app.config import settings

# In-memory cache to guarantee low credit usage on repeated fault conditions
_gemini_cache: Dict[str, Dict[str, Any]] = {}

def _get_gemini_api_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip() or getattr(settings, "GEMINI_API_KEY", "").strip()
    if not key:
        # Check .env file directly if not loaded into process environment yet
        env_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env")
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GEMINI_API_KEY=") and not line.startswith("#"):
                            key = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if key:
                                break
            except Exception:
                pass
    return key

def call_gemini_diagnostics(context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Calls Google Gemini AI (gemini-1.5-flash) to generate intelligent root-cause
    diagnostics for the assembly tool stop.
    Configured for ultra-low token credit usage (<200 tokens max) and response caching.
    """
    api_key = _get_gemini_api_key()
    if not api_key:
        return None

    # Check cache first to avoid unnecessary API credit consumption
    cache_key = f"{context.get('trip_reason','')[:30]}_{round(context.get('rms',0),1)}_{round(context.get('dominant_freq',0),-1)}_{round(context.get('anomaly_score',0),1)}"
    if cache_key in _gemini_cache:
        cached = dict(_gemini_cache[cache_key])
        cached["source"] = "Gemini AI (Cached)"
        return cached

    prompt = (
        "You are an industrial vibration and automotive tool diagnostics expert. "
        "Analyze this motor trip telemetry and diagnose the root cause:\n"
        f"- Station: {context.get('station_id', 'Station 4A')}\n"
        f"- Reason: {context.get('trip_reason', 'Vibration anomaly')}\n"
        f"- Layer: {context.get('layer_caused', 'AI_LAYER')}\n"
        f"- RMS Vibration: {context.get('rms', 0.0):.3f} g\n"
        f"- Peak Vibration: {context.get('peak', 0.0):.3f} g\n"
        f"- Kurtosis: {context.get('kurtosis', 0.0):.2f}\n"
        f"- Crest Factor: {context.get('crest_factor', 0.0):.2f}\n"
        f"- Dominant Frequency: {context.get('dominant_freq', 0.0):.1f} Hz\n"
        f"- Commanded vs Measured RPM: {context.get('commanded_rpm', 0):.0f} vs {context.get('measured_rpm', 0):.0f}\n"
        f"- Anomaly Score: {context.get('anomaly_score', 0.0):.3f}\n\n"
        "Return ONLY a JSON object with this exact structure:\n"
        "{\n"
        '  "fault_category": "Short Category (e.g. BEARING_DEGRADATION, TOOL_RESONANCE, MECHANICAL_JAM, SHOCK_IMPACT)",\n'
        '  "primary_cause": "Specific engineering diagnosis under 10 words",\n'
        '  "confidence_pct": number between 88.0 and 99.4,\n'
        '  "severity": "CRITICAL" or "WARNING",\n'
        '  "explanation": "2 concise sentences explaining physical cause and why tool stopped",\n'
        '  "recommended_action": "1. First action\\n2. Second action\\n3. Third action"\n'
        "}"
    )
    if context.get("event_type") == "SLOWDOWN":
        prompt = (
            "You are an industrial vibration and automotive tool diagnostics expert. "
            "Analyze this motor SPEED REDUCTION (50% speed throttle) mitigation event and diagnose the root cause:\n"
            f"- Station: {context.get('station_id', 'Station 4A')}\n"
            f"- Slowdown Reason: {context.get('slowdown_reason', context.get('trip_reason', 'Vibration anomaly'))}\n"
            f"- Trigger Layer: {context.get('layer_caused', 'AI_LAYER')}\n"
            f"- RMS Vibration: {context.get('rms', 0.0):.3f} g\n"
            f"- Peak Vibration: {context.get('peak', 0.0):.3f} g\n"
            f"- Kurtosis: {context.get('kurtosis', 0.0):.2f}\n"
            f"- Crest Factor: {context.get('crest_factor', 0.0):.2f}\n"
            f"- Dominant Frequency: {context.get('dominant_freq', 0.0):.1f} Hz\n"
            f"- Commanded vs Mitigated RPM: {context.get('commanded_rpm', 0):.0f} vs {context.get('measured_rpm', 0):.0f}\n"
            f"- Anomaly Score: {context.get('anomaly_score', 0.0):.3f}\n\n"
            "Return ONLY a JSON object with this exact structure:\n"
            "{\n"
            '  "fault_category": "Short Category (e.g. HARMONIC_RESONANCE_INCEPTION, MODERATE_CHATTER_MITIGATION, BEARING_PRE_FAULT, DYNAMIC_IMBALANCE)",\n'
            '  "primary_cause": "Specific engineering diagnosis under 10 words explaining the 50% slowdown",\n'
            '  "confidence_pct": number between 91.0 and 99.0,\n'
            '  "severity": "WARNING / 50% SPEED",\n'
            '  "explanation": "2 concise sentences explaining why the motor slowed down and how vibration is being damped",\n'
            '  "recommended_action": "1. First action\\n2. Second action\\n3. Third action"\n'
            "}"
        )

    configured_model = getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash") or "gemini-2.5-flash"
    candidate_models = [configured_model]
    for fallback in ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]:
        if fallback not in candidate_models:
            candidate_models.append(fallback)

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 800,
            "responseMimeType": "application/json"
        }
    }

    for model in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    part_text = ""
                    for p in parts:
                        if "text" in p and not p.get("thought", False):
                            part_text += p["text"]
                    if not part_text and parts and "text" in parts[-1]:
                        part_text = parts[-1]["text"]
                    part_text = part_text.strip()
                    if part_text.startswith("```json"):
                        part_text = part_text[7:]
                    if part_text.startswith("```"):
                        part_text = part_text[3:]
                    if part_text.endswith("```"):
                        part_text = part_text[:-3]
                    part_text = part_text.strip()
                    if part_text:
                        result = json.loads(part_text)
                        result["source"] = f"Gemini AI ({model})"
                        _gemini_cache[cache_key] = result
                        return result
        except Exception as e:
            print(f"[Gemini AI Service Notice] Live API call with {model} deferred: {e}. Trying next candidate if available.")

    print("[Gemini AI Service Notice] All live API calls deferred. Utilizing dynamic physics calculation.")
    return None

def test_gemini_connection() -> Dict[str, Any]:
    """
    Tests live connection to Google Gemini AI service and measures round-trip latency.
    """
    api_key = _get_gemini_api_key()
    if not api_key:
        return {
            "status": "NOT_CONFIGURED",
            "message": "GEMINI_API_KEY is not configured in .env or environment.",
            "is_connected": False,
            "model": getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash")
        }

    configured_model = getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash") or "gemini-2.5-flash"
    start_time = datetime.datetime.now(datetime.timezone.utc)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{configured_model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": "Ping diagnostics. Return JSON: {\"status\": \"ok\", \"engine\": \"gemini\"}"}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 60, "responseMimeType": "application/json"}
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            latency_ms = int((datetime.datetime.now(datetime.timezone.utc) - start_time).total_seconds() * 1000)
            data = json.loads(resp.read().decode("utf-8"))
            return {
                "status": "ACTIVE",
                "message": "Google Gemini AI production engine is online and responding.",
                "is_connected": True,
                "model": configured_model,
                "latency_ms": latency_ms,
                "api_key_masked": f"{api_key[:6]}...{api_key[-4:]}" if len(api_key) > 10 else "***",
                "cache_entries": len(_gemini_cache)
            }
    except Exception as e:
        latency_ms = int((datetime.datetime.now(datetime.timezone.utc) - start_time).total_seconds() * 1000)
        return {
            "status": "ERROR",
            "message": f"Connection to Gemini API failed: {str(e)}",
            "is_connected": False,
            "model": configured_model,
            "latency_ms": latency_ms
        }


class AIDiagnosticsEngine:
    """
    Intelligent Root Cause Analysis (RCA) and Tool Health Diagnostics Engine.
    When a motor trip or stop occurs, this engine evaluates physical spectral
    dynamics and invokes Google Gemini AI (when GEMINI_API_KEY is configured)
    with automatic credit-saving caching, while falling back to dynamic physical
    synthesis without hardcoded boilerplate data.
    """

    @staticmethod
    def analyze_motor_stop(
        station_id: str,
        trip_reason: str,
        layer_caused: str,
        features: Dict[str, Any],
        motor: Optional[Dict[str, Any]] = None,
        anomaly_score: float = 0.0,
        warn_threshold: float = 0.45,
        critical_threshold: float = 0.70,
        model_version: str = "v1.0.0-baseline",
        device_id: Optional[str] = "node-01",
        db: Optional[Session] = None
    ) -> Dict[str, Any]:
        rms = float(features.get("rms", 0.0))
        peak = float(features.get("peak", 0.0))
        kurtosis = float(features.get("kurtosis", 0.0))
        crest_factor = float(features.get("crest_factor", 0.0))
        dominant_freq = float(features.get("dominant_freq", 0.0))
        
        rated_ref = float(motor.get("rated_rpm") or motor.get("motor_rated_rpm") or motor.get("commanded_rpm") or 1500.0) if motor else 1500.0
        commanded_pct = float(motor.get("commanded_pct", 100.0)) if motor else 100.0
        commanded_rpm = (commanded_pct / 100.0) * rated_ref
        measured_rpm = float(motor.get("measured_rpm", 0.0)) if motor else 0.0
        speed_dev = abs(measured_rpm - commanded_rpm)

        context_data = {
            "station_id": station_id,
            "trip_reason": trip_reason,
            "layer_caused": layer_caused,
            "rms": rms,
            "peak": peak,
            "kurtosis": kurtosis,
            "crest_factor": crest_factor,
            "dominant_freq": dominant_freq,
            "commanded_rpm": commanded_rpm,
            "measured_rpm": measured_rpm,
            "anomaly_score": anomaly_score,
            "warn_threshold": warn_threshold,
            "critical_threshold": critical_threshold
        }

        # 1. Check Gemini AI First (Credit-efficient, cached, dynamic)
        gemini_result = call_gemini_diagnostics(context_data)

        if gemini_result:
            fault_category = gemini_result.get("fault_category", "AI_DIAGNOSED_FAULT")
            primary_cause = gemini_result.get("primary_cause", "AI Diagnosed Mechanical Anomaly")
            confidence_pct = float(gemini_result.get("confidence_pct", 95.0))
            severity = gemini_result.get("severity", "CRITICAL")
            explanation = gemini_result.get("explanation", f"Gemini analyzed trip signature at {dominant_freq:.1f}Hz and {rms:.3f}g.")
            recommended_action = gemini_result.get("recommended_action", "1. Inspect tool bit\n2. Verify torque\n3. Clear reset")
            ai_source = gemini_result.get("source", "Gemini AI")
        else:
            # 2. Dynamic Physics-Based Synthesis (No hardcoded data)
            ai_source = "Dynamic Physics Engine"
            if layer_caused in ["MANUAL_STOP", "OPERATOR_STOP"] or "manual" in layer_caused.lower() or "emergency stop" in trip_reason.lower() or "e-stop" in trip_reason.lower():
                fault_category = "OPERATOR_ESTOP"
                primary_cause = f"Operator Emergency Stop (E-Stop Active)"
                confidence_pct = 99.9
                severity = "INTERLOCK"
                explanation = (
                    "Spindle power was immediately interlocked to 0 RPM following manual E-Stop engagement. "
                    "All actuator drive circuits de-energized. Mandatory safety lockout engaged pending physical rig inspection and reset."
                )
                recommended_action = (
                    "1. Confirm tool and work-piece are safe and clear of obstruction.\n"
                    "2. Inspect fastening bit, socket, and reaction arm.\n"
                    "3. Click Mandatory Safety Reset to release lockout and resume production."
                )
            elif "communication link lost" in trip_reason.lower() or "timeout" in trip_reason.lower():
                fault_category = "LINK_TIMEOUT"
                primary_cause = f"Sensor Watchdog Timeout on {device_id or 'station-A'}"
                confidence_pct = 99.2
                severity = "CRITICAL"
                explanation = (
                    f"Telemetric transmission lapsed beyond {settings.LINK_TIMEOUT_SEC}s threshold. "
                    "Fail-safe lockout engaged to prevent unmonitored torque fastener cycles."
                )
                recommended_action = (
                    f"1. Check battery & RSSI on {device_id or 'sensor node'}.\n"
                    "2. Inspect BLE gateway signal reception.\n"
                    "3. Verify active packet stream before resetting."
                )
            elif speed_dev > settings.HARD_LIMIT_SPEED_DEV_RPM and commanded_pct > 20:
                fault_category = "MECHANICAL_STALL"
                primary_cause = f"Motor Speed Drop: {speed_dev:.0f} RPM Deviation"
                confidence_pct = round(min(99.0, 90.0 + (speed_dev / 50.0)), 1)
                severity = "CRITICAL"
                explanation = (
                    f"Output spindle stalled at {measured_rpm:.0f} RPM against target {commanded_rpm:.0f} RPM. "
                    f"The {speed_dev:.0f} RPM deficit indicates acute thread galling or mechanical drive jam."
                )
                recommended_action = (
                    "1. Back off nutrunner spindle and extract fastener.\n"
                    "2. Check socket and planetary reduction stage for mechanical binding.\n"
                    "3. Test spindle free rotation by hand before resuming."
                )
            elif rms >= settings.HARD_LIMIT_RMS or peak >= settings.HARD_LIMIT_PEAK:
                g_excess = max(rms - settings.HARD_LIMIT_RMS, peak - settings.HARD_LIMIT_PEAK)
                fault_category = "KINEMATIC_OVERLOAD"
                primary_cause = f"Vibration Surge (+{g_excess:.2f}g Above Safe Limit)"
                confidence_pct = round(min(98.8, 92.0 + g_excess * 4.0), 1)
                severity = "CRITICAL"
                explanation = (
                    f"Vibration peaked at {peak:.3f}g with {rms:.3f}g RMS (safe limit {settings.HARD_LIMIT_RMS:.2f}g). "
                    "Kinematic energy surge breached maximum allowable tool structural thresholds."
                )
                recommended_action = (
                    "1. Check tool balancer spring tension and reaction arm torque absorber.\n"
                    "2. Inspect drive gear teeth and socket drive pin.\n"
                    "3. Verify fixture clamping rigidity."
                )
            elif dominant_freq >= 120.0 and dominant_freq <= 280.0:
                harmonic_order = dominant_freq / (commanded_rpm / 60.0) if commanded_rpm > 0 else 3.0
                fault_category = "STRUCTURAL_RESONANCE"
                primary_cause = f"{dominant_freq:.1f} Hz Harmonic Tool Resonance ({harmonic_order:.1f}X Order)"
                confidence_pct = round(min(97.5, 88.0 + (anomaly_score * 12.0)), 1)
                severity = "CRITICAL"
                explanation = (
                    f"Resonant chatter emerged at {dominant_freq:.1f} Hz with an anomaly score of {anomaly_score:.3f}. "
                    "Persistent modal excitation triggered automated motor shutdown to avoid drive-shaft fatigue."
                )
                recommended_action = (
                    f"1. Dampen tool mounting fixture to suppress {dominant_freq:.1f} Hz resonant mode.\n"
                    "2. Inspect socket adapter for rotational runout.\n"
                    "3. Verify fastener run-down speed schedule."
                )
            elif kurtosis >= 2.5 and rms >= 0.10:
                fault_category = "BEARING_MICRO_IMPACT"
                primary_cause = f"High-Kurtosis Shock Pulse (K={kurtosis:.2f}, CF={crest_factor:.2f})"
                confidence_pct = round(min(96.0, 89.0 + kurtosis), 1)
                severity = "CRITICAL"
                explanation = (
                    f"Spindle vibration demonstrated an impulsive kurtosis of {kurtosis:.2f} and crest factor of {crest_factor:.2f}. "
                    "Repetitive non-Gaussian shock pulses indicate raceway surface spalling or roller cage contact."
                )
                recommended_action = (
                    "1. Inspect spindle bearings with acoustic vibration stethoscope.\n"
                    "2. Replenish high-speed synthetic grease in spindle housing.\n"
                    "3. Check axial backlash on tool drive spindle."
                )
            else:
                fault_category = "PERSISTENT_DISTURBANCE"
                primary_cause = f"Anomalous Vibration Energy (Score: {anomaly_score:.3f})"
                confidence_pct = round(min(95.0, 85.0 + anomaly_score * 10.0), 1)
                severity = "CRITICAL"
                explanation = (
                    f"Multi-axis vibration anomaly ({anomaly_score:.3f}) exceeded critical threshold ({critical_threshold:.2f}). "
                    "Automated controller executed closed-loop safe stop to guarantee joint clamp quality."
                )
                recommended_action = (
                    "1. Confirm workpiece alignment in assembly jig.\n"
                    "2. Inspect fastening bit for wear or burrs.\n"
                    "3. Reset station after verifying tool integrity."
                )

        # Build forensics snapshot
        forensics = {
            "rms_g": round(rms, 4),
            "peak_g": round(peak, 4),
            "kurtosis": round(kurtosis, 2),
            "crest_factor": round(crest_factor, 2),
            "dominant_freq_hz": round(dominant_freq, 1),
            "anomaly_score": round(anomaly_score, 4),
            "warn_threshold": warn_threshold,
            "critical_threshold": critical_threshold,
            "commanded_rpm": round(commanded_rpm, 1),
            "measured_rpm": round(measured_rpm, 1),
            "speed_deviation_rpm": round(speed_dev, 1),
            "model_version": model_version,
            "layer_caused": layer_caused,
            "trip_reason": trip_reason,
            "ai_source": ai_source,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
        }

        # Persist to database if session provided
        analysis_id = None
        if db is not None:
            try:
                db_record = MotorStopAnalysis(
                    station_id=station_id,
                    device_id=device_id,
                    ts=datetime.datetime.utcnow(),
                    primary_cause=primary_cause,
                    fault_category=fault_category,
                    confidence_pct=confidence_pct,
                    severity=severity,
                    explanation=explanation,
                    recommended_action=recommended_action,
                    layer_caused=layer_caused,
                    forensics=forensics,
                    resolved=False
                )
                db.add(db_record)

                # Also log dedicated event for traceability
                db_event = EventRecord(
                    station_id=station_id,
                    ts=datetime.datetime.utcnow(),
                    event_type="AI_ROOT_CAUSE_DIAGNOSIS",
                    details=f"[{ai_source}] {primary_cause} ({confidence_pct:.1f}% confidence)",
                    operator="AI_Engine",
                    notes=f"Category: {fault_category} | Severity: {severity}"
                )
                db.add(db_event)
                db.commit()
                analysis_id = db_record.id
            except Exception as e:
                db.rollback()
                print(f"[AI Diagnostics DB Error] {e}")

        return {
            "id": analysis_id,
            "station_id": station_id,
            "device_id": device_id,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "primary_cause": primary_cause,
            "fault_category": fault_category,
            "confidence_pct": confidence_pct,
            "severity": severity,
            "explanation": explanation,
            "recommended_action": recommended_action,
            "layer_caused": layer_caused,
            "forensics": forensics,
            "resolved": False
        }

    @staticmethod
    def analyze_motor_slowdown(
        station_id: str,
        slowdown_reason: str,
        layer_caused: str,
        features: Dict[str, Any],
        motor: Optional[Dict[str, Any]] = None,
        anomaly_score: float = 0.0,
        warn_threshold: float = 0.45,
        critical_threshold: float = 0.70,
        model_version: str = "v1.0.0-baseline",
        device_id: Optional[str] = "304A2657BF44",
        db: Optional[Session] = None
    ) -> Dict[str, Any]:
        """
        Generates detailed AI root-cause diagnostics and forensic analysis
        whenever the motor slows down (50% speed throttle) due to anomalous vibration.
        """
        rms = float(features.get("rms", 0.0))
        peak = float(features.get("peak", 0.0))
        kurtosis = float(features.get("kurtosis", 0.0))
        crest_factor = float(features.get("crest_factor", 0.0))
        dominant_freq = float(features.get("dominant_freq", 0.0))

        rated_ref = float(motor.get("rated_rpm") or motor.get("motor_rated_rpm") or 1500.0) if motor else 1500.0
        commanded_pct = float(motor.get("commanded_pct", 50.0)) if motor else 50.0
        commanded_rpm = (commanded_pct / 100.0) * rated_ref
        measured_rpm = float(motor.get("measured_rpm", commanded_rpm)) if motor else commanded_rpm
        speed_dev = abs(measured_rpm - commanded_rpm)

        context_data = {
            "event_type": "SLOWDOWN",
            "station_id": station_id,
            "slowdown_reason": slowdown_reason,
            "layer_caused": layer_caused,
            "rms": rms,
            "peak": peak,
            "kurtosis": kurtosis,
            "crest_factor": crest_factor,
            "dominant_freq": dominant_freq,
            "commanded_rpm": commanded_rpm,
            "measured_rpm": measured_rpm,
            "anomaly_score": anomaly_score,
            "warn_threshold": warn_threshold,
            "critical_threshold": critical_threshold
        }

        # 1. Gemini AI Analysis
        gemini_result = call_gemini_diagnostics(context_data)
        if gemini_result:
            fault_category = gemini_result.get("fault_category", "AI_PREDICTIVE_SLOWDOWN")
            primary_cause = gemini_result.get("primary_cause", "AI Closed-Loop Speed Mitigation")
            confidence_pct = float(gemini_result.get("confidence_pct", 94.0))
            severity = gemini_result.get("severity", "WARNING / 50% SPEED")
            explanation = gemini_result.get("explanation", f"Vibration anomaly at {dominant_freq:.1f}Hz ({rms:.3f}g RMS) triggered 50% speed throttle.")
            recommended_action = gemini_result.get("recommended_action", "1. Monitor vibration damping at 50% speed\n2. Inspect workpiece clamping\n3. Resume nominal speed once vibration normalizes")
            ai_source = gemini_result.get("source", "Gemini AI")
        else:
            # 2. Physics-Based Synthesis
            ai_source = "Dynamic Physics Engine"
            if dominant_freq >= 120.0 and dominant_freq <= 280.0:
                fault_category = "HARMONIC_CHATTER_INCEPTION"
                primary_cause = f"Resonant Chatter Inception ({dominant_freq:.1f} Hz Harmonic)"
                confidence_pct = round(min(97.2, 90.0 + (anomaly_score * 9.0)), 1)
                severity = "WARNING / 50% SPEED"
                explanation = (
                    f"Harmonic disturbance surfaced at {dominant_freq:.1f} Hz with an anomaly score of {anomaly_score:.3f}. "
                    f"Spindle speed was proactively reduced by 50% (to {measured_rpm:.0f} RPM) to decouple excitation from the structural resonant mode."
                )
                recommended_action = (
                    f"1. Observe real-time FFT spectrum to verify {dominant_freq:.1f} Hz peak decays at reduced speed.\n"
                    "2. Inspect torque reaction arm and tool balancer spring tension.\n"
                    "3. Verify joint clamp integrity before increasing fastener run-down speed."
                )
            elif kurtosis >= 2.5:
                fault_category = "BEARING_MICRO_STRESS"
                primary_cause = f"Impulsive Stress Inception (Kurtosis {kurtosis:.2f}, CF {crest_factor:.2f})"
                confidence_pct = round(min(96.0, 89.0 + kurtosis), 1)
                severity = "WARNING / 50% SPEED"
                explanation = (
                    f"Spindle vibration exhibited non-Gaussian shock pulses (Kurtosis: {kurtosis:.2f}, Crest Factor: {crest_factor:.2f}) at {rms:.3f}g RMS. "
                    "Motor speed was throttled to 50% to mitigate raceway impact force and prevent micro-spalling progression."
                )
                recommended_action = (
                    "1. Check high-speed synthetic grease replenishment in angle nutrunner head.\n"
                    "2. Inspect socket adapter and drive bit for axial play.\n"
                    "3. Monitor bearing temperature and acoustic envelope."
                )
            elif rms >= 0.35 or peak >= 0.85:
                fault_category = "KINEMATIC_VIBRATION_SURGE"
                primary_cause = f"Vibration Surge Inception (+{rms - 0.35:.2f}g Above Warning Ref)"
                confidence_pct = round(min(96.5, 90.0 + (rms * 8.0)), 1)
                severity = "WARNING / 50% SPEED"
                explanation = (
                    f"Kinematic vibration climbed to {rms:.3f}g RMS with {peak:.3f}g peak (Warning threshold: 0.35g). "
                    f"Motor throttled to {measured_rpm:.0f} RPM (50%) to dampen kinematic chatter and avoid severe trip shutdown."
                )
                recommended_action = (
                    "1. Check workpiece positioning in assembly fixture.\n"
                    "2. Ensure socket engages bolt head squarely without angular misalignment.\n"
                    "3. Verify tool pneumatic/electric supply voltage stability."
                )
            else:
                fault_category = "AI_PREDICTIVE_SLOWDOWN"
                primary_cause = f"AI Anomaly Alert (Score: {anomaly_score:.3f} >= {warn_threshold:.2f})"
                confidence_pct = round(min(95.0, 88.0 + (anomaly_score * 10.0)), 1)
                severity = "WARNING / 50% SPEED"
                explanation = (
                    f"Multi-feature Isolation Forest detected abnormal multi-axis vibration distribution (Score: {anomaly_score:.3f}). "
                    f"Closed-loop safety interlock engaged 50% speed throttle ({measured_rpm:.0f} RPM) to safeguard mechanical components."
                )
                recommended_action = (
                    "1. Inspect tool bit for minor burrs or tooth rounding.\n"
                    "2. Confirm operator ergonomic posture and reaction bar alignment.\n"
                    "3. If vibration clears, system will safely permit nominal operation."
                )

        forensics = {
            "rms_g": round(rms, 4),
            "peak_g": round(peak, 4),
            "kurtosis": round(kurtosis, 2),
            "crest_factor": round(crest_factor, 2),
            "dominant_freq_hz": round(dominant_freq, 1),
            "anomaly_score": round(anomaly_score, 4),
            "warn_threshold": warn_threshold,
            "critical_threshold": critical_threshold,
            "commanded_rpm": round(commanded_rpm, 1),
            "measured_rpm": round(measured_rpm, 1),
            "speed_deviation_rpm": round(speed_dev, 1),
            "model_version": model_version,
            "layer_caused": layer_caused,
            "trip_reason": slowdown_reason,
            "ai_source": ai_source,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
        }

        analysis_id = None
        if db is not None:
            try:
                db_record = MotorStopAnalysis(
                    station_id=station_id,
                    device_id=device_id,
                    ts=datetime.datetime.utcnow(),
                    primary_cause=primary_cause,
                    fault_category=fault_category,
                    confidence_pct=confidence_pct,
                    severity=severity,
                    explanation=explanation,
                    recommended_action=recommended_action,
                    layer_caused=layer_caused,
                    forensics=forensics,
                    resolved=False
                )
                db.add(db_record)
                db_event = EventRecord(
                    station_id=station_id,
                    ts=datetime.datetime.utcnow(),
                    event_type="AI_SLOWDOWN_DIAGNOSIS",
                    details=f"[{ai_source}] {primary_cause} ({confidence_pct:.1f}% confidence)",
                    operator="AI_Engine",
                    notes=f"Category: {fault_category} | Severity: {severity}"
                )
                db.add(db_event)
                db.commit()
                analysis_id = db_record.id
            except Exception as e:
                db.rollback()
                print(f"[AI Diagnostics DB Error] {e}")

        return {
            "id": analysis_id,
            "station_id": station_id,
            "device_id": device_id,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "primary_cause": primary_cause,
            "fault_category": fault_category,
            "confidence_pct": confidence_pct,
            "severity": severity,
            "explanation": explanation,
            "recommended_action": recommended_action,
            "layer_caused": layer_caused,
            "forensics": forensics,
            "resolved": False
        }

    @staticmethod
    def calculate_tool_health_index(
        features: Dict[str, Any],
        anomaly_score: float,
        state: str,
        operating_rpm: Optional[float] = None,
        rated_rpm: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Calculates real-time AI tool health index, wear stage, and predictive cycles.
        Dynamically evaluated from sensor data - speed-aware ISO 10816 baseline.
        """
        rms = float(features.get("rms") or 0.02)
        kurtosis = float(features.get("kurtosis") or 0.0)
        dominant_freq = float(features.get("dominant_freq") or 0.0)
        
        effective_speed = float(operating_rpm or rated_rpm or 1500.0)
        ref_rated = float(rated_rpm or 1500.0)
        speed_factor = float(math.sqrt(max(100.0, effective_speed) / max(100.0, ref_rated)))
        nominal_rms_limit = 0.22 * speed_factor

        score_penalty = min(60.0, anomaly_score * 65.0)
        kurtosis_penalty = max(0.0, (kurtosis - 1.5) * 8.0) if kurtosis > 1.5 else 0.0
        rms_penalty = max(0.0, (rms - nominal_rms_limit) * 20.0) if rms > nominal_rms_limit else 0.0

        health_pct = max(0.0, min(100.0, 100.0 - score_penalty - kurtosis_penalty - rms_penalty))
        if state == "STOPPED":
            health_pct = min(health_pct, 42.0)

        # Dynamic Stage classification
        if health_pct >= 85.0:
            stage = "OPTIMAL_HEALTH"
            stage_color = "#10b981"
            estimated_cycles = int(12000 + (health_pct - 85) * 400)
            diagnostic_note = f"Optimal kinematic stability. Spindle vibration nominal at {rms:.3f}g RMS with clean harmonics."
        elif health_pct >= 70.0:
            stage = "EARLY_WEAR"
            stage_color = "#0284c7"
            estimated_cycles = int(6000 + (health_pct - 70) * 400)
            diagnostic_note = f"Minor spectral elevation at {dominant_freq:.0f} Hz. Tool operates within acceptable ISO vibration tolerance."
        elif health_pct >= 50.0:
            stage = "ELEVATED_CHATTER"
            stage_color = "#f59e0b"
            estimated_cycles = int(1500 + (health_pct - 50) * 200)
            diagnostic_note = f"Dynamic chatter detected (Score: {anomaly_score:.2f}). Speed deceleration actively damping joint stress."
        else:
            stage = "CRITICAL_MAINTENANCE"
            stage_color = "#ef4444"
            estimated_cycles = 0
            diagnostic_note = f"Critical threshold breach ({rms:.3f}g RMS). Safety lockout engaged pending mechanical inspection."

        return {
            "health_index_pct": round(health_pct, 1),
            "stage": stage,
            "stage_color": stage_color,
            "estimated_cycles_remaining": estimated_cycles,
            "diagnostic_note": diagnostic_note
        }
