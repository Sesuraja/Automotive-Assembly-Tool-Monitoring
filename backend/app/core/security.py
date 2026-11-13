import datetime
import bcrypt
import logging
from typing import Optional, List, Dict, Any
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.database import get_db

logger = logging.getLogger("security")

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=False
)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.now(datetime.timezone.utc) + expires_delta
    else:
        expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

ROLE_HIERARCHY: Dict[str, List[str]] = {
    "Admin": ["Admin", "Engineer", "Operator", "Viewer"],
    "Engineer": ["Engineer", "Operator", "Viewer"],
    "Operator": ["Operator", "Viewer"],
    "Viewer": ["Viewer"]
}

def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Decodes and validates JWT bearer token.
    Enforces active user verification against database.
    If unauthenticated:
      - If ALLOW_DEMO_UNAUTHENTICATED is True: falls back to demo operator for local testing.
      - Otherwise: raises HTTP 401 Unauthorized.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not token:
        if settings.ALLOW_DEMO_UNAUTHENTICATED:
            logger.debug("Demo unauthenticated access permitted by configuration.")
            return {"username": "demo_operator", "role": "Operator", "email": "operator@aperture.auto"}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: Optional[str] = payload.get("sub")
        role: str = payload.get("role", "Viewer")
        if username is None:
            raise credentials_exception
    except JWTError as e:
        logger.warning(f"JWT verification failure: {e}")
        raise credentials_exception

    # Verify user state in DB if available
    from backend.app.models.schema import User
    user = db.query(User).filter(User.username == username).first()
    if user and not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated."
        )

    return {
        "id": user.id if user else None,
        "username": username,
        "role": user.role if user else role,
        "email": user.email if user else f"{username}@aperture.auto"
    }

def require_role(allowed_roles: List[str]):
    """
    Dependency factory enforcing Role-Based Access Control (RBAC).
    """
    def role_checker(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        user_role = current_user.get("role", "Viewer")
        user_allowed_roles = ROLE_HIERARCHY.get(user_role, ["Viewer"])
        if not any(r in allowed_roles for r in user_allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of roles: {allowed_roles}. Current role: {user_role}"
            )
        return current_user
    return role_checker
