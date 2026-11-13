import pytest
from backend.app.services.database_maintenance_service import (
    DatabaseMaintenanceService, PROTECTED_MASTER_TABLES, TRANSIENT_TELEMETRY_TABLES
)
from backend.app.models.schema import User, SystemSetting

def test_protected_tables_preservation(db_session):
    # Verify protected tables list is strictly defined
    assert "users" in PROTECTED_MASTER_TABLES
    assert "models" in PROTECTED_MASTER_TABLES
    assert "stations" in PROTECTED_MASTER_TABLES
    assert "system_settings" in PROTECTED_MASTER_TABLES

    initial_users_count = db_session.query(User).count()
    assert initial_users_count > 0

    # Execute purge
    result = DatabaseMaintenanceService.purge_old_data(
        retention_period="all_transient",
        vacuum=False,
        operator="TestAdmin",
        db=db_session
    )
    assert result["status"] == "success"

    # Verify protected master data remained completely untouched
    final_users_count = db_session.query(User).count()
    assert final_users_count == initial_users_count

