from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from pydantic import BaseModel
from backend.app.database import get_db
from backend.app.core.security import require_role
from backend.app.services.database_maintenance_service import DatabaseMaintenanceService
from backend.app.core.ai_diagnostics import test_gemini_connection
from backend.app.models.schema import SystemSetting

router = APIRouter(prefix="/database", tags=["Database & AI Maintenance"])

class CleanupRequest(BaseModel):
    retention_period: str = "1_month" # "1_week", "2_weeks", "3_weeks", "1_month", "all_transient"
    vacuum: bool = True

class RetentionPolicyRequest(BaseModel):
    policy: str # "1_week", "2_weeks", "3_weeks", "1_month", "disabled"

@router.get("/stats")
def get_database_stats(
    current_user: dict = Depends(require_role(["Admin", "Engineer", "Operator"])),
    db: Session = Depends(get_db)
):
    """
    Returns comprehensive database storage statistics:
    File size, freelist unused space, page allocations, and table row counts.
    """
    return DatabaseMaintenanceService.get_database_stats(db=db)

@router.post("/cleanup")
def cleanup_database(
    req: CleanupRequest,
    current_user: dict = Depends(require_role(["Admin", "Engineer"])),
    db: Session = Depends(get_db)
):
    """
    Deletes telemetry older than 1 week, 2 weeks, 3 weeks, or 1 month.
    IMPORTANT: Critical master data (users, vendor_gateways, models, plants, lines,
    stations, devices, system settings) is 100% PROTECTED and never deleted.
    Executes SQLite VACUUM to reclaim disk space.
    """
    operator = current_user.get("username", "Administrator")
    valid_periods = ["1_week", "2_weeks", "3_weeks", "1_month", "all_transient"]
    if req.retention_period not in valid_periods:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid retention period '{req.retention_period}'. Choose from: {valid_periods}"
        )

    try:
        result = DatabaseMaintenanceService.purge_old_data(
            retention_period=req.retention_period,
            vacuum=req.vacuum,
            operator=operator,
            db=db
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database cleanup failed: {str(e)}")

@router.post("/vacuum")
def vacuum_database(
    current_user: dict = Depends(require_role(["Admin", "Engineer"])),
    db: Session = Depends(get_db)
):
    """
    Executes an explicit SQLite VACUUM and WAL checkpoint to compact the database
    and release 100% of unused space back to the operating system.
    """
    operator = current_user.get("username", "Administrator")
    return DatabaseMaintenanceService.purge_old_data(
        retention_period="1_month",
        vacuum=True,
        operator=operator,
        db=db
    )

@router.put("/retention-policy")
def set_retention_policy(
    req: RetentionPolicyRequest,
    current_user: dict = Depends(require_role(["Admin"])),
    db: Session = Depends(get_db)
):
    """
    Saves the automated background retention policy (1 week, 2 weeks, 1 month).
    """
    row = db.query(SystemSetting).filter(SystemSetting.key == "db_retention_policy").first()
    if not row:
        row = SystemSetting(key="db_retention_policy", value=req.policy)
        db.add(row)
    else:
        row.value = req.policy
    db.commit()
    return {"status": "saved", "retention_policy": req.policy}

@router.get("/ai-status")
def get_ai_status(
    current_user: dict = Depends(require_role(["Admin", "Engineer", "Operator"]))
):
    """
    Tests live connection to Google Gemini AI service and verifies active production model.
    """
    return test_gemini_connection()
