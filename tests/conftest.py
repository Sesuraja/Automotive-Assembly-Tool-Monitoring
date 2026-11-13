import pytest
import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models.schema import User, Station, Line, Plant, Organization, SystemSetting
from backend.app.core.security import get_password_hash, create_access_token

TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(scope="session")
def engine():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return engine

@pytest.fixture(scope="function")
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=connection)
    session = TestingSessionLocal()

    # Seed baseline hierarchy
    org = Organization(id="org-test", name="Test Powertrain Org")
    plant = Plant(id="plant-test", org_id="org-test", name="Test Facility", location="Test Lab")
    line = Line(id="line-test", plant_id="plant-test", name="Test Assembly Line")
    station = Station(
        id="station-A",
        line_id="line-test",
        name="Station 4A - Test Angle Nutrunner",
        state="NORMAL",
        indicator_light="GREEN",
        commanded_speed_pct=100.0,
        current_model_version="v1.0.0-baseline"
    )
    session.add_all([org, plant, line, station])

    # Seed users with all roles
    users = [
        User(id="u_admin", username="admin", email="admin@test.auto", hashed_password=get_password_hash("admin123"), role="Admin", is_active=True),
        User(id="u_engineer", username="engineer", email="eng@test.auto", hashed_password=get_password_hash("eng123"), role="Engineer", is_active=True),
        User(id="u_operator", username="operator", email="op@test.auto", hashed_password=get_password_hash("op123"), role="Operator", is_active=True),
        User(id="u_viewer", username="viewer", email="viewer@test.auto", hashed_password=get_password_hash("view123"), role="Viewer", is_active=True),
        User(id="u_inactive", username="inactive_user", email="inact@test.auto", hashed_password=get_password_hash("pass123"), role="Operator", is_active=False),
    ]
    session.add_all(users)
    session.commit()

    yield session

    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

@pytest.fixture
def auth_headers():
    def _headers_for_role(role: str, username: str = None) -> dict:
        uname = username or role.lower()
        token = create_access_token(
            data={"sub": uname, "role": role},
            expires_delta=datetime.timedelta(hours=2)
        )
        return {"Authorization": f"Bearer {token}"}
    return _headers_for_role

