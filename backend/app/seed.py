import os
import json
from datetime import datetime
from backend.app.database import engine, Base, SessionLocal
from backend.app.models.schema import (
    Organization, Plant, Line, Station, Device, User, Recording, MLModelRecord, AuditLog
)
from backend.app.core.security import get_password_hash
from backend.app.services.model_service import ModelService
from backend.app.core.feature_extractor import extract_features, features_to_vector
from backend.app.config import settings
from backend.app.core.ml_model import AnomalyModelWrapper, set_active_model
from backend.app.core.decision_engine import get_decision_engine

def init_db_and_seed():
    print("[Seed] Initializing database tables...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # 1. Organization & Plant Hierarchy
        org = db.query(Organization).filter(Organization.id == "org-detroit").first()
        if not org:
            org = Organization(id="org-detroit", name="Apex Dynamics Automotive Powertrain")
            db.add(org)
            db.flush()

        plant = db.query(Plant).filter(Plant.id == "plant-01").first()
        if not plant:
            plant = Plant(id="plant-01", org_id=org.id, name="Powertrain Assembly Facility Alpha", location="Detroit, MI")
            db.add(plant)
            db.flush()

        line = db.query(Line).filter(Line.id == "line-4").first()
        if not line:
            line = Line(id="line-4", plant_id=plant.id, name="Line 04 - Cylinder Head & Camshaft Fastening")
            db.add(line)
            db.flush()

        station = db.query(Station).filter(Station.id == "station-A").first()
        if not station:
            station = Station(
                id="station-A",
                line_id=line.id,
                name="Station 4A - Multi-Spindle Angle Nutrunner",
                state="NORMAL",
                indicator_light="GREEN",
                commanded_speed_pct=100.0,
                current_model_version="v1.0.0-baseline"
            )
            db.add(station)
            db.flush()

        device = db.query(Device).filter(Device.id == "304A2657BF44").first()
        if not device:
            device = Device(
                id="304A2657BF44",
                station_id=station.id,
                name="Aperture Gateway Telemetry Node (304A2657BF44)",
                device_type="vibration_node",
                api_key="ble-key-spindle-01-prod",
                is_active=True,
                last_seen=datetime.utcnow()
            )
            db.add(device)
            db.flush()

        # 2. Seed Users (Admin only as required)
        users_to_seed = [
            ("admin", "admin@apex.auto", "admin123", "Admin"),
        ]
        for uname, email, pwd, role in users_to_seed:
            from sqlalchemy import func
            existing = db.query(User).filter(
                (User.id == f"user_{uname}") | (func.lower(User.username) == uname.lower())
            ).first()
            if not existing:
                u = User(
                    id=f"user_{uname}",
                    username=uname,
                    email=email,
                    hashed_password=get_password_hash(pwd),
                    role=role
                )
                db.add(u)
            else:
                existing.role = "Admin"
        
        # Ensure any existing user has Admin role
        for usr in db.query(User).all():
            usr.role = "Admin"
        db.commit()

        # 3. Model Initialization (Check if active model exists or load baseline)
        active_model = db.query(MLModelRecord).filter(MLModelRecord.active_flag == True).first()
        if active_model:
            try:
                loaded_model = AnomalyModelWrapper.load(active_model.artifact_path)
                set_active_model(loaded_model)
                engine_inst = get_decision_engine()
                thresh = active_model.thresholds or {}
                engine_inst.update_thresholds(
                    thresh.get("warn_threshold", settings.AI_WARN_THRESHOLD),
                    thresh.get("critical_threshold", settings.AI_CRITICAL_THRESHOLD)
                )
                print(f"[Seed] Active model '{active_model.version}' ({active_model.model_type}) loaded into memory.")
            except Exception as ex:
                print(f"[Seed] Warning loading active model: {ex}")
        else:
            any_model = db.query(MLModelRecord).first()
            if any_model:
                ModelService.activate_model(any_model.version, db=db)
            else:
                artifact_file = os.path.join(settings.MODELS_DIR, "v1.0.0-baseline.joblib")
                if os.path.exists(artifact_file):
                    base_model = MLModelRecord(
                        id="v1.0.0-baseline",
                        version="v1.0.0-baseline",
                        model_type="IsolationForest",
                        active_flag=True,
                        thresholds={"warn_threshold": 0.45, "critical_threshold": 0.70},
                        metrics={"model_type": "IsolationForest", "status": "active"},
                        artifact_path=artifact_file,
                        created_at=datetime.utcnow()
                    )
                    db.add(base_model)
                    db.commit()
                    try:
                        loaded_model = AnomalyModelWrapper.load(artifact_file)
                        set_active_model(loaded_model)
                    except Exception:
                        pass

        # Audit log entry
        db.add(AuditLog(
            username="System",
            action="SYSTEM_INIT",
            resource="Platform",
            details="Database schema initialized and seeded successfully."
        ))

        db.commit()
        print("[Seed] Seeding completed successfully.")

    except Exception as e:
        db.rollback()
        print(f"[Seed Error] {e}")
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    init_db_and_seed()
