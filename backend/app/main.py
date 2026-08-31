import os
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .database import get_pool, lifespan
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
)
from .services import (
    check_video,
    integration_status,
    invalidate_agent_context_cache,
    submit_video,
    sync_pose_words,
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
    allow_headers=["Content-Type"],
)


@app.get("/api/v1/health")
async def health(pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    await pool.fetchval("SELECT 1")
    return {"status": "ok", "database": "connected", "api_version": "2.0.0", "integrations": integration_status()}


@app.get("/api/v1/admin/integrations")
async def integrations(pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def list_prompts(pool: asyncpg.Pool = Depends(get_pool)) -> list[dict]:
    rows = await pool.fetch("SELECT * FROM agent_prompts ORDER BY created_at DESC")
    return [record_dict(row) for row in rows]


@app.post("/api/v1/admin/prompts", status_code=status.HTTP_201_CREATED)
async def create_prompt(payload: PromptCreate, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def activate_prompt(prompt_id: UUID, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def dataset_status(pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    snapshot = await pool.fetchrow("SELECT * FROM dataset_snapshots ORDER BY synced_at DESC LIMIT 1")
    return {"snapshot": record_dict(snapshot) if snapshot else None, "word_count": await pool.fetchval("SELECT COUNT(*) FROM pose_words")}


@app.post("/api/v1/admin/dataset/sync")
async def sync_dataset(pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    try:
        return await sync_pose_words(pool)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao sincronizar catálogo: {exc}") from exc


@app.get("/api/v1/admin/pose-words")
async def list_pose_words(search: str = "", page: int = 1, page_size: int = 100, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def agent_translate(payload: AgentTranslateIn, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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


@app.post("/api/v1/admin/quality-runs", status_code=status.HTTP_201_CREATED)
async def create_quality_run(payload: QualityRunCreate, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def list_quality_runs(limit: int = 20, pool: asyncpg.Pool = Depends(get_pool)) -> list[dict]:
    rows = await pool.fetch("SELECT * FROM quality_runs ORDER BY created_at DESC LIMIT $1", min(max(limit, 1), 100))
    return [record_dict(row) for row in rows]


@app.get("/api/v1/admin/quality-runs/{run_id}")
async def get_quality_run(run_id: UUID, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def rate_quality_run(run_id: UUID, payload: QualityRatingCreate, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
async def create_room(payload: RoomCreate, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    row = await pool.fetchrow(
        """
        INSERT INTO rooms (name, avatar)
        VALUES ($1, $2)
        RETURNING *, 0::BIGINT AS batch_count
        """,
        payload.name.strip(),
        payload.avatar,
    )
    return record_dict(row)


@app.get("/api/v1/rooms", response_model=list[RoomOut])
async def list_rooms(limit: int = 50, pool: asyncpg.Pool = Depends(get_pool)) -> list[dict]:
    safe_limit = min(max(limit, 1), 100)
    rows = await pool.fetch(
        """
        SELECT rooms.*, COUNT(translation_batches.id)::BIGINT AS batch_count
        FROM rooms
        LEFT JOIN translation_batches ON translation_batches.room_id = rooms.id
        GROUP BY rooms.id
        ORDER BY rooms.created_at DESC
        LIMIT $1
        """,
        safe_limit,
    )
    return [record_dict(row) for row in rows]


@app.get("/api/v1/rooms/{room_id}", response_model=RoomDetail)
async def get_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    room = await pool.fetchrow(
        """
        SELECT rooms.*, COUNT(translation_batches.id)::BIGINT AS batch_count
        FROM rooms
        LEFT JOIN translation_batches ON translation_batches.room_id = rooms.id
        WHERE rooms.id = $1
        GROUP BY rooms.id
        """,
        room_id,
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
async def start_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    row = await pool.fetchrow(
        """
        UPDATE rooms
        SET status = 'live', started_at = COALESCE(started_at, NOW()), ended_at = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING *, (SELECT COUNT(*) FROM translation_batches WHERE room_id = $1)::BIGINT AS batch_count
        """,
        room_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return record_dict(row)


@app.post("/api/v1/rooms/{room_id}/finish", response_model=RoomOut)
async def finish_room(room_id: UUID, payload: RoomFinish, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    row = await pool.fetchrow(
        """
        UPDATE rooms
        SET status = 'finished', ended_at = NOW(), duration_seconds = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *, (SELECT COUNT(*) FROM translation_batches WHERE room_id = $1)::BIGINT AS batch_count
        """,
        room_id,
        payload.duration_seconds,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return record_dict(row)


@app.post("/api/v1/rooms/{room_id}/batches", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
async def create_batch(room_id: UUID, payload: BatchCreate, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    text = " ".join(payload.text.split())
    async with pool.acquire() as connection:
        async with connection.transaction():
            room_exists = await connection.fetchval("SELECT id FROM rooms WHERE id = $1 FOR UPDATE", room_id)
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
async def update_batch(batch_id: UUID, payload: BatchUpdate, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
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
        WHERE id = $1
        RETURNING *
        """,
        batch_id,
        payload.status,
        payload.error_message,
        payload.gloss_text,
        payload.prompt_id,
        payload.model,
        payload.agent_latency_ms,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lote não encontrado.")
    return record_dict(row)


@app.delete("/api/v1/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: UUID, pool: asyncpg.Pool = Depends(get_pool)) -> Response:
    result = await pool.execute("DELETE FROM rooms WHERE id = $1", room_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
