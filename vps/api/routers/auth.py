import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import bcrypt as bcrypt_lib
from jose import JWTError, jwt
import bcrypt as bcrypt_lib
from pydantic import BaseModel

from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


def create_token(username: str) -> str:
    expire = datetime.now(tz=timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode({"sub": username, "exp": expire}, settings.JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub", "")
        if not username:
            logger.warning("JWT decoded but 'sub' claim is empty")
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> str:
    if not credentials:
        logger.warning("Request with no Bearer token rejected")
        raise HTTPException(status_code=401, detail="Not authenticated")
    return verify_token(credentials.credentials)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request):
    client_host = request.client.host if request.client else "unknown"
    if body.username != settings.ADMIN_USERNAME:
        logger.warning(
            "Login failed: unknown username '%s' (client=%s)",
            body.username, client_host,
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not settings.ADMIN_PASSWORD_HASH or not bcrypt_lib.checkpw(body.password.encode(), settings.ADMIN_PASSWORD_HASH.encode()):
        logger.warning(
            "Login failed: wrong password for user '%s' (client=%s)",
            body.username, client_host,
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    logger.info("Login successful: user='%s' (client=%s)", body.username, client_host)
    return TokenResponse(access_token=create_token(body.username))


@router.get("/me")
async def me(username: str = Depends(get_current_user)):
    logger.debug("GET /auth/me: user='%s'", username)
    return {"username": username}
