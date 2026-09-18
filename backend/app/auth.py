import hashlib
import os
import re
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status

from .database import get_pool


COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "neotalk_session")
COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
SESSION_DAYS = max(1, int(os.getenv("SESSION_DURATION_DAYS", "14")))
PASSWORD = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    name: str
    email: str
    role: str
    csrf_token: str
    onboarding_version: int
    onboarding_step: int
    onboarding_status: str
    password_set: bool


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Informe um e-mail válido.")
    return email


def hash_password(value: str) -> str:
    return PASSWORD.hash(value)


def verify_password(value: str, encoded: str) -> bool:
    try:
        return PASSWORD.verify(encoded, value)
    except (VerifyMismatchError, InvalidHashError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def enforce_rate_limit(request: Request, scope: str, limit: int, window_seconds: int) -> None:
    client = request.client.host if request.client else "unknown"
    key = f"{scope}:{client}"
    now = time.monotonic()
    bucket = ATTEMPTS[key]
    while bucket and bucket[0] <= now - window_seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde alguns minutos e tente novamente.")
    bucket.append(now)


async def create_session(pool: asyncpg.Pool, user_id: UUID, response: Response) -> str:
    raw_token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    await pool.execute(
        "INSERT INTO user_sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1,$2,$3,$4)",
        user_id, token_hash(raw_token), csrf, expires,
    )
    response.set_cookie(
        COOKIE_NAME, raw_token, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", path="/", max_age=SESSION_DAYS * 86400,
    )
    return csrf


async def current_user(
    session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    pool: asyncpg.Pool = Depends(get_pool),
) -> CurrentUser:
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticação necessária.")
    row = await pool.fetchrow(
        """
        SELECT u.id,u.name,u.email,u.role,u.status,u.onboarding_version,u.onboarding_step,
               u.onboarding_status,u.password_set,s.csrf_token
        FROM user_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
        """, token_hash(session),
    )
    if not row or row["status"] != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida ou expirada.")
    return CurrentUser(**{key: row[key] for key in CurrentUser.__dataclass_fields__})


async def csrf_user(
    user: CurrentUser = Depends(current_user),
    csrf: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> CurrentUser:
    if not csrf or not secrets.compare_digest(csrf, user.csrf_token):
        raise HTTPException(status_code=403, detail="Token de segurança inválido.")
    return user


async def admin_user(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")
    return user


async def admin_csrf(user: CurrentUser = Depends(csrf_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")
    return user


def user_payload(user: CurrentUser) -> dict:
    return {
        "id": user.id, "name": user.name, "email": user.email, "role": user.role,
        "csrf_token": user.csrf_token, "onboarding_version": user.onboarding_version,
        "onboarding_step": user.onboarding_step, "onboarding_status": user.onboarding_status,
        "password_set": user.password_set,
    }


async def ensure_bootstrap_admin(connection: asyncpg.Connection) -> None:
    email = os.getenv("ADMIN_BOOTSTRAP_EMAIL", "").strip()
    password = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", "")
    if not email or not password:
        return
    email = normalize_email(email)
    row = await connection.fetchrow("SELECT id FROM users WHERE email=$1", email)
    if row:
        await connection.execute(
            "UPDATE users SET role='admin',onboarding_version=1,onboarding_status='completed' WHERE id=$1", row["id"]
        )
        admin_id = row["id"]
    else:
        admin_id = await connection.fetchval(
            "INSERT INTO users(name,email,password_hash,role,onboarding_version,onboarding_status) VALUES($1,$2,$3,'admin',1,'completed') RETURNING id",
            os.getenv("ADMIN_BOOTSTRAP_NAME", "Administrador NeoTalk"), email, hash_password(password),
        )
    await connection.execute("UPDATE rooms SET user_id=$1 WHERE user_id IS NULL", admin_id)
