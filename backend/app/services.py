import asyncio
import hashlib
import json
import os
import time
from dataclasses import dataclass

import asyncpg
import httpx
from fastapi import HTTPException


NEOTALK_API_BASE_URL = os.getenv("NEOTALK_API_BASE_URL", "https://infra-neotalk-api.k3p3ex.easypanel.host").rstrip("/")
NEOTALK_API_KEY = os.getenv("NEOTALK_API_KEY", "")
NEOTALK_API_TIMEOUT_SECONDS = float(os.getenv("NEOTALK_API_TIMEOUT_SECONDS", "30"))


def _video_path(value: str, legacy: str, current: str) -> str:
    path = value.strip() or current
    return current if path == legacy else path


NEOTALK_VIDEO_SUBMIT_PATH = _video_path(
    os.getenv("NEOTALK_VIDEO_SUBMIT_PATH", "/sign-process-video"),
    "/sign-process-type",
    "/sign-process-video",
)
NEOTALK_VIDEO_STATUS_PATH = _video_path(
    os.getenv("NEOTALK_VIDEO_STATUS_PATH", "/task-status-video/{task_id}"),
    "/task-status-type/{task_id}",
    "/task-status-video/{task_id}",
)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "2500"))
OPENAI_RETRY_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_RETRY_MAX_OUTPUT_TOKENS", "5000"))
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "minimal").strip().lower()
AGENT_CONTEXT_CACHE_TTL_SECONDS = max(1.0, float(os.getenv("AGENT_CONTEXT_CACHE_TTL_SECONDS", "300")))


@dataclass(frozen=True)
class AgentContext:
    prompt: dict
    catalog: tuple[str, ...]
    allowed: frozenset[str]
    instructions: str
    prompt_cache_key: str
    expires_at: float


_agent_context_cache: AgentContext | None = None
_agent_context_lock = asyncio.Lock()


class AgentResponseIncomplete(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def integration_status() -> dict:
    return {
        "neotalk_configured": bool(NEOTALK_API_KEY and NEOTALK_API_BASE_URL),
        "openai_configured": bool(OPENAI_API_KEY),
        "openai_model": OPENAI_MODEL,
        "agent_context_cache_ttl_seconds": AGENT_CONTEXT_CACHE_TTL_SECONDS,
        "video_submit_path": NEOTALK_VIDEO_SUBMIT_PATH,
    }


def _neotalk_headers() -> dict[str, str]:
    if not NEOTALK_API_KEY:
        raise HTTPException(status_code=503, detail="NEOTALK_API_KEY não configurada no backend.")
    return {"x-api-key": NEOTALK_API_KEY}


async def sync_pose_words(pool: asyncpg.Pool) -> dict:
    words: list[str] = []
    page = 1
    pages = 1
    async with httpx.AsyncClient(timeout=NEOTALK_API_TIMEOUT_SECONDS) as client:
        while page <= pages:
            response = await client.get(
                f"{NEOTALK_API_BASE_URL}/pose-words",
                params={"page": page, "page_size": 500},
                headers=_neotalk_headers(),
            )
            response.raise_for_status()
            payload = response.json()
            words.extend(str(word).strip().upper() for word in payload.get("items", []) if str(word).strip())
            pages = max(1, int(payload.get("pages", 1)))
            if not payload.get("has_next", page < pages):
                break
            page += 1
    unique_words = sorted(set(words))
    async with pool.acquire() as connection:
        async with connection.transaction():
            snapshot_id = await connection.fetchval(
                "INSERT INTO dataset_snapshots (word_count, source_pages) VALUES ($1, $2) RETURNING id",
                len(unique_words), page,
            )
            await connection.execute("DELETE FROM pose_words")
            await connection.executemany(
                "INSERT INTO pose_words (word, snapshot_id) VALUES ($1, $2)",
                [(word, snapshot_id) for word in unique_words],
            )
    invalidate_agent_context_cache()
    return {"snapshot_id": snapshot_id, "word_count": len(unique_words), "pages": page}


def invalidate_agent_context_cache() -> None:
    global _agent_context_cache
    _agent_context_cache = None


async def _get_agent_context(pool: asyncpg.Pool) -> tuple[AgentContext, bool]:
    global _agent_context_cache
    now = time.monotonic()
    if _agent_context_cache and _agent_context_cache.expires_at > now:
        return _agent_context_cache, True

    async with _agent_context_lock:
        now = time.monotonic()
        if _agent_context_cache and _agent_context_cache.expires_at > now:
            return _agent_context_cache, True

        prompt_record = await pool.fetchrow("SELECT * FROM agent_prompts WHERE is_active = TRUE LIMIT 1")
        if not prompt_record:
            raise HTTPException(status_code=409, detail="Não existe prompt ativo para o agente.")
        rows = await pool.fetch("SELECT word FROM pose_words ORDER BY word LIMIT 8000")
        catalog = tuple(row["word"] for row in rows)
        if not catalog:
            raise HTTPException(status_code=409, detail="O catálogo está vazio. Sincronize o dataset antes de traduzir.")

        prompt = dict(prompt_record)
        instructions = (
            f"{prompt['instructions']}\n\nCATÁLOGO AUTORIZADO ({len(catalog)} palavras):\n"
            + " | ".join(catalog)
            + "\n\nPara entradas ao vivo, traduza o trecho como uma unidade de sentido e forme uma sequência contínua de glosas. "
            + "Quando o catálogo permitir, use duas ou mais glosas e evite devolver uma palavra isolada. "
            + "Responda somente no formato solicitado e mantenha reasoning_summary curto, com no máximo duas frases."
        )
        fingerprint = hashlib.sha256(
            f"{prompt['id']}:{prompt['version']}:{instructions}".encode("utf-8")
        ).hexdigest()[:32]
        _agent_context_cache = AgentContext(
            prompt=prompt,
            catalog=catalog,
            allowed=frozenset(catalog),
            instructions=instructions,
            prompt_cache_key=f"neotalk-gloss-{fingerprint}",
            expires_at=now + AGENT_CONTEXT_CACHE_TTL_SECONDS,
        )
        return _agent_context_cache, False


def _output_text(payload: dict) -> str:
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    raise HTTPException(status_code=502, detail="O agente não retornou conteúdo estruturado.")


def _parse_agent_payload(payload: dict) -> dict:
    response_status = payload.get("status")
    if response_status == "incomplete":
        reason = (payload.get("incomplete_details") or {}).get("reason", "unknown")
        raise AgentResponseIncomplete(str(reason))
    if response_status not in (None, "completed"):
        raise HTTPException(
            status_code=502,
            detail=f"O agente terminou com status inesperado: {response_status}.",
        )
    try:
        result = json.loads(_output_text(payload))
    except json.JSONDecodeError as exc:
        raise AgentResponseIncomplete("invalid_json") from exc
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="O agente retornou uma estrutura inválida.")
    return result


def _openai_error_message(response: httpx.Response) -> str:
    try:
        return response.json().get("error", {}).get("message", "Falha ao consultar o agente GPT.")
    except (json.JSONDecodeError, TypeError, AttributeError):
        return "Falha ao consultar o agente GPT."


async def translate_to_glosses(pool: asyncpg.Pool, text: str) -> dict:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY não configurada no backend.")
    context, context_cache_hit = await _get_agent_context(pool)
    body = {
        "model": OPENAI_MODEL,
        "instructions": context.instructions,
        "input": text,
        "store": False,
        "prompt_cache_key": context.prompt_cache_key,
        "text": {
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "neotalk_gloss_translation",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "glosses": {"type": "array", "items": {"type": "string"}},
                        "reasoning_summary": {"type": "string"},
                    },
                    "required": ["glosses", "reasoning_summary"],
                    "additionalProperties": False,
                },
            }
        },
    }
    if OPENAI_REASONING_EFFORT:
        body["reasoning"] = {"effort": OPENAI_REASONING_EFFORT}
    started = time.perf_counter()
    response_payload: dict | None = None
    result: dict | None = None
    token_limits = (
        OPENAI_MAX_OUTPUT_TOKENS,
        max(OPENAI_RETRY_MAX_OUTPUT_TOKENS, OPENAI_MAX_OUTPUT_TOKENS * 2),
    )
    async with httpx.AsyncClient(timeout=NEOTALK_API_TIMEOUT_SECONDS) as client:
        for attempt, max_output_tokens in enumerate(token_limits):
            response = await client.post(
                f"{OPENAI_BASE_URL}/responses",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
                json={**body, "max_output_tokens": max_output_tokens},
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail=_openai_error_message(response))
            try:
                response_payload = response.json()
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=502, detail="A API do agente retornou uma resposta inválida.") from exc
            try:
                result = _parse_agent_payload(response_payload)
                break
            except AgentResponseIncomplete as exc:
                if attempt + 1 < len(token_limits):
                    continue
                if exc.reason == "max_output_tokens":
                    detail = "O agente excedeu o limite de saída mesmo após uma nova tentativa."
                else:
                    detail = "O agente retornou conteúdo incompleto mesmo após uma nova tentativa."
                raise HTTPException(status_code=502, detail=detail) from exc
    latency_ms = round((time.perf_counter() - started) * 1000)
    if response_payload is None or result is None:
        raise HTTPException(status_code=502, detail="O agente não concluiu a tradução.")
    requested = [str(word).strip().upper() for word in result.get("glosses", []) if str(word).strip()]
    glosses = [word for word in requested if word in context.allowed]
    missing_words = [word for word in requested if word not in context.allowed]
    if not glosses:
        raise HTTPException(status_code=422, detail="O agente não encontrou glosas válidas no catálogo.")
    return {
        "source_text": " ".join(text.split()),
        "glosses": glosses,
        "gloss_text": " ".join(glosses),
        "missing_words": missing_words,
        "reasoning_summary": result.get("reasoning_summary", ""),
        "prompt_id": context.prompt["id"],
        "prompt_version": context.prompt["version"],
        "model": OPENAI_MODEL,
        "openai_response_id": response_payload.get("id"),
        "agent_latency_ms": latency_ms,
        "context_cache_hit": context_cache_hit,
        "cached_input_tokens": ((response_payload.get("usage") or {}).get("input_tokens_details") or {}).get("cached_tokens", 0),
    }


async def submit_video(gloss_text: str) -> str:
    async with httpx.AsyncClient(timeout=NEOTALK_API_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{NEOTALK_API_BASE_URL}{NEOTALK_VIDEO_SUBMIT_PATH}",
            headers=_neotalk_headers(),
            data={"frase": gloss_text},
        )
    if response.status_code != 202:
        raise HTTPException(status_code=502, detail=f"A API de vídeo recusou a solicitação ({response.status_code}).")
    task_id = response.json().get("task_id")
    if not task_id:
        raise HTTPException(status_code=502, detail="A API de vídeo não retornou task_id.")
    return str(task_id)


async def check_video(task_id: str) -> dict:
    path = NEOTALK_VIDEO_STATUS_PATH.format(task_id=task_id)
    async with httpx.AsyncClient(timeout=NEOTALK_API_TIMEOUT_SECONDS) as client:
        response = await client.get(f"{NEOTALK_API_BASE_URL}{path}", headers=_neotalk_headers())
    if response.status_code == 202:
        return {"ready": False}
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar o vídeo ({response.status_code}).")
    payload = response.json()
    return {
        "ready": True,
        "file_url": payload.get("file_url"),
        "words": [str(word) for word in payload.get("palavras_encontradas", [])],
    }
