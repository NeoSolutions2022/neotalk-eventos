import json
import os
import time

import asyncpg
import httpx
from fastapi import HTTPException


NEOTALK_API_BASE_URL = os.getenv("NEOTALK_API_BASE_URL", "https://infra-neotalk-api.k3p3ex.easypanel.host").rstrip("/")
NEOTALK_API_KEY = os.getenv("NEOTALK_API_KEY", "")
NEOTALK_API_TIMEOUT_SECONDS = float(os.getenv("NEOTALK_API_TIMEOUT_SECONDS", "30"))
NEOTALK_VIDEO_SUBMIT_PATH = os.getenv("NEOTALK_VIDEO_SUBMIT_PATH", "/sign-process-type")
NEOTALK_VIDEO_STATUS_PATH = os.getenv("NEOTALK_VIDEO_STATUS_PATH", "/task-status-type/{task_id}")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "2500"))
OPENAI_RETRY_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_RETRY_MAX_OUTPUT_TOKENS", "5000"))


class AgentResponseIncomplete(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def integration_status() -> dict:
    return {
        "neotalk_configured": bool(NEOTALK_API_KEY and NEOTALK_API_BASE_URL),
        "openai_configured": bool(OPENAI_API_KEY),
        "openai_model": OPENAI_MODEL,
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
    return {"snapshot_id": snapshot_id, "word_count": len(unique_words), "pages": page}


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
    prompt = await pool.fetchrow("SELECT * FROM agent_prompts WHERE is_active = TRUE LIMIT 1")
    if not prompt:
        raise HTTPException(status_code=409, detail="Não existe prompt ativo para o agente.")
    rows = await pool.fetch("SELECT word FROM pose_words ORDER BY word LIMIT 8000")
    catalog = [row["word"] for row in rows]
    if not catalog:
        raise HTTPException(status_code=409, detail="O catálogo está vazio. Sincronize o dataset antes de traduzir.")
    instructions = (
        f"{prompt['instructions']}\n\nCATÁLOGO AUTORIZADO ({len(catalog)} palavras):\n"
        + " | ".join(catalog)
        + "\n\nResponda somente no formato solicitado e mantenha reasoning_summary curto, com no máximo duas frases."
    )
    body = {
        "model": OPENAI_MODEL,
        "instructions": instructions,
        "input": text,
        "store": False,
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
    allowed = set(catalog)
    requested = [str(word).strip().upper() for word in result.get("glosses", []) if str(word).strip()]
    glosses = [word for word in requested if word in allowed]
    missing_words = [word for word in requested if word not in allowed]
    if not glosses:
        raise HTTPException(status_code=422, detail="O agente não encontrou glosas válidas no catálogo.")
    return {
        "source_text": " ".join(text.split()),
        "glosses": glosses,
        "gloss_text": " ".join(glosses),
        "missing_words": missing_words,
        "reasoning_summary": result.get("reasoning_summary", ""),
        "prompt_id": prompt["id"],
        "prompt_version": prompt["version"],
        "model": OPENAI_MODEL,
        "openai_response_id": response_payload.get("id"),
        "agent_latency_ms": latency_ms,
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
