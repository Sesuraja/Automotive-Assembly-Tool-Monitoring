from fastapi import APIRouter
from backend.app.api.auth import router as auth_router
from backend.app.api.ingest import router as ingest_router
from backend.app.api.live import router as live_router
from backend.app.api.stations import router as stations_router
from backend.app.api.simulator import router as sim_router
from backend.app.api.models import router as models_router
from backend.app.api.recordings import router as recordings_router
from backend.app.api.history import router as history_router
from backend.app.api.admin import router as admin_router
from backend.app.api.gateway import router as gateway_router
from backend.app.api.database_admin import router as database_admin_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(ingest_router)
api_router.include_router(gateway_router)
api_router.include_router(stations_router)
api_router.include_router(sim_router)
api_router.include_router(models_router)
api_router.include_router(recordings_router)
api_router.include_router(history_router)
api_router.include_router(admin_router)
api_router.include_router(database_admin_router)

