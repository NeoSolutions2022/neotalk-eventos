import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import asyncpg
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .database import expire_stale_rooms, get_pool, lifespan
from .auth import (
    COOKIE_NAME, CurrentUser, admin_csrf, admin_user, create_session, csrf_user,
    current_user, enforce_rate_limit, hash_password, normalize_email, token_hash, user_payload, verify_password,
)
from .schemas import (
    AgentTranslateIn,
    BatchCreate,
    BatchOut,
    BatchUpdate,
    PromptCreate,
    QualityRatingCreate,
    QualityRunCreate,
    RoomCreate,
    RoomDetail,
    RoomFinish,
    RoomOut,
    LoginIn,
    LeadAccessIn,
    HandoffConsumeIn,
    OnboardingUpdate,
    PasswordSetIn,
    RegisterIn,
)
from .services import (
    check_video,
    integration_status,
    invalidate_agent_context_cache,
    submit_video,
    sync_pose_words,
    transcribe_audio,
    translate_to_glosses,
)

def record_dict(record: asyncpg.Record) -> dict:
    return dict(record)


def cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(
    title="NeoTalk Live Rooms API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=()"
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.get("/api/v1/health")
async def health(pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    await pool.fetchval("SELECT 1")
    return {"status": "ok", "database": "connected", "api_version": "2.0.0", "integrations": integration_status()}


@app.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterIn, response: Response, request: Request, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    enforce_rate_limit(request, "register", 8, 3600)
    email = normalize_email(payload.email)
    name = " ".join(payload.name.split())
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Informe seu nome.")
    try:
        row = await pool.fetchrow(
            """INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)
               RETURNING id,name,email,role,onboarding_version,onboarding_step,onboarding_status""",
            name, email, hash_password(payload.password),
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
    csrf = await create_session(pool, row["id"], response)
    return {**record_dict(row), "csrf_token": csrf, "password_set": True}


@app.post("/api/v1/auth/login")
async def login(payload: LoginIn, response: Response, request: Request, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    enforce_rate_limit(request, "login", 12, 900)
    email = normalize_email(payload.email)
    row = await pool.fetchrow("SELECT * FROM users WHERE email=$1 AND status='active'", email)
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")
    csrf = await create_session(pool, row["id"], response)
    return {
        "id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"],
        "csrf_token": csrf, "onboarding_version": row["onboarding_version"],
        "onboarding_step": row["onboarding_step"], "onboarding_status": row["onboarding_status"],
        "password_set": row["password_set"],
    }


@app.post("/api/v1/auth/lead-access", status_code=status.HTTP_201_CREATED)
async def create_lead_access(
    payload: LeadAccessIn,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict:
    """Create a short-lived, one-time login only for a brand-new form lead."""
    enforce_rate_limit(request, "lead-access", 12, 3600)
    email = normalize_email(payload.email)
    name = " ".join(payload.name.split())
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Informe seu nome.")
    raw_code = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(minutes=5)
    async with pool.acquire() as connection:
        async with connection.transaction():
            if await connection.fetchval("SELECT 1 FROM users WHERE email=$1", email):
                return {"status": "existing_account"}
            try:
                user_id = await connection.fetchval(
                    """INSERT INTO users(name,email,password_hash,password_set)
                       VALUES($1,$2,$3,FALSE) RETURNING id""",
                    name, email, hash_password(secrets.token_urlsafe(48)),
                )
            except asyncpg.UniqueViolationError:
                return {"status": "existing_account"}
            await connection.execute(
                """INSERT INTO lead_access_tickets(user_id,token_hash,source,expires_at)
                   VALUES($1,$2,$3,$4)""",
                user_id, token_hash(raw_code), payload.source.strip(), expires,
            )
    return {"status": "created", "code": raw_code, "expires_in": 300}


@app.post("/api/v1/auth/lead-access/consume")
async def consume_lead_access(
    payload: HandoffConsumeIn,
    response: Response,
    request: Request,
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict:
    enforce_rate_limit(request, "lead-access-consume", 20, 900)
    row = await pool.fetchrow(
        """UPDATE lead_access_tickets SET consumed_at=NOW()
           WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at > NOW()
           RETURNING user_id""",
        token_hash(payload.code),
    )
    if not row:
        raise HTTPException(status_code=401, detail="Este acesso expirou ou já foi utilizado.")
    user = await pool.fetchrow(
        """SELECT id,name,email,role,onboarding_version,onboarding_step,onboarding_status,password_set
           FROM users WHERE id=$1 AND status='active'""",
        row["user_id"],
    )
    if not user:
        raise HTTPException(status_code=401, detail="Conta indisponível.")
    csrf = await create_session(pool, user["id"], response)
    return {**record_dict(user), "csrf_token": csrf}


@app.post("/api/v1/auth/password")
async def set_account_password(
    payload: PasswordSetIn,
    user: CurrentUser = Depends(csrf_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict:
    await pool.execute(
        "UPDATE users SET password_hash=$2,password_set=TRUE,updated_at=NOW() WHERE id=$1",
        user.id, hash_password(payload.password),
    )
    return {"password_set": True}


@app.get("/api/v1/auth/me")
async def me(user: CurrentUser = Depends(current_user)) -> dict:
    return user_payload(user)


@app.post("/api/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    user: CurrentUser = Depends(csrf_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> Response:
    if session:
        await pool.execute("UPDATE user_sessions SET revoked_at=NOW() WHERE token_hash=$1", token_hash(session))
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.patch("/api/v1/auth/onboarding")
async def update_onboarding(
    payload: OnboardingUpdate,
    user: CurrentUser = Depends(csrf_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict:
    version = 1 if payload.status in {"completed", "skipped"} else 0
    row = await pool.fetchrow(
        """UPDATE users SET onboarding_version=$2,onboarding_step=$3,onboarding_status=$4::TEXT,
           onboarding_completed_at=CASE WHEN $4::TEXT IN ('completed','skipped') THEN NOW() ELSE NULL END,
           updated_at=NOW() WHERE id=$1
           RETURNING onboarding_version,onboarding_step,onboarding_status""",
        user.id, version, payload.step, payload.status,
    )
    return record_dict(row)


@app.get("/api/v1/admin/integrations")
async def integrations(pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_user)) -> dict:
    dataset_words = await pool.fetchval("SELECT COUNT(*) FROM pose_words")
    active_prompt = await pool.fetchrow(
        "SELECT id, name, version, activated_at FROM agent_prompts WHERE is_active = TRUE LIMIT 1"
    )
    return {
        **integration_status(),
        "dataset_words": dataset_words,
        "active_prompt": record_dict(active_prompt) if active_prompt else None,
    }


@app.get("/api/v1/admin/prompts")
async def list_prompts(pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_user)) -> list[dict]:
    rows = await pool.fetch("SELECT * FROM agent_prompts ORDER BY created_at DESC")
    return [record_dict(row) for row in rows]


@app.post("/api/v1/admin/prompts", status_code=status.HTTP_201_CREATED)
async def create_prompt(payload: PromptCreate, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_csrf)) -> dict:
    async with pool.acquire() as connection:
        async with connection.transaction():
            version = await connection.fetchval(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM agent_prompts WHERE name = $1",
                payload.name.strip(),
            )
            if payload.activate:
                await connection.execute("UPDATE agent_prompts SET is_active = FALSE WHERE is_active = TRUE")
            row = await connection.fetchrow(
                """
                INSERT INTO agent_prompts (name, instructions, version, is_active, activated_at)
                VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() ELSE NULL END)
                RETURNING *
                """,
                payload.name.strip(), payload.instructions.strip(), version, payload.activate,
            )
    if payload.activate:
        invalidate_agent_context_cache()
    return record_dict(row)


@app.post("/api/v1/admin/prompts/{prompt_id}/activate")
async def activate_prompt(prompt_id: UUID, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_csrf)) -> dict:
    async with pool.acquire() as connection:
        async with connection.transaction():
            if not await connection.fetchval("SELECT id FROM agent_prompts WHERE id = $1 FOR UPDATE", prompt_id):
                raise HTTPException(status_code=404, detail="Prompt não encontrado.")
            await connection.execute("UPDATE agent_prompts SET is_active = FALSE WHERE is_active = TRUE")
            row = await connection.fetchrow(
                "UPDATE agent_prompts SET is_active = TRUE, activated_at = NOW() WHERE id = $1 RETURNING *",
                prompt_id,
            )
    invalidate_agent_context_cache()
    return record_dict(row)


@app.get("/api/v1/admin/dataset")
async def dataset_status(pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_user)) -> dict:
    snapshot = await pool.fetchrow("SELECT * FROM dataset_snapshots ORDER BY synced_at DESC LIMIT 1")
    return {"snapshot": record_dict(snapshot) if snapshot else None, "word_count": await pool.fetchval("SELECT COUNT(*) FROM pose_words")}


@app.post("/api/v1/admin/dataset/sync")
async def sync_dataset(pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_csrf)) -> dict:
    try:
        return await sync_pose_words(pool)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao sincronizar catálogo: {exc}") from exc


@app.get("/api/v1/admin/pose-words")
async def list_pose_words(search: str = "", page: int = 1, page_size: int = 100, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_user)) -> dict:
    safe_page = max(1, page)
    safe_size = min(max(page_size, 1), 500)
    pattern = f"%{search.strip().upper()}%"
    total = await pool.fetchval("SELECT COUNT(*) FROM pose_words WHERE word ILIKE $1", pattern)
    rows = await pool.fetch(
        "SELECT word FROM pose_words WHERE word ILIKE $1 ORDER BY word LIMIT $2 OFFSET $3",
        pattern, safe_size, (safe_page - 1) * safe_size,
    )
    pages = max(1, (total + safe_size - 1) // safe_size)
    return {"items": [row["word"] for row in rows], "page": safe_page, "page_size": safe_size, "total": total, "pages": pages, "has_next": safe_page < pages}


@app.post("/api/v1/agent/translate")
async def agent_translate(payload: AgentTranslateIn, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> dict:
    if payload.batch_id and not await pool.fetchval(
        "SELECT b.id FROM translation_batches b JOIN rooms r ON r.id=b.room_id WHERE b.id=$1 AND (r.user_id=$2 OR $3='admin')",
        payload.batch_id, user.id, user.role,
    ):
        raise HTTPException(status_code=404, detail="Lote não encontrado.")
    result = await translate_to_glosses(pool, payload.text)
    if payload.batch_id:
        await pool.execute(
            """
            UPDATE translation_batches
            SET gloss_text = $2, prompt_id = $3, model = $4, agent_latency_ms = $5, updated_at = NOW()
            WHERE id = $1
            """,
            payload.batch_id, result["gloss_text"], result["prompt_id"], result["model"], result["agent_latency_ms"],
        )
    return result


@app.post("/api/v1/agent/transcribe")
async def agent_transcribe(request: Request, _: CurrentUser = Depends(csrf_user)) -> dict:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type not in {"audio/webm", "audio/ogg", "audio/mp4"}:
        raise HTTPException(status_code=415, detail="Formato de áudio não suportado.")
    content = await request.body()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Trecho de áudio muito grande.")
    return {"text": await transcribe_audio(content, content_type)}


@app.post("/api/v1/admin/quality-runs", status_code=status.HTTP_201_CREATED)
async def create_quality_run(payload: QualityRunCreate, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_csrf)) -> dict:
    translation = await translate_to_glosses(pool, payload.text)
    try:
        video_task_id = await submit_video(translation["gloss_text"])
        run_status = "video_processing"
        error_message = None
    except HTTPException as exc:
        video_task_id = None
        run_status = "video_error"
        error_message = str(exc.detail)
    row = await pool.fetchrow(
        """
        INSERT INTO quality_runs (
            source_text, gloss_text, glosses, missing_words, prompt_id, model,
            openai_response_id, agent_latency_ms, video_task_id, status, error_message
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
        """,
        translation["source_text"], translation["gloss_text"], translation["glosses"],
        translation["missing_words"], translation["prompt_id"], translation["model"],
        translation["openai_response_id"], translation["agent_latency_ms"], video_task_id,
        run_status, error_message,
    )
    result = record_dict(row)
    result["reasoning_summary"] = translation["reasoning_summary"]
    result["prompt_version"] = translation["prompt_version"]
    return result


@app.get("/api/v1/admin/quality-runs")
async def list_quality_runs(limit: int = 20, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_user)) -> list[dict]:
    rows = await pool.fetch("SELECT * FROM quality_runs ORDER BY created_at DESC LIMIT $1", min(max(limit, 1), 100))
    return [record_dict(row) for row in rows]


@app.get("/api/v1/admin/quality-runs/{run_id}")
async def get_quality_run(run_id: UUID, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_user)) -> dict:
    row = await pool.fetchrow("SELECT * FROM quality_runs WHERE id = $1", run_id)
    if not row:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    result = record_dict(row)
    if result["status"] == "video_processing" and result["video_task_id"]:
        try:
            video = await check_video(result["video_task_id"])
            if video["ready"]:
                row = await pool.fetchrow(
                    """
                    UPDATE quality_runs SET video_url=$2, video_words=$3, status='ready',
                    completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *
                    """,
                    run_id, video["file_url"], video["words"],
                )
                result = record_dict(row)
        except HTTPException as exc:
            row = await pool.fetchrow(
                "UPDATE quality_runs SET status='video_error', error_message=$2, updated_at=NOW() WHERE id=$1 RETURNING *",
                run_id, str(exc.detail),
            )
            result = record_dict(row)
    return result


@app.post("/api/v1/admin/quality-runs/{run_id}/ratings", status_code=status.HTTP_201_CREATED)
async def rate_quality_run(run_id: UUID, payload: QualityRatingCreate, pool: asyncpg.Pool = Depends(get_pool), _: CurrentUser = Depends(admin_csrf)) -> dict:
    if not await pool.fetchval("SELECT id FROM quality_runs WHERE id = $1", run_id):
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    row = await pool.fetchrow(
        """
        INSERT INTO quality_ratings (quality_run_id, output, score, notes)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (quality_run_id, output)
        DO UPDATE SET score=EXCLUDED.score, notes=EXCLUDED.notes, created_at=NOW()
        RETURNING *
        """,
        run_id, payload.output, payload.score, payload.notes,
    )
    return record_dict(row)


@app.post("/api/v1/rooms", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
async def create_room(payload: RoomCreate, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> dict:
    await expire_stale_rooms(pool, user.id)
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.fetchval("SELECT id FROM users WHERE id=$1 FOR UPDATE", user.id)
            if user.role != "admin" and await connection.fetchval(
                "SELECT id FROM rooms WHERE user_id=$1 AND status IN ('ready','live') LIMIT 1", user.id
            ):
                raise HTTPException(status_code=409, detail="Finalize sua sala atual antes de criar outra.")
            row = await connection.fetchrow(
                """INSERT INTO rooms (name, avatar, user_id) VALUES ($1,$2,$3)
                   RETURNING *, 0::BIGINT AS batch_count""",
                payload.name.strip(), payload.avatar, user.id,
            )
    return record_dict(row)


@app.get("/api/v1/rooms", response_model=list[RoomOut])
async def list_rooms(limit: int = 50, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(current_user)) -> list[dict]:
    await expire_stale_rooms(pool, None if user.role == "admin" else user.id)
    safe_limit = min(max(limit, 1), 100)
    rows = await pool.fetch(
        """
        SELECT rooms.*, COUNT(translation_batches.id)::BIGINT AS batch_count
        FROM rooms
        LEFT JOIN translation_batches ON translation_batches.room_id = rooms.id
        WHERE rooms.user_id = $2 OR $3 = 'admin'
        GROUP BY rooms.id
        ORDER BY rooms.created_at DESC
        LIMIT $1
        """,
        safe_limit, user.id, user.role,
    )
    return [record_dict(row) for row in rows]


@app.get("/api/v1/rooms/{room_id}", response_model=RoomDetail)
async def get_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(current_user)) -> dict:
    room = await pool.fetchrow(
        """
        SELECT rooms.*, COUNT(translation_batches.id)::BIGINT AS batch_count
        FROM rooms
        LEFT JOIN translation_batches ON translation_batches.room_id = rooms.id
        WHERE rooms.id = $1 AND (rooms.user_id = $2 OR $3 = 'admin')
        GROUP BY rooms.id
        """,
        room_id, user.id, user.role,
    )
    if not room:
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    batches = await pool.fetch(
        "SELECT * FROM translation_batches WHERE room_id = $1 ORDER BY sequence",
        room_id,
    )
    result = record_dict(room)
    result["batches"] = [record_dict(batch) for batch in batches]
    return result


@app.post("/api/v1/rooms/{room_id}/start", response_model=RoomOut)
async def start_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> dict:
    row = await pool.fetchrow(
        """
        UPDATE rooms
        SET status = 'live', started_at = COALESCE(started_at, NOW()), ended_at = NULL, updated_at = NOW()
        WHERE id = $1 AND (user_id = $2 OR $3 = 'admin')
        RETURNING *, (SELECT COUNT(*) FROM translation_batches WHERE room_id = $1)::BIGINT AS batch_count
        """,
        room_id, user.id, user.role,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return record_dict(row)


@app.post("/api/v1/rooms/{room_id}/finish", response_model=RoomOut)
async def finish_room(room_id: UUID, payload: RoomFinish, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> dict:
    row = await pool.fetchrow(
        """
        UPDATE rooms
        SET status = 'finished', ended_at = NOW(), duration_seconds = $2, updated_at = NOW()
        WHERE id = $1 AND (user_id = $3 OR $4 = 'admin')
        RETURNING *, (SELECT COUNT(*) FROM translation_batches WHERE room_id = $1)::BIGINT AS batch_count
        """,
        room_id,
        payload.duration_seconds,
        user.id,
        user.role,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return record_dict(row)


@app.post("/api/v1/rooms/{room_id}/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> Response:
    result = await pool.execute(
        """UPDATE rooms SET updated_at=NOW() WHERE id=$1 AND status='live'
           AND (user_id=$2 OR $3='admin')""",
        room_id, user.id, user.role,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Sala ao vivo não encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/v1/rooms/{room_id}/batches", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
async def create_batch(room_id: UUID, payload: BatchCreate, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> dict:
    text = " ".join(payload.text.split())
    async with pool.acquire() as connection:
        async with connection.transaction():
            room_exists = await connection.fetchval(
                "SELECT id FROM rooms WHERE id=$1 AND (user_id=$2 OR $3='admin') FOR UPDATE",
                room_id, user.id, user.role,
            )
            if not room_exists:
                raise HTTPException(status_code=404, detail="Sala não encontrada.")
            sequence = await connection.fetchval(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM translation_batches WHERE room_id = $1",
                room_id,
            )
            row = await connection.fetchrow(
                """
                INSERT INTO translation_batches (room_id, sequence, text, word_count)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                """,
                room_id,
                sequence,
                text,
                len(text.split()),
            )
    return record_dict(row)


@app.patch("/api/v1/batches/{batch_id}", response_model=BatchOut)
async def update_batch(batch_id: UUID, payload: BatchUpdate, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> dict:
    row = await pool.fetchrow(
        """
        UPDATE translation_batches
        SET status = $2::VARCHAR,
            error_message = $3::TEXT,
            gloss_text = COALESCE($4::TEXT, gloss_text),
            prompt_id = COALESCE($5::UUID, prompt_id),
            model = COALESCE($6::VARCHAR, model),
            agent_latency_ms = COALESCE($7::INTEGER, agent_latency_ms),
            completed_at = CASE WHEN $2::VARCHAR IN ('done', 'error') THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = $1 AND EXISTS (
            SELECT 1 FROM rooms WHERE rooms.id=translation_batches.room_id
            AND (rooms.user_id=$8 OR $9='admin')
        )
        RETURNING *
        """,
        batch_id,
        payload.status,
        payload.error_message,
        payload.gloss_text,
        payload.prompt_id,
        payload.model,
        payload.agent_latency_ms,
        user.id,
        user.role,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lote não encontrado.")
    return record_dict(row)


@app.delete("/api/v1/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool), user: CurrentUser = Depends(csrf_user)) -> Response:
    result = await pool.execute(
        "DELETE FROM rooms WHERE id=$1 AND (user_id=$2 OR $3='admin')", room_id, user.id, user.role
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
