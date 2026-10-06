import datetime
import bcrypt
from typing import Optional, List
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.database import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    # Hash password with bcrypt
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.now(datetime.timezone.utc) + expires_delta
    else:
        expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

ROLE_HIERARCHY = {
    "Admin": ["Admin", "Engineer", "Operator", "Viewer"],
    "Engineer": ["Engineer", "Operator", "Viewer"],
    "Operator": ["Operator", "Viewer"],
    "Viewer": ["Viewer"]
}

def require_role(allowed_roles: List[str]):
    def role_checker(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)):
        if not token:
            # Default Operator role for local demo convenience
            return {"username": "demo_operator", "role": "Operator"}
            
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            username: str = payload.get("sub")
            role: str = payload.get("role", "Viewer")
            if username is None:
                raise HTTPException(status_code=401, detail="Invalid token subject")
        except JWTError:
            raise HTTPException(status_code=401, detail="Could not validate credentials")
            
        user_allowed_roles = ROLE_HIERARCHY.get(role, ["Viewer"])
        if not any(r in allowed_roles for r in user_allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of roles: {allowed_roles}. Current role: {role}"
            )
        return {"username": username, "role": role}
    return role_checker
