import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from backend.app.config import settings
from backend.app.api import api_router
from backend.app.api.live import router as live_router
from backend.app.api.ingest import router as ingest_router
from backend.app.seed import init_db_and_seed
from backend.app.services.ingestion_service import IngestionService
from backend.app.database import SessionLocal

# Configure structured application logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("app.main")

# Background watchdog task for link loss detection
_watchdog_task = None
_vendor_gw_task = None

async def _link_loss_watchdog():
    while True:
        try:
            db = SessionLocal()
            try:
                await IngestionService.trigger_link_loss_check(
                    station_id="station-A",
                    timeout_sec=max(15.0, settings.LINK_TIMEOUT_SEC),
                    db=db
                )
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Link loss watchdog check encountered notice: {e}")
        await asyncio.sleep(1.0)

async def _vendor_gateway_poller():
    while True:
        poll_interval = 1.0
        db = None
        try:
            db = SessionLocal()
            from backend.app.models.schema import VendorGatewayConfig
            from backend.app.api.gateway import trigger_vendor_gateway_sync
            cfg = db.query(VendorGatewayConfig).filter(VendorGatewayConfig.id == "default-vendor-gateway").first()
            if not cfg:
                cfg = VendorGatewayConfig(
                    id="default-vendor-gateway",
                    name="Primary Industrial BLE Gateway",
                    vendor_type="GenericREST",
                    api_url=settings.VENDOR_BLE_GATEWAY_URL,
                    is_active=True,
                    poll_interval_sec=1.0,
                    station_id="station-A"
                )
                db.add(cfg)
                db.commit()
            if cfg and cfg.api_url:
                poll_interval = max(0.2, float(cfg.poll_interval_sec or 1.0))
                if cfg.is_active:
                    await trigger_vendor_gateway_sync(db=db)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Vendor gateway background poller notice: {e}")
        finally:
            if db:
                db.close()
        await asyncio.sleep(poll_interval)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Seed database and baseline model without demo data
    logger.info("Initializing database and models...")
    init_db_and_seed()
    global _watchdog_task, _vendor_gw_task
    _watchdog_task = asyncio.create_task(_link_loss_watchdog())
    _vendor_gw_task = asyncio.create_task(_vendor_gateway_poller())
    yield
    # Shutdown
    logger.info("Shutting down background tasks...")
    if _watchdog_task:
        _watchdog_task.cancel()
    if _vendor_gw_task:
        _vendor_gw_task.cancel()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Automotive Assembly Tool Monitoring: AI Vibration Anomaly Detection Platform",
    lifespan=lifespan
)

# Global unhandled exception handler (OWASP ASVS / Clean API contract)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error processing {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. The issue has been logged for review."}
    )

# Strict CORS configuration
origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)

from backend.app.api.vendor_motor_api import router as vendor_motor_router

# Mount API Routers
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(vendor_motor_router, prefix="/api")
app.include_router(vendor_motor_router, prefix=settings.API_V1_STR)
app.include_router(live_router)
app.include_router(ingest_router)

# Direct aliases for settings endpoints so GET, POST, and PUT work everywhere
from backend.app.api.admin import get_settings, update_settings
from backend.app.api.gateway import get_selected_devices, save_selected_devices
app.add_api_route("/api/v1/settings", get_settings, methods=["GET"])
app.add_api_route("/api/v1/settings", update_settings, methods=["POST", "PUT"])
app.add_api_route("/api/settings", get_settings, methods=["GET"])
app.add_api_route("/api/settings", update_settings, methods=["POST", "PUT"])
app.add_api_route("/api/v1/gateway/selected-devices", get_selected_devices, methods=["GET"])
app.add_api_route("/api/v1/gateway/selected-devices", save_selected_devices, methods=["POST"])
app.add_api_route("/api/gateway/selected-devices", get_selected_devices, methods=["GET"])
app.add_api_route("/api/gateway/selected-devices", save_selected_devices, methods=["POST"])

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "tool-monitoring-api",
        "version": "1.0.0"
    }

@app.get("/metrics")
def get_metrics():
    return {
        "active_devices": 1,
        "sample_rate_hz": 1000,
        "uptime": "operational"
    }

# Frontend static files mounting if built
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    index_html = os.path.join(frontend_dist, "index.html")
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa_page(full_path: str):
        if full_path.startswith("api/") or full_path in ["health", "metrics", "docs", "redoc", "openapi.json"]:
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate_file = os.path.abspath(os.path.join(frontend_dist, full_path))
        # Path traversal mitigation (OWASP ASVS / CWE-22)
        try:
            if os.path.commonpath([frontend_dist, candidate_file]) != frontend_dist:
                return JSONResponse(status_code=403, content={"detail": "Access forbidden"})
        except ValueError:
            return JSONResponse(status_code=403, content={"detail": "Access forbidden"})

        if full_path and os.path.isfile(candidate_file):
            return FileResponse(candidate_file)
        return FileResponse(index_html)
