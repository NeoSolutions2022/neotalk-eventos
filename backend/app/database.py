import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://neotalk:neotalk@postgres:5432/neotalk",
)

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
CREATE INDEX IF NOT EXISTS idx_batches_room_sequence ON translation_batches(room_id, sequence);
CREATE INDEX IF NOT EXISTS idx_quality_runs_created_at ON quality_runs(created_at DESC);

INSERT INTO agent_prompts (name, instructions, version, is_active, activated_at)
SELECT 'Tradutor Libras', 'Você é o agente de tradução da NeoTalk. Converta português brasileiro em uma sequência objetiva de glosas de Libras. Preserve nomes próprios quando disponíveis, remova artigos e flexões dispensáveis, organize a ordem natural das glosas e use SOMENTE palavras presentes no catálogo fornecido. Não invente palavras. Quando um conceito não existir, selecione a aproximação disponível mais fiel e informe a substituição na justificativa.', 1, TRUE, NOW()
WHERE NOT EXISTS (SELECT 1 FROM agent_prompts);
"""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    async with pool.acquire() as connection:
        await connection.execute(SCHEMA_SQL)
    app.state.db = pool
    yield
    await pool.close()


def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db
