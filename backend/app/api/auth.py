from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timezone
from backend.app.database import get_db
from backend.app.models.schema import User, AuditLog
from backend.app.schemas.pydantic_models import (
    UserLoginRequest, TokenResponse, UserProfileResponse, ProfileUpdateRequest
)
from backend.app.core.security import (
    verify_password, create_access_token, get_password_hash,
    get_current_user, require_role
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/login", response_model=TokenResponse)
def login(login_req: UserLoginRequest, db: Session = Depends(get_db)):
    req_username = (login_req.username or "").strip()
    user = db.query(User).filter(func.lower(User.username) == req_username.lower()).first()
    
    if not user or not verify_password(login_req.password, user.hashed_password):
        # Log failed attempt
        audit = AuditLog(
            username=req_username or "unknown",
            action="LOGIN_FAILED",
            resource="AuthService",
            details="Invalid username or password attempt"
        )
        db.add(audit)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please contact system administrator."
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
def get_me(
    username: str = "",
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns profile of currently authenticated user.
    Admins can query other usernames via query param.
    """
    target_username = current_user.get("username")
    
    # If admin requests another user's profile
    if username and username.strip().lower() != target_username.lower():
        if current_user.get("role") == "Admin":
            target_username = username.strip()
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Non-admin users cannot query other user profiles."
            )

    user = db.query(User).filter(func.lower(User.username) == target_username.lower()).first()
    if not user:
        return {
            "username": current_user.get("username", "admin"),
            "role": current_user.get("role", "Admin"),
            "email": current_user.get("email", "admin@aperture.auto")
        }
    return {
        "username": user.username,
        "role": user.role or "Viewer",
        "email": user.email
    }

@router.put("/profile")
def update_profile(
    req: ProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Updates profile settings. Users can only update their own profile unless they are Admins.
    """
    caller_username = current_user.get("username")
    caller_role = current_user.get("role")

    target_username = (req.current_username or caller_username).strip()
    if target_username != caller_username and caller_role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify other users' profiles."
        )

    user = db.query(User).filter(func.lower(User.username) == target_username.lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"User account '{target_username}' not found")

    changes = []

    if req.new_username and req.new_username.strip() and req.new_username.strip() != user.username:
        new_name = req.new_username.strip()
        existing = db.query(User).filter(func.lower(User.username) == new_name.lower()).first()
        if existing and existing.id != user.id:
            raise HTTPException(status_code=400, detail="Username already exists")
        changes.append(f"username from '{user.username}' to '{new_name}'")
        user.username = new_name

    if req.email and req.email.strip() and req.email.strip() != user.email:
        new_email = req.email.strip()
        existing_email = db.query(User).filter(func.lower(User.email) == new_email.lower()).first()
        if existing_email and existing_email.id != user.id:
            raise HTTPException(status_code=400, detail="Email address is already in use")
        changes.append(f"email to '{new_email}'")
        user.email = new_email

    if req.password and req.password.strip():
        if len(req.password.strip()) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters long")
        user.hashed_password = get_password_hash(req.password.strip())
        changes.append("password updated")

    # Issue fresh token
    new_token = create_access_token(data={"sub": user.username, "role": user.role})

    # Log to Audit Trail
    change_summary = ", ".join(changes) if changes else "Profile refreshed"
    audit = AuditLog(
        username=caller_username,
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
