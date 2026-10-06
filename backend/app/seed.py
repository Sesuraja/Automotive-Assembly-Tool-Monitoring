import os
import json
from datetime import datetime
from backend.app.database import engine, Base, SessionLocal
from backend.app.models.schema import (
    Organization, Plant, Line, Station, Device, User, Recording, MLModelRecord, AuditLog
)
from backend.app.core.security import get_password_hash
from backend.app.services.model_service import ModelService
from simulator.virtual_rig import simulator_rig
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

        device = db.query(Device).filter(Device.id == "AC:23:3F:88:D1:05").first()
        if not device:
            device = Device(
                id="AC:23:3F:88:D1:05",
                station_id=station.id,
                name="KKM S5 Triaxial Vibration Sensor (AC:23:3F:88:D1:05)",
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
            existing = db.query(User).filter(User.username == uname).first()
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

        # 3. Seed Initial Datasets / Recordings (Only if SEED_DEMO_DATA is explicitly true)
        seed_demo_data = os.getenv("SEED_DEMO_DATA", "false").lower() in ("true", "1", "yes")
        if seed_demo_data:
            rec_norm = db.query(Recording).filter(Recording.id == "rec_normal_baseline").first()
            if not rec_norm:
                norm_file = os.path.join(settings.RECORDINGS_DIR, "rec_normal_baseline.json")
                norm_samples = []
                simulator_rig.set_scenario("normal")
                for i in range(50):
                    w = simulator_rig.generate_window()
                    f, _ = extract_features(w, 1000)
                    norm_samples.append({
                        "seq": i,
                        "label": "normal",
                        "features": f,
                        "features_vector": features_to_vector(f).tolist()
                    })
                with open(norm_file, "w") as f_out:
                    json.dump(norm_samples, f_out, indent=2)

                rec_norm = Recording(
                    id="rec_normal_baseline",
                    name="Baseline Steady-State Normal Operation",
                    label="normal",
                    sample_count=len(norm_samples),
                    duration_sec=5.0,
                    file_path=norm_file,
                    created_at=datetime.utcnow()
                )
                db.add(rec_norm)

            rec_dist = db.query(Recording).filter(Recording.id == "rec_disturbed_baseline").first()
            if not rec_dist:
                dist_file = os.path.join(settings.RECORDINGS_DIR, "rec_disturbed_baseline.json")
                dist_samples = []
                simulator_rig.set_scenario("disturbance_on", amplitude=0.85, freq=180.0)
                for i in range(40):
                    w = simulator_rig.generate_window()
                    f, _ = extract_features(w, 1000)
                    dist_samples.append({
                        "seq": i,
                        "label": "disturbed",
                        "features": f,
                        "features_vector": features_to_vector(f).tolist()
                    })
                with open(dist_file, "w") as f_out:
                    json.dump(dist_samples, f_out, indent=2)

                rec_dist = Recording(
                    id="rec_disturbed_baseline",
                    name="Exciter Active 180Hz Resonance Anomaly",
                    label="disturbed",
                    sample_count=len(dist_samples),
                    duration_sec=4.0,
                    file_path=dist_file,
                    created_at=datetime.utcnow()
                )
                db.add(rec_dist)
                simulator_rig.set_scenario("normal")

            # 4. Train Initial Baseline Model
            base_model = db.query(MLModelRecord).filter(MLModelRecord.version == "v1.0.0-baseline").first()
            if not base_model:
                print("[Seed] Training baseline Isolation Forest model (v1.0.0-baseline)...")
                ModelService.train_model(
                    version="v1.0.0-baseline",
                    model_type="IsolationForest",
                    normal_recording_ids=["rec_normal_baseline"],
                    disturbed_recording_ids=["rec_disturbed_baseline"],
                    warn_threshold=0.45,
                    critical_threshold=0.70,
                    contamination=0.05,
                    db=db
                )
                ModelService.activate_model("v1.0.0-baseline", db=db)
        else:
            # When demo data is disabled, check if an active model record already exists
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
                        ModelService.activate_model("v1.0.0-baseline", db=db)

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
