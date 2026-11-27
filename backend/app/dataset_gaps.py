"""Aggregate vocabulary candidates, never whole transcripts or audio."""
import asyncio
import csv
import io
import logging
import re
import unicodedata
from collections import Counter
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .auth import CurrentUser, admin_user
from .database import get_pool

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin/dataset-gaps", tags=["dataset"])
EXPORT_LIMIT = 25_000

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
CREATE TABLE IF NOT EXISTS dataset_live_coverage (
    observation_id UUID PRIMARY KEY,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked INTEGER NOT NULL CHECK (checked > 0),
    covered INTEGER NOT NULL CHECK (covered BETWEEN 0 AND checked)
);
CREATE INDEX IF NOT EXISTS idx_dataset_live_coverage_date ON dataset_live_coverage(observed_at);
CREATE TABLE IF NOT EXISTS dataset_live_missing (
    observation_id UUID NOT NULL REFERENCES dataset_live_coverage(observation_id) ON DELETE CASCADE,
    term_key VARCHAR(96) NOT NULL,
    term VARCHAR(96) NOT NULL,
    occurrences INTEGER NOT NULL CHECK (occurrences > 0),
    PRIMARY KEY (observation_id, term_key)
);
"""

STOP_WORDS = frozenset("A AS O OS UM UMA UNS UMAS DE DO DA DOS DAS E EM NO NA NOS NAS PARA POR COM QUE SE EU TU ELE ELA NÓS VÓS ELES ELAS ME TE SEU SUA SER ESTAR TER IR AO AOS OU MAS NÃO SIM".split())


def term_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.upper())
    return "_".join("".join(c for c in value if not unicodedata.combining(c)).replace("-", " ").replace("_", " ").split())


# Don't extract alphabetic fragments out of URLs, e-mail addresses or identifiers.
PRIVATE_OR_MIXED = re.compile(r"(?i)(?:\S*[@/\\\d]\S*|\S*\.[a-z]{2,}(?=\W|$)\S*)")
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def measure_vocabulary(text: str, catalog: list[str]) -> tuple[int, int, dict[str, tuple[str, int]]]:
    """Count spoken word occurrences, longest matching catalog expression first."""
    entries = {tuple(term_key(word).split("_")) for word in catalog if term_key(word)}
    longest = max(map(len, entries), default=1)
    checked = covered = 0
    counts: Counter[str] = Counter()
    labels: dict[str, str] = {}
    # Redaction creates a boundary so a match can't bridge an excluded identifier.
    normalized = unicodedata.normalize("NFC", text)
    for chunk in PRIVATE_OR_MIXED.split(normalized):
        for clause in re.split(r"[.!?;,:\n]+", chunk):
            tokens = [word.upper() for word in WORD.findall(clause) if len(word.upper()) <= 96]
            keys = [term_key(word) for word in tokens]
            checked += len(keys)
            i = 0
            while i < len(keys):
                size = next((n for n in range(min(longest, len(keys)-i), 0, -1)
                             if tuple(keys[i:i+n]) in entries), 0)
                if size:
                    covered += size
                    i += size
                    continue
                counts[keys[i]] += 1
                labels.setdefault(keys[i], tokens[i])
                i += 1
    return checked, covered, {key: (labels[key], count) for key, count in counts.items()}


async def record_live_coverage(pool: asyncpg.Pool, text: str, observation: UUID) -> None:
    async def write() -> None:
        rows = await pool.fetch("SELECT word FROM pose_words")
        if not rows:
            return  # An unavailable/empty catalogue is not 0% coverage.
        checked, covered, missing = measure_vocabulary(text, [row["word"] for row in rows])
        if not checked:
            return
        await pool.execute("""
            WITH fresh AS (
                INSERT INTO dataset_live_coverage(observation_id,checked,covered)
                VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING observation_id
            )
            INSERT INTO dataset_live_missing(observation_id,term_key,term,occurrences)
            SELECT observation_id,key,term,occurrences FROM fresh
            CROSS JOIN UNNEST($4::text[],$5::text[],$6::int[]) AS m(key,term,occurrences)
        """, observation, checked, covered, list(missing),
            [item[0] for item in missing.values()], [item[1] for item in missing.values()])

    try:
        await asyncio.wait_for(write(), timeout=2)
    except Exception as exc:
        log.warning("dataset_live_coverage_write_failed: %s", type(exc).__name__)


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
            await asyncio.wait_for(pool.execute("DELETE FROM dataset_live_coverage WHERE observed_at < NOW()-INTERVAL '90 days'"), timeout=3)
        except Exception:
            log.warning("dataset_gap_retention_failed")


async def query_missing_terms(pool, available, search, observed_live, limit, offset):
    pattern = term_key(search).translate(str.maketrans({"\\": "\\\\", "_": "\\_", "%": "\\%"}))
    if observed_live:
        return await pool.fetch("""
            SELECT MIN(m.term) AS term, SUM(m.occurrences)::BIGINT AS occurrences,
                   MAX(c.observed_at) AS last_seen_at, COUNT(*) OVER() AS total
            FROM dataset_live_missing m JOIN dataset_live_coverage c USING(observation_id)
            WHERE c.observed_at >= NOW()-INTERVAL '30 days'
              AND NOT (m.term_key=ANY($1::TEXT[])) AND m.term_key LIKE '%' || $2 || '%'
            GROUP BY m.term_key
            ORDER BY occurrences DESC, last_seen_at DESC, m.term_key
            LIMIT $3 OFFSET $4
        """, available, pattern, limit, offset)
    return await pool.fetch("""
        SELECT term,occurrences,live_occurrences,quality_occurrences,first_seen_at,last_seen_at,
               COUNT(*) OVER() AS total
        FROM dataset_missing_terms
        WHERE NOT (term_key=ANY($1::TEXT[])) AND term_key LIKE '%' || $2 || '%'
        ORDER BY occurrences DESC, last_seen_at DESC, term_key
        LIMIT $3 OFFSET $4
    """, available, pattern, limit, offset)


@router.get("/export.csv")
async def export_missing_terms(
    search: str = Query("", max_length=96),
    observed_live: bool = True,
    pool: asyncpg.Pool = Depends(get_pool),
    _: CurrentUser = Depends(admin_user),
) -> Response:
    catalog = await pool.fetch("SELECT word FROM pose_words")
    rows = await query_missing_terms(pool, [term_key(row["word"]) for row in catalog],
                                    search, observed_live, EXPORT_LIMIT + 1, 0)
    if len(rows) > EXPORT_LIMIT:
        raise HTTPException(422, detail="A lista é muito grande. Use a busca para limitar a exportação.")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    header = ["Palavra", "Ocorrências", "Última ocorrência (UTC)"]
    if not observed_live:
        header += ["Sugestões na tradução", "Sugestões no QA"]
    writer.writerow(header)
    for row in rows:
        term = row["term"].replace("_", " ")
        # Protect spreadsheet programs even if legacy data bypassed ingestion validation.
        if term.startswith(("\t", "\r", "\n")) or term.lstrip().startswith(("=", "+", "-", "@")):
            term = "'" + term
        fields = [term, row["occurrences"], row["last_seen_at"].isoformat()]
        if not observed_live:
            fields += [row["live_occurrences"], row["quality_occurrences"]]
        writer.writerow(fields)
    name = "palavras-ausentes-ao-vivo" if observed_live else "sugestoes-dataset"
    return Response(
        output.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="neotalk-{name}.csv"',
                 "Cache-Control": "no-store"},
    )


@router.get("")
async def list_missing_terms(
    page: int = Query(1, ge=1, le=100000),
    page_size: int = Query(25, ge=1, le=100),
    search: str = Query("", max_length=96),
    observed_live: bool = False,
    pool: asyncpg.Pool = Depends(get_pool),
    _: CurrentUser = Depends(admin_user),
) -> dict:
    # Compare against the current synchronized catalog, not the agent's TTL cache.
    catalog = await pool.fetch("SELECT word FROM pose_words")
    available = [term_key(row["word"]) for row in catalog]
    rows = await query_missing_terms(pool, available, search, observed_live, page_size, (page-1)*page_size)
    result = {"items": [{k:v for k,v in dict(row).items() if k != "total"} for row in rows],
              "page": page, "page_size": page_size, "has_next": bool(rows and rows[0]["total"] > page*page_size)}
    if observed_live:
        summary = await pool.fetchrow("""
            SELECT COUNT(*) AS batches, COALESCE(SUM(checked),0)::BIGINT AS checked,
                   COALESCE(SUM(covered),0)::BIGINT AS covered
            FROM dataset_live_coverage WHERE observed_at >= NOW()-INTERVAL '30 days'
        """)
        result["coverage"] = {**dict(summary), "days": 30}
    return result
