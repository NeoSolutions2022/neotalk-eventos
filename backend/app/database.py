import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from uuid import UUID

import asyncpg
from fastapi import FastAPI, Request


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://neotalk:neotalk@postgres:5432/neotalk",
)

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_set BOOLEAN NOT NULL DEFAULT TRUE,
    role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    onboarding_version INTEGER NOT NULL DEFAULT 0,
    onboarding_step INTEGER NOT NULL DEFAULT 0,
    onboarding_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    onboarding_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    csrf_token VARCHAR(96) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_access_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    source VARCHAR(80) NOT NULL DEFAULT 'acesso',
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    avatar VARCHAR(24) NOT NULL DEFAULT 'lia',
    status VARCHAR(24) NOT NULL DEFAULT 'ready',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS translation_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    text VARCHAR(500) NOT NULL,
    word_count INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (room_id, sequence)
);

ALTER TABLE translation_batches ADD COLUMN IF NOT EXISTS gloss_text TEXT;
ALTER TABLE translation_batches ADD COLUMN IF NOT EXISTS prompt_id UUID;
ALTER TABLE translation_batches ADD COLUMN IF NOT EXISTS model VARCHAR(80);
ALTER TABLE translation_batches ADD COLUMN IF NOT EXISTS agent_latency_ms INTEGER;

CREATE TABLE IF NOT EXISTS agent_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    instructions TEXT NOT NULL,
    version INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    UNIQUE (name, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompts_one_active
ON agent_prompts(is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS dataset_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word_count INTEGER NOT NULL DEFAULT 0,
    source_pages INTEGER NOT NULL DEFAULT 0,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pose_words (
    word TEXT PRIMARY KEY,
    snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_text TEXT NOT NULL,
    gloss_text TEXT,
    glosses TEXT[] NOT NULL DEFAULT '{}',
    missing_words TEXT[] NOT NULL DEFAULT '{}',
    prompt_id UUID REFERENCES agent_prompts(id),
    model VARCHAR(80),
    openai_response_id VARCHAR(120),
    agent_latency_ms INTEGER,
    video_task_id VARCHAR(160),
    video_url TEXT,
    video_words TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(32) NOT NULL DEFAULT 'created',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quality_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quality_run_id UUID NOT NULL REFERENCES quality_runs(id) ON DELETE CASCADE,
    output VARCHAR(16) NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (quality_run_id, output)
);

CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rooms_user_created_at ON rooms(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_access_token ON lead_access_tickets(token_hash) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_batches_room_sequence ON translation_batches(room_id, sequence);
CREATE INDEX IF NOT EXISTS idx_quality_runs_created_at ON quality_runs(created_at DESC);

INSERT INTO agent_prompts (name, instructions, version, is_active, activated_at)
SELECT 'Tradutor Libras', 'Você é o agente de tradução da NeoTalk. Converta português brasileiro em uma sequência objetiva de glosas de Libras. Preserve nomes próprios quando disponíveis, remova artigos e flexões dispensáveis, organize a ordem natural das glosas e use SOMENTE palavras presentes no catálogo fornecido. Não invente palavras. Quando um conceito não existir, selecione a aproximação disponível mais fiel e informe a substituição na justificativa.', 1, TRUE, NOW()
WHERE NOT EXISTS (SELECT 1 FROM agent_prompts);
"""


async def expire_stale_rooms(pool: asyncpg.Pool, user_id: UUID | None = None) -> int:
    result = await pool.execute(
        """
        UPDATE rooms SET status='finished', ended_at=COALESCE(ended_at,NOW()),
        duration_seconds=CASE WHEN started_at IS NULL THEN duration_seconds
          ELSE GREATEST(duration_seconds, EXTRACT(EPOCH FROM (NOW()-started_at))::INTEGER) END,
        updated_at=NOW()
        WHERE status IN ('ready','live')
          AND (($1::UUID IS NULL) OR user_id=$1)
          AND ((status='ready' AND updated_at < NOW()-INTERVAL '15 minutes')
            OR (status='live' AND updated_at < NOW()-INTERVAL '2 minutes'))
        """,
        user_id,
    )
    return int(result.split()[-1])


async def reap_stale_rooms(pool: asyncpg.Pool) -> None:
    while True:
        await asyncio.sleep(60)
        try:
            await expire_stale_rooms(pool)
        except Exception:
            # A falha de uma rodada não pode derrubar a API; a próxima tenta novamente.
            continue


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    async with pool.acquire() as connection:
        await connection.execute(SCHEMA_SQL)
        from .auth import ensure_bootstrap_admin
        await ensure_bootstrap_admin(connection)
    app.state.db = pool
    reaper = asyncio.create_task(reap_stale_rooms(pool))
    yield
    reaper.cancel()
    with suppress(asyncio.CancelledError):
        await reaper
    await pool.close()


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db
