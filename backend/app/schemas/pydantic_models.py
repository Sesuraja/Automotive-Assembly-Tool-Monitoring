from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime

class MotorData(BaseModel):
    commanded_pct: float = 100.0
    measured_rpm: float = 0.0
    current_amps: Optional[float] = None

class VibrationFeatures(BaseModel):
    rms: float
    peak: float
    peak_to_peak: Optional[float] = None
    crest_factor: Optional[float] = None
    kurtosis: Optional[float] = None
    skewness: Optional[float] = None
    dominant_freq: Optional[float] = None
    spectral_centroid: Optional[float] = None
    band_energies: Optional[Dict[str, float]] = None

class IngestPayload(BaseModel):
    device_id: str
    station_id: str = "station-A"
    ts: datetime
    seq: int
    sample_rate_hz: int = 1000
    window: Optional[List[float]] = None
    axes: str = "xyz"
    features: Optional[VibrationFeatures] = None
    motor: Optional[MotorData] = None
    battery_pct: Optional[float] = None
    rssi: Optional[float] = None
    temperature: Optional[float] = None
    status: Optional[str] = None
    decision: Optional[str] = None
    anomaly_score: Optional[float] = None

class StationControlCommand(BaseModel):
    action: Optional[str] = "COMMAND" # "RESET", "STOP", "SET_SPEED"
    speed_pct: Optional[float] = None
    operator: Optional[str] = "Operator"
    notes: Optional[str] = None

class SimulatorScenarioRequest(BaseModel):
    scenario: str # "normal", "disturbance_on", "disturbance_ramp", "sensor_dropout", "packet_loss", "noisy_normal"
    exciter_amplitude: Optional[float] = None
    exciter_freq_hz: Optional[float] = None
    commanded_speed_pct: Optional[float] = None
    random_seed: Optional[int] = None

class MotorSpeedCommandRequest(BaseModel):
    commanded_speed_pct: float

class SimulatorStateResponse(BaseModel):
    is_running: bool
    scenario: str
    exciter_amplitude: float
    exciter_freq_hz: float
    commanded_speed_pct: float
    virtual_rpm: float
    last_seq: int
    is_dropout: bool
    is_packet_loss: bool
    indicator_light: str
    station_state: str

class LiveBroadcastMessage(BaseModel):
    device_id: str
    station_id: str
    ts: datetime
    seq: int
    state: str # NORMAL, WARNING, REDUCED_SPEED, STOPPED
    indicator_light: str # GREEN, AMBER, RED
    commanded_speed_pct: float
    measured_rpm: float
    features: VibrationFeatures
    raw_anomaly_score: float
    smoothed_anomaly_score: float
    warn_threshold: float
    critical_threshold: float
    last_decision_reason: str
    layer_caused: str # "FIXED_LIMIT" | "AI_LAYER" | "NONE"
    battery_pct: Optional[float] = 100.0
    rssi: Optional[float] = -55.0
    fft_spectrum: Optional[List[Dict[str, float]]] = None # for spectral chart

class TrainModelRequest(BaseModel):
    model_version: str
    model_type: str = "IsolationForest" # "IsolationForest" or "RandomForest"
    normal_recording_ids: List[str]
    disturbed_recording_ids: List[str]
    contamination: Optional[float] = 0.05
    warn_threshold: Optional[float] = 0.45
    critical_threshold: Optional[float] = 0.70

class ModelResponse(BaseModel):
    id: str
    version: str
    model_type: str
    metrics: Dict[str, Any]
    thresholds: Dict[str, float]
    active_flag: bool
    created_at: datetime

class UserLoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str

class UserProfileResponse(BaseModel):
    username: str
    role: str
    email: str

class ProfileUpdateRequest(BaseModel):
    current_username: str
    new_username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
