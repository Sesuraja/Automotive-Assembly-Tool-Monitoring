import os
import sqlite3
import datetime
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from backend.app.config import settings
from backend.app.models.schema import AuditLog, SystemSetting

# Tables that store critical enterprise master data and MUST NEVER be deleted during cleanup
PROTECTED_MASTER_TABLES = [
    "users",
    "vendor_gateways",
    "models",
    "plants",
    "lines",
    "stations",
    "devices",
    "orgs",
    "system_settings"
]

# High-frequency telemetry and transient operational tables that can be cleaned by age
TRANSIENT_TELEMETRY_TABLES = [
    "raw_windows",
    "features",
    "anomaly_scores",
    "decisions",
    "motor_telemetry",
    "events",
    "motor_stop_analyses"
]

RETENTION_PRESETS = {
    "1_week": 7,
    "2_weeks": 14,
    "3_weeks": 21,
    "1_month": 30,
    "all_transient": 0
}

class DatabaseMaintenanceService:
    @staticmethod
    def get_database_path() -> str:
        db_url = settings.DATABASE_URL
        if db_url.startswith("sqlite:///"):
            path = db_url.replace("sqlite:///", "")
            return os.path.abspath(path)
        return os.path.abspath("tool_monitor.db")

    @staticmethod
    def get_database_stats(db: Session) -> Dict[str, Any]:
        """
        Calculates live database file size, unused freelist space, and table record counts.
        """
        db_path = DatabaseMaintenanceService.get_database_path()
        total_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0

        # SQLite PRAGMAs for internal storage analysis
        page_size = 4096
        page_count = 0
        freelist_count = 0
        journal_mode = "unknown"
        auto_vacuum = 0

        try:
            page_size = db.execute(text("PRAGMA page_size;")).scalar() or 4096
            page_count = db.execute(text("PRAGMA page_count;")).scalar() or 0
            freelist_count = db.execute(text("PRAGMA freelist_count;")).scalar() or 0
            journal_mode = db.execute(text("PRAGMA journal_mode;")).scalar() or "unknown"
            auto_vacuum = db.execute(text("PRAGMA auto_vacuum;")).scalar() or 0
        except Exception as e:
            print(f"[DB Stats Warning] PRAGMA query error: {e}")

        unused_bytes = freelist_count * page_size
        unused_pct = round((freelist_count / max(1, page_count)) * 100, 1)

        # Check WAL and SHM auxiliary files
        wal_path = f"{db_path}-wal"
        shm_path = f"{db_path}-shm"
        wal_bytes = os.path.getsize(wal_path) if os.path.exists(wal_path) else 0
        shm_bytes = os.path.getsize(shm_path) if os.path.exists(shm_path) else 0

        # Record counts per table
        table_stats = {}
        for tbl in PROTECTED_MASTER_TABLES + TRANSIENT_TELEMETRY_TABLES:
            try:
                cnt = db.execute(text(f'SELECT COUNT(*) FROM "{tbl}"')).scalar() or 0
                table_stats[tbl] = cnt
            except Exception:
                table_stats[tbl] = 0

        # Oldest and newest telemetry timestamp
        oldest_ts = None
        newest_ts = None
        try:
            oldest_row = db.execute(text("SELECT MIN(ts) FROM features")).scalar()
            newest_row = db.execute(text("SELECT MAX(ts) FROM features")).scalar()
            if oldest_row:
                oldest_ts = str(oldest_row)
            if newest_row:
                newest_ts = str(newest_row)
        except Exception:
            pass

        # Query auto-retention policy
        retention_policy_row = db.query(SystemSetting).filter(SystemSetting.key == "db_retention_policy").first()
        retention_policy = retention_policy_row.value if retention_policy_row else "1_month"

        return {
            "database_file": os.path.basename(db_path),
            "file_size_bytes": total_bytes,
            "file_size_mb": round(total_bytes / (1024 * 1024), 2),
            "wal_size_mb": round(wal_bytes / (1024 * 1024), 2),
            "shm_size_mb": round(shm_bytes / (1024 * 1024), 2),
            "total_disk_mb": round((total_bytes + wal_bytes + shm_bytes) / (1024 * 1024), 2),
            "page_size_bytes": page_size,
            "total_pages": page_count,
            "freelist_pages": freelist_count,
            "unused_space_bytes": unused_bytes,
            "unused_space_mb": round(unused_bytes / (1024 * 1024), 2),
            "unused_space_pct": unused_pct,
            "journal_mode": journal_mode,
            "auto_vacuum_mode": auto_vacuum,
            "table_stats": table_stats,
            "oldest_record_ts": oldest_ts,
            "newest_record_ts": newest_ts,
            "protected_tables": PROTECTED_MASTER_TABLES,
            "purgeable_tables": TRANSIENT_TELEMETRY_TABLES,
            "current_retention_policy": retention_policy,
            "vacuum_recommended": (unused_bytes > 500 * 1024) or (unused_pct > 15.0)
        }

    @staticmethod
    def purge_old_data(
        retention_period: str,
        vacuum: bool = True,
        operator: str = "Administrator",
        db: Optional[Session] = None
    ) -> Dict[str, Any]:
        """
        Deletes telemetry records older than specified retention (1 week, 2 weeks, 3 weeks, 1 month).
        Strictly guarantees: Vendor API gateways, users, models, plants, lines, stations, devices,
        and system settings are NEVER deleted.
        Executes SQLite VACUUM and WAL checkpoint to reclaim physical storage from disk.
        """
        from backend.app.database import SessionLocal
        owns_session = False
        if db is None:
            db = SessionLocal()
            owns_session = True

        db_path = DatabaseMaintenanceService.get_database_path()
        initial_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0

        days = RETENTION_PRESETS.get(retention_period, 30)
        deleted_counts = {}

        now = datetime.datetime.now(datetime.timezone.utc)
        cutoff_dt = now - datetime.timedelta(days=days) if days > 0 else now

        try:
            # 1. Clean transient tables based on cutoff timestamp
            for tbl in TRANSIENT_TELEMETRY_TABLES:
                if days == 0:
                    # 'all_transient': Keep the most recent 100 records for UI charts and flush the rest
                    count_row = db.execute(text(f'SELECT COUNT(*) FROM "{tbl}"')).scalar() or 0
                    if count_row > 100:
                        cutoff_id_row = db.execute(
                            text(f'SELECT id FROM "{tbl}" ORDER BY id DESC LIMIT 1 OFFSET 100')
                        ).fetchone()
                        if cutoff_id_row and cutoff_id_row[0]:
                            res = db.execute(
                                text(f'DELETE FROM "{tbl}" WHERE id <= :cid'),
                                {"cid": cutoff_id_row[0]}
                            )
                            deleted_counts[tbl] = res.rowcount
                        else:
                            deleted_counts[tbl] = 0
                    else:
                        deleted_counts[tbl] = 0
                else:
                    res = db.execute(
                        text(f'DELETE FROM "{tbl}" WHERE ts < :cutoff'),
                        {"cutoff": cutoff_dt}
                    )
                    deleted_counts[tbl] = res.rowcount

            # 2. Record audit trail entry
            total_deleted = sum(deleted_counts.values())
            db.add(AuditLog(
                username=operator,
                action="DATABASE_PURGE",
                resource="SQLite:tool_monitor.db",
                details=f"Retention purge '{retention_period}' executed. Purged {total_deleted} old records. Protected master data preserved."
            ))

            db.commit()

            # 3. Checkpoint WAL and VACUUM to physically shrink database file
            if vacuum:
                try:
                    db.execute(text("PRAGMA wal_checkpoint(TRUNCATE);"))
                    db.commit()
                except Exception as e:
                    print(f"[WAL Checkpoint Notice] {e}")

                # VACUUM must run outside an active transaction
                try:
                    raw_conn = db.connection().connection
                    raw_conn.isolation_level = None
                    cursor = raw_conn.cursor()
                    cursor.execute("VACUUM;")
                    cursor.close()
                    raw_conn.isolation_level = ""
                except Exception as e:
                    # Fallback direct sqlite connection
                    try:
                        conn = sqlite3.connect(db_path)
                        conn.execute("VACUUM;")
                        conn.close()
                    except Exception as e2:
                        print(f"[VACUUM Notice] Direct vacuum deferred: {e2}")

            final_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0
            reclaimed_bytes = max(0, initial_bytes - final_bytes)

            return {
                "status": "success",
                "message": f"Successfully deleted {total_deleted} records older than {retention_period.replace('_', ' ')}.",
                "retention_period": retention_period,
                "days_threshold": days,
                "cutoff_timestamp": cutoff_dt.isoformat(),
                "initial_size_mb": round(initial_bytes / (1024 * 1024), 2),
                "final_size_mb": round(final_bytes / (1024 * 1024), 2),
                "reclaimed_mb": round(reclaimed_bytes / (1024 * 1024), 2),
                "reclaimed_bytes": reclaimed_bytes,
                "deleted_counts": deleted_counts,
                "total_records_deleted": total_deleted,
                "protected_tables_preserved": PROTECTED_MASTER_TABLES,
                "timestamp": now.isoformat()
            }
        except Exception as e:
            db.rollback()
            raise e
        finally:
            if owns_session:
                db.close()
