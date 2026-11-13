import pytest

def test_health_check(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["service"] == "tool-monitoring-api"

def test_metrics(client):
    res = client.get("/metrics")
    assert res.status_code == 200
    data = res.json()
    assert "sample_rate_hz" in data
    assert data["uptime"] == "operational"

def test_stations_endpoint(client):
    res = client.get("/api/v1/stations")
    assert res.status_code == 200
    stations = res.json()
    assert isinstance(stations, list)
    assert len(stations) >= 1
    assert stations[0]["id"] == "station-A"

def test_settings_read_and_update(client, auth_headers):
    # Read settings without auth
    res_get = client.get("/api/v1/settings")
    assert res_get.status_code == 200
    settings_data = res_get.json()
    assert "station_id" in settings_data

    # Update settings with Admin token
    admin_hdr = auth_headers("Admin", "admin")
    payload = {
        "motor_rated_rpm": 2400.0,
        "warn_threshold": 0.50,
        "critical_threshold": 0.75
    }
    res_update = client.post("/api/v1/settings", json=payload, headers=admin_hdr)
    assert res_update.status_code == 200
    assert res_update.json()["status"] == "success"

    # Verify updated values persist
    res_verify = client.get("/api/v1/settings")
    updated = res_verify.json()
    assert updated["motor_rated_rpm"] == "2400.0"
    assert updated["warn_threshold"] == "0.5"

def test_autonomous_ai_status(client, auth_headers):
    admin_hdr = auth_headers("Admin", "admin")
    res = client.get("/api/v1/database/ai-status", headers=admin_hdr)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ACTIVE"
    assert data["is_connected"] is True
    assert "Autonomous" in data["engine"]


