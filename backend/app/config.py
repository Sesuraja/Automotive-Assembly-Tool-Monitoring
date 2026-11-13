import os
from typing import Optional
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load environment variables from .env if present
load_dotenv()

class Settings(BaseSettings):
    PROJECT_NAME: str = "Automotive Assembly Tool Monitoring"
    API_V1_STR: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite:///./tool_monitor.db"
    )
    
    # JWT Authentication & Authorization
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-jwt-key-auto-tool-monitoring-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 # 24 hours
    ALLOW_DEMO_UNAUTHENTICATED: bool = os.getenv("ALLOW_DEMO_UNAUTHENTICATED", "false").lower() in ("true", "1", "yes")

    # Allowed CORS Origins
    ALLOWED_ORIGINS: str = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000"
    )
    
    # Hard Safety Limits (Fixed layer - always active independent of AI)
    HARD_LIMIT_RMS: float = 1.25          # g
    HARD_LIMIT_PEAK: float = 3.20         # g
    HARD_LIMIT_SPEED_DEV_RPM: float = 500.0 # RPM deviation
    LINK_TIMEOUT_SEC: float = float(os.getenv("LINK_TIMEOUT_SEC", "5.0")) # 5.0s packet silence -> Link Lost
    LINK_LOST_ACTION: str = "STOP"        # "STOP" or "REDUCE"
    
    # AI Layer Thresholds (Adjustable per station/model)
    AI_WARN_THRESHOLD: float = 0.45       # Score [0..1]
    AI_CRITICAL_THRESHOLD: float = 0.70   # Score [0..1]
    AI_PERSISTENCE_WINDOWS: int = int(os.getenv("AI_PERSISTENCE_WINDOWS", "1")) # 1: First high anomaly reduces speed, second stops
    AI_HYSTERESIS_DELTA: float = 0.10     # Exit threshold must be (threshold - delta)
    AI_REDUCED_SPEED_PCT: float = 50.0    # Motor speed commanded when in WARNING / REDUCED_SPEED
    
    # Ingestion & Windowing
    DEFAULT_SAMPLE_RATE_HZ: int = 1000
    WINDOW_SIZE_SAMPLES: int = 1000       # 1 sec window at 1 kHz
    WINDOW_OVERLAP_SAMPLES: int = 500     # 50% overlap

    # Database Retention & Storage Optimization
    TELEMETRY_RETENTION_MAX_ROWS: int = int(os.getenv("TELEMETRY_RETENTION_MAX_ROWS", "3000"))
    AUTO_PRUNE_INTERVAL_PACKETS: int = int(os.getenv("AUTO_PRUNE_INTERVAL_PACKETS", "500"))
    
    # Vendor API Base & BLE Gateway Integration Settings
    VENDOR_API_BASE_URL: str = os.getenv(
        "VENDOR_API_BASE_URL",
        "https://gateway.apertureventurestudio.com"
    )
    VENDOR_BLE_GATEWAY_URL: Optional[str] = os.getenv(
        "VENDOR_BLE_GATEWAY_URL",
        "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest"
    )
    VENDOR_BLE_GATEWAY_HISTORY_URL: Optional[str] = os.getenv(
        "VENDOR_BLE_GATEWAY_HISTORY_URL",
        "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/history"
    )
    VENDOR_BLE_GATEWAY_STREAM_URL: Optional[str] = os.getenv(
        "VENDOR_BLE_GATEWAY_STREAM_URL",
        "https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/"
    )
    VENDOR_BLE_GATEWAY_API_KEY: Optional[str] = os.getenv("VENDOR_BLE_GATEWAY_API_KEY", "")
    VENDOR_AUTH_COOKIE: Optional[str] = os.getenv("VENDOR_AUTH_COOKIE", "")
    VENDOR_BLE_GATEWAY_TYPE: str = os.getenv("VENDOR_BLE_GATEWAY_TYPE", "GenericREST") # Cassia, Minew, Nordic, Teltonika, GenericREST
    VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC: float = float(os.getenv("VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC", "1.0"))
    VENDOR_BLE_GATEWAY_AUTO_POLL: bool = os.getenv("VENDOR_BLE_GATEWAY_AUTO_POLL", "true").lower() in ("true", "1", "yes")
    SEED_DEMO_DATA: bool = os.getenv("SEED_DEMO_DATA", "false").lower() in ("true", "1", "yes")

    # Storage Paths
    ARTIFACTS_DIR: str = os.path.join(os.path.dirname(__file__), "..", "artifacts")
    MODELS_DIR: str = os.path.join(ARTIFACTS_DIR, "models")
    RECORDINGS_DIR: str = os.path.join(ARTIFACTS_DIR, "recordings")

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

settings = Settings()

# Ensure directories exist
os.makedirs(settings.MODELS_DIR, exist_ok=True)
os.makedirs(settings.RECORDINGS_DIR, exist_ok=True)

def get_vendor_auth_cookie() -> str:
    """
    Returns authentication cookie header for Google Cloud Run / AI Studio endpoints.
    Prioritizes VENDOR_AUTH_COOKIE environment variable, then VENDOR_BLE_GATEWAY_API_KEY.
    """
    if settings.VENDOR_AUTH_COOKIE:
        return settings.VENDOR_AUTH_COOKIE.strip()
    return (settings.VENDOR_BLE_GATEWAY_API_KEY or "").strip()
