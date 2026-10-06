from typing import Dict, Any, Tuple, Optional
from datetime import datetime
import math
from backend.app.config import settings

class DecisionEngine:
    """
    Dual-layer safety decision engine for assembly tool monitoring.
    Hard limits always take precedence over AI scoring.
    Maintains rigorous state machine with hysteresis, persistence counters,
    and mandatory explicit reset after trip.
    """
    def __init__(self, station_id: str = "station-A"):
        self.station_id = station_id
        self.state: str = "NORMAL" # NORMAL, WARNING, REDUCED_SPEED, STOPPED
        self.indicator_light: str = "GREEN" # GREEN, AMBER, RED
        self.commanded_speed_pct: float = 100.0
        self.consecutive_warn_count: int = 0
        self.consecutive_critical_count: int = 0
        self.consecutive_reduced_speed_disturbance: int = 0
        self.last_decision_reason: str = "System initialized in normal operational state."
        self.last_layer_caused: str = "NONE"
        self.trip_timestamp: Optional[datetime] = None
        self.warn_threshold: float = settings.AI_WARN_THRESHOLD
        self.critical_threshold: float = settings.AI_CRITICAL_THRESHOLD
        self.persistence_windows: int = settings.AI_PERSISTENCE_WINDOWS
        self.hysteresis_delta: float = settings.AI_HYSTERESIS_DELTA
        self.reduced_speed_pct: float = settings.AI_REDUCED_SPEED_PCT
        self.hard_limit_rms: float = getattr(settings, 'HARD_LIMIT_RMS', 1.25)
        self.motor_trip_mode: str = "AUTO"  # "AUTO" (AI Auto Stop) or "MANUAL" (Manual Stop Only / Advisory)
        self.auto_restart_enabled: bool = False
        self.auto_restart_delay_sec: float = 3.0
        self.last_reset_time: Optional[datetime] = None
        self.latest_trip_analysis: Optional[Dict[str, Any]] = None
        self.is_manual_lockout: bool = False
        self.stage1_high_start: Optional[datetime] = None
        self.stage2_high_start: Optional[datetime] = None
        self.stage_duration_sec: float = 5.0
        self.motor_max_rpm: float = 20000.0
        # Load persisted policy from database so restarts NEVER reset the policy to defaults
        self._load_persisted_policy()

    def _load_persisted_policy(self):
        """
        Loads persisted policy from SQLite SystemSetting table.
        Ensures motor_trip_mode (AUTO or MANUAL), auto_restart_enabled, and motor_max_rpm persist across restarts.
        """
        if "test" in self.station_id:
            return
        try:
            from backend.app.database import SessionLocal
            from backend.app.models.schema import SystemSetting
            db = SessionLocal()
            try:
                mode_row = db.query(SystemSetting).filter(SystemSetting.key == "motor_trip_mode").first()
                if mode_row and mode_row.value:
                    val = str(mode_row.value).strip().upper()
                    if val in ["AUTO", "MANUAL"]:
                        self.motor_trip_mode = val

                restart_row = db.query(SystemSetting).filter(SystemSetting.key == "auto_restart_enabled").first()
                if restart_row and restart_row.value:
                    self.auto_restart_enabled = restart_row.value.lower() in ("true", "1", "yes")

                thresh_warn = db.query(SystemSetting).filter(SystemSetting.key == "warn_threshold").first()
                if thresh_warn and thresh_warn.value:
                    self.warn_threshold = max(0.05, min(0.95, float(thresh_warn.value)))

                thresh_crit = db.query(SystemSetting).filter(SystemSetting.key == "critical_threshold").first()
                if thresh_crit and thresh_crit.value:
                    self.critical_threshold = max(self.warn_threshold + 0.05, min(0.99, float(thresh_crit.value)))

                persist_row = db.query(SystemSetting).filter(SystemSetting.key == "persistence_windows").first()
                if persist_row and persist_row.value:
                    self.persistence_windows = int(persist_row.value)

                vib_limit = db.query(SystemSetting).filter(SystemSetting.key == "vibration_limit_g").first()
                if vib_limit and vib_limit.value:
                    self.hard_limit_rms = float(vib_limit.value)

                rpm_row = db.query(SystemSetting).filter(SystemSetting.key == "motor_max_rpm").first()
                if rpm_row and rpm_row.value:
                    self.motor_max_rpm = float(rpm_row.value)

                rated_row = db.query(SystemSetting).filter(SystemSetting.key == "motor_rated_rpm").first()
                if rated_row and rated_row.value:
                    self.motor_rated_rpm = float(rated_row.value)
                else:
                    self.motor_rated_rpm = self.motor_max_rpm
            finally:
                db.close()
        except Exception as e:
            print(f"[DecisionEngine:{self.station_id}] Persisted policy load notice: {e}")

    def update_vibration_limit(self, limit_g: float):
        self.hard_limit_rms = float(limit_g)

    def update_motor_max_rpm(self, max_rpm: float):
        self.motor_max_rpm = float(max_rpm)

    def update_motor_rated_rpm(self, rated_rpm: float):
        self.motor_rated_rpm = float(rated_rpm)

    def update_motor_mode(self, mode: Optional[str] = None, auto_restart: Optional[Any] = None):
        if mode is not None:
            self.motor_trip_mode = str(mode).strip().upper()
        if auto_restart is not None:
            if isinstance(auto_restart, str):
                self.auto_restart_enabled = auto_restart.lower() in ["true", "1", "yes"]
            else:
                self.auto_restart_enabled = bool(auto_restart)

    def evaluate(
        self,
        features: Dict[str, Any],
        anomaly_score: float,
        motor: Optional[Dict[str, Any]] = None,
        link_lost: bool = False
    ) -> Tuple[str, str, float, str, str]:
        """
        Evaluates safety limits and AI anomaly score using a two-stage mitigation policy:
          Stage 1: If high disturbance is detected, FIRST slow down the motor to REDUCED_SPEED (50%).
          Stage 2: If the same high disturbance persists while at reduced speed, command motor STOP (0%).
        Returns:
            (state, indicator_light, commanded_speed_pct, reason, layer_caused)
        """
        rms = features.get("rms", 0.0)
        peak = features.get("peak", 0.0)

        # -------------------------------------------------------------
        # 1. FIXED HARD LIMITS LAYER: SENSOR LINK LOSS
        # -------------------------------------------------------------
        if link_lost:
            if self.motor_trip_mode == "MANUAL":
                self.state = "WARNING"
                self.indicator_light = "AMBER"
                self.last_decision_reason = "Communication Alert (Manual Mode): Link lost. Auto-stop disabled by policy. Awaiting operator manual action."
                self.last_layer_caused = "FIXED_LIMIT"
                return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused
            else:
                self.state = "STOPPED"
                self.indicator_light = "RED"
                self.commanded_speed_pct = 0.0
                self.last_decision_reason = "Fixed Limit: Communication link lost (timeout > 1.0s)."
                self.last_layer_caused = "FIXED_LIMIT"
                if not self.trip_timestamp:
                    self.trip_timestamp = datetime.utcnow()
                return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

        # -------------------------------------------------------------
        # 2. STATE MACHINE TRIP LOCK & AUTO-RESTART POLICY (When STOPPED)
        # -------------------------------------------------------------
        measured_rpm = float(motor.get("measured_rpm", 0.0)) if motor else 0.0
        motor_active_in_api = (measured_rpm > 50.0) or (motor.get("status") in ["RUNNING", "SLOW"] if motor else False)

        if self.state == "STOPPED":
            # Mandatory Industrial Safety Interlock:
            # Once motor is STOPPED, it remains firmly locked in STOPPED state with 0 RPM and RED light.
            # It will NEVER automatically flip back to NORMAL.
            # Only an explicit operator command (RESET / START) will turn the motor on again.
            self.state = "STOPPED"
            self.indicator_light = "RED"
            self.commanded_speed_pct = 0.0
            return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

        # -------------------------------------------------------------
        # 3. DISTURBANCE CONDITIONS EVALUATION
        # -------------------------------------------------------------
        hard_rms_exceeded = (rms >= self.hard_limit_rms)
        hard_peak_exceeded = (peak >= settings.HARD_LIMIT_PEAK)

        # Speed deviation check (only evaluated if motor is commanded to run, after spinup settling)
        speed_dev_exceeded = False
        speed_dev = 0.0
        if motor and self.state != "STOPPED":
            meas_val = float(motor.get("measured_rpm", 0.0))
            nominal_full_rpm = float(getattr(self, "motor_rated_rpm", getattr(self, "motor_max_rpm", 2000.0)))
            cmd_pct = float(motor.get("commanded_pct", 100.0))
            commanded_rpm = (cmd_pct / 100.0) * nominal_full_rpm
            measured_rpm = meas_val
            speed_dev = abs(measured_rpm - commanded_rpm)

            in_spinup_grace = False
            if self.last_reset_time:
                if (datetime.utcnow() - self.last_reset_time).total_seconds() < 8.0:
                    in_spinup_grace = True

            is_settling = (
                in_spinup_grace
                or (self.state == "REDUCED_SPEED")
                or (measured_rpm < 100.0 and commanded_rpm < 100.0)
            )
            # Only trigger hard deviation if motor is completely stalled under load
            is_motor_stalled = (commanded_rpm > 500.0 and measured_rpm < 50.0 and not in_spinup_grace)
            if not is_settling and is_motor_stalled:
                speed_dev_exceeded = True

        # Genuine vibration disturbance condition:
        # Dynamically scaled against the tool's rated speed (ISO 10816/20816) and configured vibration limit
        rated_rpm = float(getattr(self, "motor_rated_rpm", 1500.0))
        speed_factor = float(math.sqrt(max(500.0, rated_rpm) / 1500.0))
        disturbed_rms_ref = max(0.12, min(self.hard_limit_rms * 0.45, 0.22 * speed_factor))
        disturbed_peak_ref = disturbed_rms_ref * 2.25

        is_vibration_disturbed = (rms > disturbed_rms_ref or peak > disturbed_peak_ref or hard_rms_exceeded or hard_peak_exceeded)

        ai_critical = (anomaly_score >= self.critical_threshold and is_vibration_disturbed)
        ai_warn = (anomaly_score >= self.warn_threshold and is_vibration_disturbed)

        # Update anomaly persistence counters
        if ai_critical or hard_rms_exceeded or hard_peak_exceeded or speed_dev_exceeded:
            self.consecutive_critical_count += 1
            self.consecutive_warn_count += 1
        elif ai_warn:
            self.consecutive_critical_count = 0
            self.consecutive_warn_count += 1
        else:
            exit_threshold = max(0.0, self.warn_threshold - self.hysteresis_delta)
            if (anomaly_score < exit_threshold or not is_vibration_disturbed) and not hard_rms_exceeded and not hard_peak_exceeded and not speed_dev_exceeded:
                self.consecutive_warn_count = 0
                self.consecutive_critical_count = 0
                self.consecutive_reduced_speed_disturbance = 0

        # Disturbance checks
        ai_high = (ai_critical or ai_warn)
        hard_disturbance = (hard_rms_exceeded or hard_peak_exceeded or speed_dev_exceeded)

        # High disturbance is present if fixed limit exceeded, AI anomaly score is high with vibration disturbance, or persistence met
        is_high_disturbance = (
            hard_disturbance
            or ai_high
            or (self.consecutive_critical_count >= self.persistence_windows and is_vibration_disturbed)
            or (self.consecutive_warn_count >= self.persistence_windows and is_vibration_disturbed)
        )

        layer_cause = "FIXED_LIMIT" if hard_disturbance else "AI_LAYER"

        # -------------------------------------------------------------
        # 4. TWO-STAGE AI ANOMALY CONTROL POLICY:
        #    Stage 1: If AI anomaly score is HIGH in NORMAL -> FIRST reduce speed to 50%.
        #    Stage 2: After reducing speed:
        #             - If AI anomaly score is AGAIN HIGH -> STOP motor (0 RPM).
        #             - If NO anomaly score after reducing speed -> DO NOT STOP (maintain safe mitigated speed).
        # -------------------------------------------------------------

        # --- STAGE 2: Already operating at REDUCED_SPEED or WARNING ---
        if self.state in ["REDUCED_SPEED", "WARNING"]:
            if is_high_disturbance:
                # AI anomaly score is AGAIN HIGH while operating at reduced speed
                if self.stage2_high_start is None:
                    self.stage2_high_start = datetime.utcnow()
                elapsed_stage2 = (datetime.utcnow() - self.stage2_high_start).total_seconds()

                if elapsed_stage2 < self.stage_duration_sec:
                    # Anomaly high again at reduced speed; awaiting confirmation persistence before emergency trip
                    self.commanded_speed_pct = self.reduced_speed_pct
                    self.indicator_light = "AMBER"
                    remaining = max(0.0, self.stage_duration_sec - elapsed_stage2)
                    trigger_label = f"Score {anomaly_score:.2f} >= {self.warn_threshold:.2f}" if ai_high else f"RMS {rms:.2f}g"
                    self.last_decision_reason = (
                        f"Stage 2 Monitoring (Reduced Speed): Anomaly high again ({trigger_label}) for {elapsed_stage2:.1f}s / {self.stage_duration_sec:.0f}s. "
                        f"Spindle throttled at {self.reduced_speed_pct:.0f}%. Safety STOP in {remaining:.1f}s if condition persists."
                    )
                    self.last_layer_caused = layer_cause
                    return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused
                else:
                    # AI score remained high again at reduced speed -> COMMAND COMPLETE STOP!
                    if self.motor_trip_mode == "MANUAL":
                        self.state = "WARNING"
                        self.indicator_light = "AMBER"
                        self.last_decision_reason = (
                            f"Stage 2 Trip Alert (Manual Mode Active): Anomaly remained high again for {self.stage_duration_sec:.0f}s at reduced speed. "
                            f"Auto-stop disabled by policy. Awaiting operator manual stop via API."
                        )
                        self.last_layer_caused = layer_cause
                        return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused
                    else:
                        self.state = "STOPPED"
                        self.indicator_light = "RED"
                        self.commanded_speed_pct = 0.0
                        self.trip_timestamp = datetime.utcnow()
                        self.stage1_high_start = None
                        self.stage2_high_start = None
                        self.last_decision_reason = (
                            f"Two-Stage AI Safety Shutdown: AI Anomaly Score remained high again for {self.stage_duration_sec:.0f}s after speed reduction. "
                            f"Motor commanded to complete STOP (0 RPM) to protect spindle."
                        )
                        self.last_layer_caused = layer_cause
                        return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused
            else:
                # Disturbance mitigated / NO anomaly score after reducing the speed!
                # DO NOT STOP THE MOTOR! Maintain safe mitigated operation.
                self.stage2_high_start = None
                self.consecutive_warn_count = 0
                self.consecutive_critical_count = 0
                self.consecutive_reduced_speed_disturbance = 0

                self.commanded_speed_pct = self.reduced_speed_pct
                self.indicator_light = "AMBER"
                self.last_decision_reason = (
                    f"AI Closed-Loop Mitigation Active: Tool speed reduced to {self.reduced_speed_pct:.0f}%. "
                    f"Vibration anomaly mitigated (Score {anomaly_score:.2f} < {self.warn_threshold:.2f}). Motor maintaining safe operation without stopping."
                )
                self.last_layer_caused = "AI_LAYER"
                return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

        # --- STAGE 1: Currently in NORMAL operation ---
        if self.state == "NORMAL":
            if is_high_disturbance:
                # FIRST ACTION: Immediately reduce speed to 50%!
                self.state = "REDUCED_SPEED"
                self.indicator_light = "AMBER"
                self.commanded_speed_pct = self.reduced_speed_pct
                self.stage1_high_start = None
                self.stage2_high_start = None  # Start Stage 2 evaluation fresh once operating at reduced speed
                trigger_label = f"Score {anomaly_score:.2f} >= {self.warn_threshold:.2f}" if ai_high else f"RMS {rms:.2f}g"
                rated_val = float(getattr(self, "motor_rated_rpm", getattr(self, "motor_max_rpm", 2000.0)))
                target_rpm_val = int(rated_val * (self.reduced_speed_pct / 100.0))
                target_rpm_text = f"{target_rpm_val:,} RPM"
                self.last_decision_reason = (
                    f"AI Anomaly Detected ({trigger_label}): First action speed reduced to {self.reduced_speed_pct:.0f}% ({target_rpm_text}). "
                    f"Evaluating vibration at reduced speed: will stop only if anomaly persists/recurs."
                )
                self.last_layer_caused = layer_cause
                return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

            # Nominal normal operation (anomaly score is low)
            exit_threshold = max(0.0, self.warn_threshold - self.hysteresis_delta)
            if anomaly_score < exit_threshold and not hard_disturbance:
                self.stage1_high_start = None
                self.stage2_high_start = None
                self.indicator_light = "GREEN"
                self.commanded_speed_pct = 100.0
                self.consecutive_reduced_speed_disturbance = 0
                self.last_decision_reason = "Nominal operation within limits."
                self.last_layer_caused = "NONE"
                return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

            return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

        return self.state, self.indicator_light, self.commanded_speed_pct, self.last_decision_reason, self.last_layer_caused

    def reset(self, operator: str = "Operator", notes: Optional[str] = None) -> Dict[str, Any]:
        """
        Explicit operator reset when station is stopped.
        Restores state to NORMAL, 100% speed, and GREEN light.
        """
        prev_state = self.state
        self.state = "NORMAL"
        self.indicator_light = "GREEN"
        self.commanded_speed_pct = 100.0
        self.stage1_high_start = None
        self.stage2_high_start = None
        self.consecutive_warn_count = 0
        self.consecutive_critical_count = 0
        self.consecutive_reduced_speed_disturbance = 0
        self.trip_timestamp = None
        self.last_reset_time = datetime.utcnow()
        self.is_manual_lockout = False
        self.last_decision_reason = f"Manual reset executed by {operator}. Restored to NORMAL state."
        self.last_layer_caused = "MANUAL_RESET"
        
        return {
            "status": "success",
            "previous_state": prev_state,
            "current_state": self.state,
            "operator": operator,
            "notes": notes,
            "timestamp": datetime.utcnow()
        }

    def manual_stop(self, operator: str = "Operator", notes: Optional[str] = None) -> Dict[str, Any]:
        """
        Operator emergency stop command.
        """
        self.state = "STOPPED"
        self.indicator_light = "RED"
        self.commanded_speed_pct = 0.0
        self.stage1_high_start = None
        self.stage2_high_start = None
        self.is_manual_lockout = True
        self.last_decision_reason = f"Manual emergency stop commanded by {operator}."
        self.last_layer_caused = "MANUAL_STOP"
        self.trip_timestamp = datetime.utcnow()
        
        return {
            "status": "success",
            "current_state": self.state,
            "operator": operator,
            "notes": notes,
            "timestamp": datetime.utcnow()
        }

    def update_thresholds(self, warn: float, critical: float, persistence: Optional[int] = None):
        self.warn_threshold = max(0.05, min(0.95, float(warn)))
        self.critical_threshold = max(self.warn_threshold + 0.05, min(0.99, float(critical)))
        if persistence:
            self.persistence_windows = persistence

# Global station decision engines registry
_station_engines: Dict[str, DecisionEngine] = {}

def get_decision_engine(station_id: str = "station-A") -> DecisionEngine:
    global _station_engines
    if not station_id:
        station_id = "station-A"
    if station_id not in _station_engines:
        _station_engines[station_id] = DecisionEngine(station_id)
    return _station_engines[station_id]

def reset_all_decision_engines(operator: str = "Operator", notes: Optional[str] = None) -> Dict[str, Any]:
    global _station_engines
    if "station-A" not in _station_engines:
        _station_engines["station-A"] = DecisionEngine("station-A")
    results = {}
    for sid, eng in list(_station_engines.items()):
        results[sid] = eng.reset(operator=operator, notes=notes)
    return results
