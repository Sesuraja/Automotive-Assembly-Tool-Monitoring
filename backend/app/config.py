import os
from typing import Optional
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load environment variables from .env
load_dotenv()

class Settings(BaseSettings):
    PROJECT_NAME: str = "Automotive Assembly Tool Monitoring"
    API_V1_STR: str = "/api/v1"
    
    # Database
    # Defaults to SQLite for immediate local execution if DATABASE_URL is not set or postgres is unreachable
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite:///./tool_monitor.db"
    )
    
    # JWT Authentication
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-jwt-key-auto-tool-monitoring-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 # 24 hours
    
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
    # Keeps high-frequency sensor telemetry lean (prunes old transient rolling windows)
    TELEMETRY_RETENTION_MAX_ROWS: int = int(os.getenv("TELEMETRY_RETENTION_MAX_ROWS", "3000"))
    AUTO_PRUNE_INTERVAL_PACKETS: int = int(os.getenv("AUTO_PRUNE_INTERVAL_PACKETS", "500"))
    
    # Vendor API Base & BLE Gateway Integration Settings
    VENDOR_API_BASE_URL: str = os.getenv(
        "VENDOR_API_BASE_URL",
        "https://ais-dev-xzxljhsxlkzopqgvxgcwvc-509615976446.asia-southeast1.run.app"
    )
    VENDOR_BLE_GATEWAY_URL: Optional[str] = os.getenv(
        "VENDOR_BLE_GATEWAY_URL",
        f"{os.getenv('VENDOR_API_BASE_URL', 'https://ais-dev-xzxljhsxlkzopqgvxgcwvc-509615976446.asia-southeast1.run.app').rstrip('/')}/api/vibration/live"
    )
    VENDOR_BLE_GATEWAY_API_KEY: Optional[str] = os.getenv("VENDOR_BLE_GATEWAY_API_KEY", "")
    VENDOR_BLE_GATEWAY_TYPE: str = os.getenv("VENDOR_BLE_GATEWAY_TYPE", "GenericREST") # Cassia, Minew, Nordic, Teltonika, GenericREST
    VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC: float = float(os.getenv("VENDOR_BLE_GATEWAY_POLL_INTERVAL_SEC", "1.0"))
    VENDOR_BLE_GATEWAY_AUTO_POLL: bool = os.getenv("VENDOR_BLE_GATEWAY_AUTO_POLL", "true").lower() in ("true", "1", "yes")
    SEED_DEMO_DATA: bool = os.getenv("SEED_DEMO_DATA", "false").lower() in ("true", "1", "yes")

    # Gemini AI Diagnostics Key (Set in .env or environment)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # Storage Paths
    ARTIFACTS_DIR: str = os.path.join(os.path.dirname(__file__), "..", "artifacts")
    MODELS_DIR: str = os.path.join(ARTIFACTS_DIR, "models")
    RECORDINGS_DIR: str = os.path.join(ARTIFACTS_DIR, "recordings")
    
    class Config:
        case_sensitive = True

settings = Settings()

# Ensure directories exist
os.makedirs(settings.MODELS_DIR, exist_ok=True)
os.makedirs(settings.RECORDINGS_DIR, exist_ok=True)

def get_vendor_auth_cookie() -> str:
    """
    Returns full authentication cookie header for Google Cloud Run / AI Studio endpoints.
    Reads from settings and automatically enriches with GAESA token from cookies.txt if available.
    """
    cookie_str = (settings.VENDOR_BLE_GATEWAY_API_KEY or "").strip()
    if "GAESA" not in cookie_str:
        cookie_file = os.path.join(os.path.dirname(__file__), "..", "..", "cookies.txt")
        if os.path.exists(cookie_file):
            try:
                gaesa_val = None
                with open(cookie_file, "r") as f:
                    for line in f:
                        parts = line.strip().split("\t")
                        if len(parts) >= 7 and parts[5] == "GAESA":
                            gaesa_val = parts[6]
                            break
                if gaesa_val:
                    cookie_str = f"GAESA={gaesa_val}; __SECURE-aistudio_auth_flow_may_set_cookies=true; {cookie_str}".strip(" ;")
            except Exception:
                pass
    return cookie_str

