import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
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

# Background watchdog task for link loss detection
_watchdog_task = None
_vendor_gw_task = None

async def _link_loss_watchdog():
    while True:
        try:
            db = SessionLocal()
            await IngestionService.trigger_link_loss_check(station_id="station-A", timeout_sec=max(15.0, settings.LINK_TIMEOUT_SEC), db=db)
            db.close()
        except Exception:
            pass
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
            if cfg and cfg.api_url:
                poll_interval = max(0.2, float(cfg.poll_interval_sec or 1.0))
                if cfg.is_active:
                    await trigger_vendor_gateway_sync(db=db)
        except Exception:
            pass
        finally:
            if db:
                db.close()
        await asyncio.sleep(poll_interval)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Seed database and baseline model without demo data
    init_db_and_seed()
    global _watchdog_task, _vendor_gw_task
    # Do NOT auto-start the simulator background task - only real host data is used
    _watchdog_task = asyncio.create_task(_link_loss_watchdog())
    _vendor_gw_task = asyncio.create_task(_vendor_gateway_poller())
    yield
    # Shutdown
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

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
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
app.add_api_route("/api/v1/settings", get_settings, methods=["GET"])
app.add_api_route("/api/v1/settings", update_settings, methods=["POST", "PUT"])
app.add_api_route("/api/settings", get_settings, methods=["GET"])
app.add_api_route("/api/settings", update_settings, methods=["POST", "PUT"])

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
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    index_html = os.path.join(frontend_dist, "index.html")
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa_page(full_path: str):
        if full_path.startswith("api/") or full_path in ["health", "metrics", "docs", "redoc", "openapi.json"]:
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate_file = os.path.join(frontend_dist, full_path)
        if full_path and os.path.isfile(candidate_file):
            return FileResponse(candidate_file)
        return FileResponse(index_html)
