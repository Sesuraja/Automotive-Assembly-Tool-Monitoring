from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from backend.app.database import get_db
from backend.app.models.schema import User, AuditLog
from backend.app.schemas.pydantic_models import (
    UserLoginRequest, TokenResponse, UserProfileResponse, ProfileUpdateRequest
)
from backend.app.core.security import verify_password, create_access_token, get_password_hash

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/login", response_model=TokenResponse)
def login(login_req: UserLoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == login_req.username).first()
    if not user or not verify_password(login_req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    token = create_access_token(data={"sub": user.username, "role": user.role})
    
    # Record login audit event
    audit = AuditLog(
        username=user.username,
        action="USER_LOGIN",
        resource="AuthService",
        details=f"User {user.username} authenticated successfully ({user.role})"
    )
    db.add(audit)
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

@router.get("/me", response_model=UserProfileResponse)
def get_me(username: str = "admin", db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        # Fallback to first user in db or standard admin
        user = db.query(User).first()
    if not user:
        return {"username": "admin", "role": "Admin", "email": "admin@aperture.auto"}
    return {
        "username": user.username,
        "role": user.role or "Admin",
        "email": user.email
    }

@router.put("/profile")
def update_profile(req: ProfileUpdateRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.current_username).first()
    if not user:
        # If user not found by exact username, try matching any admin
        user = db.query(User).first()
        if not user:
            raise HTTPException(status_code=404, detail="User account not found")

    old_username = user.username
    changes = []

    if req.new_username and req.new_username.strip() and req.new_username != user.username:
        # Check if already taken
        existing = db.query(User).filter(User.username == req.new_username.strip()).first()
        if existing and existing.id != user.id:
            raise HTTPException(status_code=400, detail="Username already exists")
        changes.append(f"username from '{user.username}' to '{req.new_username.strip()}'")
        user.username = req.new_username.strip()

    if req.email and req.email.strip() and req.email != user.email:
        changes.append(f"email to '{req.email.strip()}'")
        user.email = req.email.strip()

    if req.password and req.password.strip():
        user.hashed_password = get_password_hash(req.password.strip())
        changes.append("password updated")

    # Issue fresh token
    new_token = create_access_token(data={"sub": user.username, "role": user.role})

    # Log to Audit Trail
    change_summary = ", ".join(changes) if changes else "Profile refreshed"
    audit = AuditLog(
        username=user.username,
        action="PROFILE_UPDATE",
        resource=f"User:{user.username}",
        details=f"Updated profile: {change_summary}"
    )
    db.add(audit)
    db.commit()
    db.refresh(user)

    return {
        "status": "success",
        "message": "Profile updated successfully",
        "username": user.username,
        "role": user.role,
        "email": user.email,
        "access_token": new_token
    }
