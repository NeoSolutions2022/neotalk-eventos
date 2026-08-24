import os
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .database import get_pool, lifespan
from .schemas import BatchCreate, BatchOut, BatchUpdate, RoomCreate, RoomDetail, RoomFinish, RoomOut


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
    return {"status": "ok", "database": "connected", "api_version": "1.0.0"}


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
            completed_at = CASE WHEN $2::VARCHAR IN ('done', 'error') THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
        """,
        batch_id,
        payload.status,
        payload.error_message,
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
