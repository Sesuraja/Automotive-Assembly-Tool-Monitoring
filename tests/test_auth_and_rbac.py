import pytest
from backend.app.core.security import verify_password, get_password_hash, create_access_token

def test_password_hashing():
    pwd = "SuperSecretPassword2026!"
    hashed = get_password_hash(pwd)
    assert hashed != pwd
    assert verify_password(pwd, hashed) is True
    assert verify_password("WrongPassword", hashed) is False

def test_login_success(client):
    res = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["username"] == "admin"
    assert data["role"] == "Admin"

def test_login_invalid_password(client):
    res = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrongpassword"})
    assert res.status_code == 401
    assert "Incorrect username or password" in res.json()["detail"]

def test_login_inactive_user(client):
    res = client.post("/api/v1/auth/login", json={"username": "inactive_user", "password": "pass123"})
    assert res.status_code == 403
    assert "inactive" in res.json()["detail"].lower()

def test_get_current_user_profile(client, auth_headers):
    # Operator profile
    headers = auth_headers("Operator", "operator")
    res = client.get("/api/v1/auth/me", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == "operator"
    assert data["role"] == "Operator"

def test_rbac_admin_endpoint_permissions(client, auth_headers):
    # 1. Admin must succeed
    admin_hdr = auth_headers("Admin", "admin")
    res_admin = client.get("/api/v1/admin/users", headers=admin_hdr)
    assert res_admin.status_code == 200
    assert len(res_admin.json()) >= 4

    # 2. Engineer must be forbidden (requires Admin)
    eng_hdr = auth_headers("Engineer", "engineer")
    res_eng = client.get("/api/v1/admin/users", headers=eng_hdr)
    assert res_eng.status_code == 403
    assert "Operation requires one of roles" in res_eng.json()["detail"]

    # 3. Operator must be forbidden
    op_hdr = auth_headers("Operator", "operator")
    res_op = client.get("/api/v1/admin/users", headers=op_hdr)
    assert res_op.status_code == 403

    # 4. Viewer must be forbidden
    view_hdr = auth_headers("Viewer", "viewer")
    res_view = client.get("/api/v1/admin/users", headers=view_hdr)
    assert res_view.status_code == 403

    # 5. Unauthenticated request must return 401
    res_unauth = client.get("/api/v1/admin/users")
    assert res_unauth.status_code == 401

