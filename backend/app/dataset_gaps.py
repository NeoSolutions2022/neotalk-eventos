"""Aggregate vocabulary candidates, never whole transcripts or audio."""
import asyncio
import logging
import re
import unicodedata

import asyncpg
from fastapi import APIRouter, Depends, Query

from .auth import CurrentUser, admin_user
from .database import get_pool

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin/dataset-gaps", tags=["dataset"])

SCHEMA = """
CREATE TABLE IF NOT EXISTS dataset_missing_terms (
    term_key VARCHAR(96) PRIMARY KEY,
    term VARCHAR(96) NOT NULL,
    occurrences BIGINT NOT NULL DEFAULT 1,
    live_occurrences BIGINT NOT NULL DEFAULT 0,
    quality_occurrences BIGINT NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dataset_missing_observations (
    observation_key VARCHAR(180) NOT NULL,
    term_key VARCHAR(96) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (observation_key, term_key)
);
CREATE INDEX IF NOT EXISTS idx_missing_terms_frequency
ON dataset_missing_terms(occurrences DESC, term_key);
CREATE INDEX IF NOT EXISTS idx_missing_observations_date
ON dataset_missing_observations(observed_at);
"""

STOP_WORDS = frozenset("A AS O OS UM UMA UNS UMAS DE DO DA DOS DAS E EM NO NA NOS NAS PARA POR COM QUE SE EU TU ELE ELA NÓS VÓS ELES ELAS ME TE SEU SUA SER ESTAR TER IR AO AOS OU MAS NÃO SIM".split())


def term_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.upper())
    return "_".join("".join(c for c in value if not unicodedata.combining(c)).replace("-", " ").replace("_", " ").split())


def missing_candidates(values: object, catalog: frozenset[str]) -> list[str]:
    """Model-reported gaps are suggestions for QA, not proven absent concepts."""
    if not isinstance(values, list):
        return []
    allowed = {term_key(word) for word in catalog}
    stop = {term_key(word) for word in STOP_WORDS}
    found = {}
    for value in values[:12]:
        if not isinstance(value, str):
            continue
        term = "_".join(value.strip().upper().split())
        key = term_key(term)
        # Exclude URLs, contact details, numbers, free-form sentences and controls.
        if not 2 <= len(term) <= 96 or not re.fullmatch(r"[A-ZÀ-ÖØ-Þ]+(?:[_-][A-ZÀ-ÖØ-Þ]+){0,3}", term):
            continue
        if key not in allowed and key not in stop:
            found.setdefault(key, term)
    return list(found.values())


async def record_missing_terms(pool: asyncpg.Pool, terms: list[str], observation: str, source: str) -> None:
    if not terms or not observation or len(observation) > 180 or source not in {"live", "quality"}:
        return
    keys = [term_key(term) for term in terms]
    try:
        # Runs after the response; one bounded statement, not one query per word.
        await asyncio.wait_for(pool.execute("""
                WITH fresh AS (
                    INSERT INTO dataset_missing_observations(observation_key,term_key)
                    SELECT $1,k FROM UNNEST($2::TEXT[]) AS k
                    ON CONFLICT DO NOTHING RETURNING term_key
                )
                INSERT INTO dataset_missing_terms(term_key,term,occurrences,live_occurrences,quality_occurrences)
                SELECT f.term_key, t.term, 1, ($4='live')::INTEGER, ($4='quality')::INTEGER
                FROM fresh f JOIN UNNEST($2::TEXT[],$3::TEXT[]) AS t(key,term) ON t.key=f.term_key
                ON CONFLICT (term_key) DO UPDATE SET
                    occurrences=dataset_missing_terms.occurrences+1,
                    live_occurrences=dataset_missing_terms.live_occurrences+EXCLUDED.live_occurrences,
                    quality_occurrences=dataset_missing_terms.quality_occurrences+EXCLUDED.quality_occurrences,
                    last_seen_at=NOW()
            """, observation, keys, terms, source), timeout=1)
    except Exception as exc:
        # Do not leak transcripts/credentials into logs or interrupt live rooms.
        log.warning("dataset_gap_write_failed: %s", type(exc).__name__)


async def gap_retention_loop(pool: asyncpg.Pool) -> None:
    while True:
        await asyncio.sleep(86400)
        try:
            # Only expire request deduplication keys. Vocabulary counters remain.
            await asyncio.wait_for(pool.execute("DELETE FROM dataset_missing_observations WHERE observed_at < NOW()-INTERVAL '90 days'"), timeout=3)
        except Exception:
            log.warning("dataset_gap_retention_failed")


@router.get("")
async def list_missing_terms(
    page: int = Query(1, ge=1, le=100000),
    page_size: int = Query(25, ge=1, le=100),
    search: str = Query("", max_length=96),
    pool: asyncpg.Pool = Depends(get_pool),
    _: CurrentUser = Depends(admin_user),
) -> dict:
    # Compare against the current synchronized catalog, not the agent's TTL cache.
    catalog = await pool.fetch("SELECT word FROM pose_words")
    available = [term_key(row["word"]) for row in catalog]
    rows = await pool.fetch("""
        SELECT term,occurrences,live_occurrences,quality_occurrences,first_seen_at,last_seen_at,
               COUNT(*) OVER() AS total
        FROM dataset_missing_terms
        WHERE NOT (term_key=ANY($1::TEXT[])) AND term_key LIKE '%' || $2 || '%'
        ORDER BY occurrences DESC, last_seen_at DESC, term_key
        LIMIT $3 OFFSET $4
    """, available, term_key(search).replace("_", "\\_"), page_size, (page-1)*page_size)
    return {"items": [{k:v for k,v in dict(row).items() if k != "total"} for row in rows],
            "page": page, "page_size": page_size, "has_next": bool(rows and rows[0]["total"] > page*page_size)}
