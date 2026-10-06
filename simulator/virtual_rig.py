import time
import math
import random
import asyncio
import numpy as np
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from backend.app.schemas.pydantic_models import IngestPayload, MotorData, VibrationFeatures

def get_configured_motor_rpm() -> float:
    try:
        from backend.app.database import SessionLocal
        from backend.app.models.schema import SystemSetting
        db = SessionLocal()
        try:
            row = db.query(SystemSetting).filter(SystemSetting.key == "motor_rated_rpm").first()
            if row and row.value:
                return float(row.value)
            row_max = db.query(SystemSetting).filter(SystemSetting.key == "motor_max_rpm").first()
            if row_max and row_max.value:
                return float(row_max.value)
        finally:
            db.close()
    except Exception:
        pass
    return 1500.0

class VirtualMotor:
    def __init__(self, max_rpm: Optional[float] = None, time_constant: float = 0.3):
        conf_rpm = get_configured_motor_rpm() if max_rpm is None else float(max_rpm)
        self.max_rpm: float = conf_rpm
        self.rated_rpm: float = conf_rpm
        self.time_constant: float = time_constant
        self.commanded_pct: float = 100.0
        self.current_rpm: float = conf_rpm
        self.is_stalled: bool = False

    def set_rated_rpm(self, rated_rpm: float):
        """Dynamically updates the default/rated RPM whenever configured in Settings."""
        val = max(100.0, float(rated_rpm))
        self.max_rpm = val
        self.rated_rpm = val
        if not self.is_stalled:
            self.current_rpm = (self.commanded_pct / 100.0) * self.max_rpm

    def update(self, dt: float, commanded_pct: float):
        if self.is_stalled or commanded_pct == 0.0:
            self.commanded_pct = 0.0
            self.current_rpm = 0.0
            return
        self.commanded_pct = max(0.0, min(100.0, commanded_pct))
        target_rpm = (self.commanded_pct / 100.0) * self.max_rpm
        # First-order response
        alpha = dt / (self.time_constant + dt)
        self.current_rpm += alpha * (target_rpm - self.current_rpm)

    def get_measured_rpm(self) -> float:
        if self.current_rpm < 10.0:
            return 0.0
        noise = random.gauss(0.0, 8.0)
        return max(0.0, self.current_rpm + noise)

class VirtualHardwareSimulator:
    def __init__(self, device_id: str = "node-01", station_id: str = "station-A"):
        self.device_id = device_id
        self.station_id = station_id
        self.motor = VirtualMotor()
        self.sample_rate_hz: int = 1000
        self.seq: int = 1000
        
        # Scenarios: "normal", "disturbance_on", "disturbance_ramp", "sensor_dropout", "packet_loss", "noisy_normal"
        self.scenario: str = "normal"
        self.exciter_amplitude: float = 0.85 # g
        self.exciter_freq_hz: float = 180.0  # Hz
        self.ramp_start_time: Optional[float] = None
        
        # State & metrics
        self.is_running: bool = False
        self.indicator_light: str = "GREEN"
        self.station_state: str = "NORMAL"
        self.battery_pct: float = 98.0
        self.rssi: float = -58.0
        
        # Recording buffer
        self.is_recording: bool = False
        self.recording_label: str = "normal"
        self.recorded_packets: List[Dict[str, Any]] = []

    def set_scenario(self, scenario: str, amplitude: Optional[float] = None, freq: Optional[float] = None, seed: Optional[int] = None):
        self.scenario = scenario
        if amplitude is not None:
            self.exciter_amplitude = amplitude
        if freq is not None:
            self.exciter_freq_hz = freq
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)
        if scenario == "disturbance_ramp":
            self.ramp_start_time = time.time()
        print(f"[Simulator] Scenario switched to: {scenario} (Amp: {self.exciter_amplitude}g, Freq: {self.exciter_freq_hz}Hz)")

    def apply_backend_command(self, commanded_speed_pct: float, indicator_light: str, station_state: str):
        """
        Feedback from backend decision engine:
        Reacts to speed reduction or stop commands.
        """
        self.indicator_light = indicator_light
        self.station_state = station_state
        self.motor.commanded_pct = commanded_speed_pct
        if station_state == "STOPPED" or commanded_speed_pct <= 0.0:
            self.motor.is_stalled = True
            self.motor.commanded_pct = 0.0
            self.motor.current_rpm = 0.0
        else:
            self.motor.is_stalled = False

    def generate_window(self, num_samples: int = 1000) -> List[float]:
        """
        Generates 1-second synthetic accelerometer window matching physics of the rig.
        """
        rpm = self.motor.current_rpm
        rated_ref = max(100.0, getattr(self.motor, "rated_rpm", getattr(self.motor, "max_rpm", 1500.0)))
        speed_factor = rpm / rated_ref
        t = np.linspace(0, (num_samples - 1) / self.sample_rate_hz, num_samples)
        
        # If motor is stopped (0 rpm), return baseline quiescent noise
        if rpm < 20.0:
            return (np.random.normal(0.0, 0.02, num_samples)).tolist()

        # 1. Base motor harmonics (1x, 2x, 3x shaft speed)
        f_fund = (rpm / 60.0) * 2
        h1 = 0.15 * speed_factor * np.sin(2 * np.pi * f_fund * t)
        h2 = 0.08 * speed_factor * np.sin(2 * np.pi * (2 * f_fund) * t + 0.5)
        h3 = 0.04 * speed_factor * np.sin(2 * np.pi * (3 * f_fund) * t + 1.2)
        signal = h1 + h2 + h3

        # 2. Add Scenario-specific signals
        if self.scenario == "normal":
            noise_std = 0.04
            signal += np.random.normal(0.0, noise_std, num_samples)

        elif self.scenario == "noisy_normal":
            # Higher background broadband noise, but no fault harmonic
            noise_std = 0.18
            signal += np.random.normal(0.0, noise_std, num_samples)

        elif self.scenario == "disturbance_on":
            # Exciter vibration at fault frequency (e.g. 180 Hz)
            # Physical characteristic: reducing spindle speed reduces excitation energy
            f_fault = self.exciter_freq_hz
            # If severe chatter (>1.2g), severe mechanical fault persists at any speed and trips to STOP.
            # If moderate harmonic disturbance, reducing spindle speed mitigates resonance so motor runs safely at 50%.
            if self.exciter_amplitude >= 1.20:
                amp = self.exciter_amplitude
            else:
                # Moderate harmonic resonance occurs at nominal spindle speed (~1500 RPM / speed_factor > 0.65).
                # When speed is throttled to 50% (speed_factor <= 0.60), the spindle leaves the resonant band,
                # mitigating the disturbance and returning vibration to nominal operating levels.
                if speed_factor <= 0.60:
                    amp = 0.03 # Resonance mitigated at reduced speed
                else:
                    amp = self.exciter_amplitude
            fault_sig = (
                amp * np.sin(2 * np.pi * f_fault * t) +
                (amp * 0.35) * np.sin(2 * np.pi * (2 * f_fault) * t + 0.3)
            )
            noise_std = 0.04 * max(0.4, speed_factor)
            signal += fault_sig + np.random.normal(0.0, noise_std, num_samples)

        elif self.scenario == "disturbance_ramp":
            # Gradually increasing amplitude from 0.1g to 1.5g
            elapsed = time.time() - (self.ramp_start_time or time.time())
            ramp_amp = min(1.5, 0.1 + elapsed * 0.10)
            f_fault = self.exciter_freq_hz
            fault_sig = ramp_amp * np.sin(2 * np.pi * f_fault * t)
            signal += fault_sig + np.random.normal(0.0, 0.05, num_samples)

        else: # e.g. packet_loss or sensor_dropout (when not dropped)
            signal += np.random.normal(0.0, 0.04, num_samples)

        return [round(float(s), 4) for s in signal]

    def step(self, dt: float = 0.1) -> Optional[IngestPayload]:
        """
        Advances virtual rig by dt seconds and produces standard IngestPayload.
        Returns None if packet dropped (e.g. in dropout / packet loss scenarios).
        """
        self.motor.update(dt, self.motor.commanded_pct)
        self.seq += 1

        # Simulate dropout scenario (silence to trigger link lost)
        if self.scenario == "sensor_dropout":
            return None

        # Simulate random packet loss (e.g. 35% loss)
        if self.scenario == "packet_loss" and random.random() < 0.35:
            return None

        window_data = self.generate_window(1000)
        measured_rpm = round(self.motor.get_measured_rpm(), 1)

        payload = IngestPayload(
            device_id=self.device_id,
            station_id=self.station_id,
            ts=datetime.now(timezone.utc),
            seq=self.seq,
            sample_rate_hz=self.sample_rate_hz,
            window=window_data,
            axes="xyz",
            motor=MotorData(
                commanded_pct=round(self.motor.commanded_pct, 1),
                measured_rpm=measured_rpm,
                current_amps=round(2.5 * (self.motor.current_rpm / max(100.0, getattr(self.motor, "rated_rpm", getattr(self.motor, "max_rpm", 1500.0)))) + random.gauss(0, 0.05), 2)
            ),
            battery_pct=round(self.battery_pct, 1),
            rssi=round(self.rssi + random.gauss(0, 1.0), 1)
        )

        if self.is_recording:
            # Buffer recorded features for training session
            from backend.app.core.feature_extractor import extract_features, features_to_vector
            feats, _ = extract_features(window_data, self.sample_rate_hz)
            self.recorded_packets.append({
                "ts": payload.ts.isoformat(),
                "seq": payload.seq,
                "label": self.recording_label,
                "features": feats,
                "features_vector": features_to_vector(feats).tolist()
            })

        return payload

    def start_recording(self, label: str):
        self.is_recording = True
        self.recording_label = label
        self.recorded_packets = []
        print(f"[Simulator] Recording started. Label: '{label}'")

    def stop_recording(self) -> List[Dict[str, Any]]:
        self.is_recording = False
        data = list(self.recorded_packets)
        self.recorded_packets = []
        print(f"[Simulator] Recording stopped. Saved {len(data)} packets.")
        return data

# Global simulator instance
simulator_rig = VirtualHardwareSimulator()
