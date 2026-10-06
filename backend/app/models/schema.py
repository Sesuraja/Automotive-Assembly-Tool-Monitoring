import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text, JSON
)
from sqlalchemy.orm import relationship
from backend.app.database import Base

class Organization(Base):
    __tablename__ = "orgs"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    plants = relationship("Plant", back_populates="org", cascade="all, delete-orphan")

class Plant(Base):
    __tablename__ = "plants"
    id = Column(String, primary_key=True)
    org_id = Column(String, ForeignKey("orgs.id"))
    name = Column(String, nullable=False)
    location = Column(String)
    
    org = relationship("Organization", back_populates="plants")
    lines = relationship("Line", back_populates="plant", cascade="all, delete-orphan")

class Line(Base):
    __tablename__ = "lines"
    id = Column(String, primary_key=True)
    plant_id = Column(String, ForeignKey("plants.id"))
    name = Column(String, nullable=False)
    
    plant = relationship("Plant", back_populates="lines")
    stations = relationship("Station", back_populates="line", cascade="all, delete-orphan")

class Station(Base):
    __tablename__ = "stations"
    id = Column(String, primary_key=True)
    line_id = Column(String, ForeignKey("lines.id"))
    name = Column(String, nullable=False)
    state = Column(String, default="NORMAL") # NORMAL, WARNING, REDUCED_SPEED, STOPPED
    indicator_light = Column(String, default="GREEN") # GREEN, AMBER, RED
    commanded_speed_pct = Column(Float, default=100.0)
    current_model_version = Column(String, default="v1.0.0-baseline")
    
    line = relationship("Line", back_populates="stations")
    devices = relationship("Device", back_populates="station", cascade="all, delete-orphan")

class Device(Base):
    __tablename__ = "devices"
    id = Column(String, primary_key=True) # e.g. "node-01"
    station_id = Column(String, ForeignKey("stations.id"))
    name = Column(String, nullable=False)
    device_type = Column(String, default="vibration_node")
    api_key = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    last_seen = Column(DateTime, nullable=True)
    
    station = relationship("Station", back_populates="devices")

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="Operator") # Admin, Engineer, Operator, Viewer
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class RawWindow(Base):
    __tablename__ = "raw_windows"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, index=True, nullable=False)
    station_id = Column(String, index=True, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    seq = Column(Integer, nullable=False)
    sample_rate_hz = Column(Integer, default=1000)
    axes = Column(String, default="xyz")
    window_json = Column(Text, nullable=False) # JSON array of samples

class FeatureRecord(Base):
    __tablename__ = "features"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, index=True, nullable=False)
    station_id = Column(String, index=True, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    rms = Column(Float, nullable=False)
    peak = Column(Float, nullable=False)
    peak_to_peak = Column(Float, nullable=True)
    crest_factor = Column(Float, nullable=True)
    kurtosis = Column(Float, nullable=True)
    skewness = Column(Float, nullable=True)
    dominant_freq = Column(Float, nullable=True)
    spectral_centroid = Column(Float, nullable=True)
    band_energies = Column(JSON, nullable=True)

class AnomalyScoreRecord(Base):
    __tablename__ = "anomaly_scores"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, index=True, nullable=False)
    station_id = Column(String, index=True, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    model_version = Column(String, index=True)
    raw_score = Column(Float, nullable=False)
    smoothed_score = Column(Float, nullable=False)
    state = Column(String, default="NORMAL")

class DecisionRecord(Base):
    __tablename__ = "decisions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, index=True, nullable=False)
    station_id = Column(String, index=True, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    state = Column(String, nullable=False)
    reason = Column(String, nullable=False)
    layer_caused = Column(String, nullable=False) # "FIXED_LIMIT" or "AI_LAYER"
    commanded_speed_pct = Column(Float, nullable=False)
    indicator_light = Column(String, default="GREEN")

class MotorTelemetry(Base):
    __tablename__ = "motor_telemetry"
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, index=True, nullable=False)
    station_id = Column(String, index=True, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    commanded_pct = Column(Float, nullable=False)
    measured_rpm = Column(Float, nullable=False)
    current_amps = Column(Float, nullable=True)

class EventRecord(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    station_id = Column(String, index=True, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    event_type = Column(String, nullable=False) # TRIP, RESET, DISTURBANCE_ON, DISTURBANCE_OFF, LINK_LOST, SPEED_CHANGE
    details = Column(String, nullable=True)
    operator = Column(String, nullable=True)
    notes = Column(String, nullable=True)

class Recording(Base):
    __tablename__ = "recordings"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    label = Column(String, nullable=False) # "normal" or "disturbed"
    sample_count = Column(Integer, default=0)
    duration_sec = Column(Float, default=0.0)
    file_path = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class MLModelRecord(Base):
    __tablename__ = "models"
    id = Column(String, primary_key=True)
    version = Column(String, unique=True, nullable=False)
    model_type = Column(String, default="IsolationForest")
    metrics = Column(JSON, nullable=True) # confusion matrix, ROC-AUC, accuracy, precision, recall
    thresholds = Column(JSON, nullable=True) # warn_threshold, critical_threshold
    artifact_path = Column(String, nullable=False)
    active_flag = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=True)
    username = Column(String, nullable=True)
    action = Column(String, nullable=False)
    resource = Column(String, nullable=True)
    details = Column(String, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)

class VendorGatewayConfig(Base):
    __tablename__ = "vendor_gateways"
    id = Column(String, primary_key=True, default="default-vendor-gateway")
    name = Column(String, nullable=False, default="Primary Industrial BLE Gateway")
    vendor_type = Column(String, default="GenericREST") # Cassia, Minew, Nordic, Teltonika, GenericREST
    api_url = Column(String, nullable=True)
    api_key = Column(String, nullable=True)
    poll_interval_sec = Column(Float, default=1.0)
    station_id = Column(String, default="station-A")
    mac_filter = Column(String, nullable=True, default="C4:4F:33:18:9A:2B")
    is_active = Column(Boolean, default=False)
    last_sync = Column(DateTime, nullable=True)
    last_status = Column(String, default="unconfigured")
    last_error = Column(String, nullable=True)
    packets_received = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)

class MotorStopAnalysis(Base):
    __tablename__ = "motor_stop_analyses"
    id = Column(Integer, primary_key=True, autoincrement=True)
    station_id = Column(String, index=True, nullable=False)
    device_id = Column(String, nullable=True)
    ts = Column(DateTime, index=True, default=datetime.datetime.utcnow)
    primary_cause = Column(String, nullable=False)
    fault_category = Column(String, nullable=False) # TOOL_RESONANCE, BEARING_DEGRADATION, MECHANICAL_JAM, HARD_LIMIT_EXCEEDED, LINK_TIMEOUT, MANUAL_ESTOP
    confidence_pct = Column(Float, nullable=False, default=95.0)
    severity = Column(String, default="CRITICAL") # CRITICAL, WARNING, INFO
    explanation = Column(Text, nullable=False)
    recommended_action = Column(Text, nullable=False)
    layer_caused = Column(String, nullable=False) # AI_LAYER, FIXED_LIMIT, OPERATOR
    forensics = Column(JSON, nullable=True)
    resolved = Column(Boolean, default=False)
    resolved_by = Column(String, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolution_notes = Column(Text, nullable=True)

class SystemSetting(Base):
    __tablename__ = "system_settings"
    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


