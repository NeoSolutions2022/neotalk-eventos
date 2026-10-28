"""Consent-gated acquisition analytics in the platform's existing PostgreSQL database."""

import asyncio
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from starlette.middleware.base import BaseHTTPMiddleware

from .auth import CurrentUser, admin_csrf, admin_user
from .database import get_pool

GROUPS = ("funnel", "engagement", "heatmap", "errors", "attribution")
STEPS = (
    "perfil_de_uso",
    "tipos_de_conteudo",
    "volume_mensal",
    "prazo_de_interesse",
    "contato",
    "sucesso",
)
EVENTS = {
    "form_view": "funnel",
    "form_start": "funnel",
    "form_step_view": "funnel",
    "form_step_complete": "funnel",
    "form_back": "funnel",
    "form_submit_attempt": "funnel",
    "lead_submit_accepted": "funnel",
    "success_view": "funnel",
    "instagram_cta_click": "funnel",
    "platform_cta_click": "funnel",
    "redirect_initiated": "funnel",
    "form_validation_error": "errors",
    "form_submit_failed": "errors",
    "active_time": "engagement",
    "scroll_depth": "engagement",
    "heat_click": "heatmap",
}
CAMPAIGN = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$", re.I)
SCHEMA = """
CREATE TABLE IF NOT EXISTS analytics_settings (
 id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), enabled BOOLEAN NOT NULL DEFAULT FALSE,
 groups JSONB NOT NULL DEFAULT '{"funnel":true,"engagement":true,"heatmap":true,"errors":true,"attribution":true}',
 rate_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32),'hex'), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO analytics_settings(id) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS analytics_events (
 id UUID PRIMARY KEY, occurred_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 visitor UUID NOT NULL, session UUID NOT NULL, name VARCHAR(40) NOT NULL, step VARCHAR(32) NOT NULL,
 device VARCHAR(8) NOT NULL, language VARCHAR(8) NOT NULL, campaign JSONB NOT NULL DEFAULT '{}', props JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS analytics_events_received ON analytics_events(received_at);
CREATE INDEX IF NOT EXISTS analytics_events_session ON analytics_events(session,occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_step ON analytics_events(name,step,received_at);
CREATE TABLE IF NOT EXISTS analytics_rate_limits (
 key CHAR(64) PRIMARY KEY, bucket BIGINT NOT NULL, count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_rate_window ON analytics_rate_limits(bucket);
"""


def origins() -> set[str]:
    return {
        v.strip().rstrip("/")
        for v in os.getenv(
            "ANALYTICS_FORM_ORIGINS",
            os.getenv("LEAD_FORM_ORIGIN", "https://neotalk.app"),
        ).split(",")
        if v.strip()
    }


class AnalyticsCors(BaseHTTPMiddleware):
    """Only the unauthenticated, bounded analytics routes accept form-origin CORS.

    Do not widen credentialed CORS for auth/admin/rooms to the lead-form origin.
    """

    async def dispatch(self, request: Request, call_next):
        if (
            request.url.path.startswith("/api/v1/admin/analytics/")
            and request.headers.get("origin") in origins()
        ):
            # Even if legacy CORS allows lead-auth handoff, the form cannot read/administer reports.
            return Response(status_code=403)
        if request.url.path not in (
            "/api/v1/analytics/config",
            "/api/v1/analytics/events",
        ):
            return await call_next(request)
        origin = request.headers.get("origin", "")
        if request.method == "OPTIONS":
            if origin not in origins() or request.headers.get(
                "access-control-request-method"
            ) not in ("GET", "POST"):
                return Response(status_code=403)
            response = Response(status_code=204)
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
        else:
            response = await call_next(request)
        if origin in origins():
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            # Public telemetry must never confer credentialed admin access.
            if "access-control-allow-credentials" in response.headers:
                del response.headers["access-control-allow-credentials"]
        response.headers["Cache-Control"] = "no-store"
        return response


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    funnel: bool
    engagement: bool
    heatmap: bool
    errors: bool
    attribution: bool


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: UUID
    at: int
    name: str = Field(max_length=40)
    step: str = Field(max_length=32)
    device: Literal["mobile", "tablet", "desktop"]
    props: dict[str, Any]

    @model_validator(mode="after")
    def validate_event(self):
        if (
            self.id.version != 4
            or self.name not in EVENTS
            or self.step not in STEPS
            or abs(self.at / 1000 - time.time()) > 7 * 86400
        ):
            raise ValueError("invalid event")
        allowed = {
            "heat_click": {"x", "y"},
            "active_time": {"active_ms"},
            "scroll_depth": {"depth"},
            "form_step_complete": {"option", "options"},
            "form_validation_error": {"code"},
            "form_submit_failed": {"code"},
            **{
                n: {"action"}
                for n in (
                    "form_back",
                    "form_submit_attempt",
                    "instagram_cta_click",
                    "platform_cta_click",
                    "redirect_initiated",
                )
            },
        }.get(self.name, set())
        if set(self.props) - allowed:
            raise ValueError("unexpected event property")
        for k, v in self.props.items():
            if k == "action":
                if not isinstance(v, str) or not re.fullmatch(
                    r"(option_[0-7]|continue|back|submit|platform|instagram)", v
                ):
                    raise ValueError("invalid action")
            elif k == "code":
                if v not in (
                    "nome",
                    "email",
                    "whatsapp",
                    "network",
                    "save_failed",
                    "unknown",
                ):
                    raise ValueError("invalid code")
            elif k == "options":
                if (
                    self.step != "tipos_de_conteudo"
                    or not isinstance(v, list)
                    or len(v) > 8
                    or any(type(n) is not int or not 0 <= n <= 7 for n in v)
                ):
                    raise ValueError("invalid choices")
            elif type(v) is not int or not 0 <= v <= (
                {"active_ms": 60000, "depth": 100, "option": 7}.get(k, 19)
            ):
                raise ValueError("invalid measure")
        if self.name == "heat_click" and (
            self.step == "contato" or not {"x", "y"} <= set(self.props)
        ):
            raise ValueError("private heatmap")
        if self.name == "active_time" and "active_ms" not in self.props:
            raise ValueError("missing time")
        if self.name == "scroll_depth" and "depth" not in self.props:
            raise ValueError("missing depth")
        if (
            "option" in self.props
            and self.props["option"] >= (6, 8, 7, 4, 0, 0)[STEPS.index(self.step)]
        ):
            raise ValueError("invalid choice")
        return self


class Batch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1] = Field(alias="schema")
    release: Literal["access-analytics-v1"]
    visitor: UUID
    session: UUID
    consent: Preferences
    device: Literal["mobile", "tablet", "desktop"]
    language: Literal["pt", "other"]
    campaign: dict[str, str]
    events: list[Event] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_batch(self):
        if self.visitor.version != 4 or self.session.version != 4:
            raise ValueError("invalid identity")
        if set(self.campaign) - {
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
        }:
            raise ValueError("unexpected campaign")
        if any(
            not CAMPAIGN.fullmatch(v) or re.search(r"\d{8}", v)
            for v in self.campaign.values()
        ):
            raise ValueError("invalid campaign")
        if any(not getattr(self.consent, EVENTS[e.name]) for e in self.events):
            raise ValueError("missing consent")
        return self


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool
    groups: Preferences


def decode(value):
    return json.loads(value) if isinstance(value, str) else value


async def configuration(connection) -> dict:
    row = await connection.fetchrow(
        "SELECT enabled,groups,rate_secret FROM analytics_settings WHERE id=TRUE",
        timeout=2,
    )
    return {
        "enabled": row["enabled"],
        "groups": decode(row["groups"]),
        "rate_secret": row["rate_secret"],
    }


async def rate_limit(connection, request: Request, secret: str, session: UUID):
    window = int(time.time() / 60)
    # The frontend reverse proxy shares an IP: don't accidentally throttle all visitors as one.
    # Per-journey and global ceilings; no raw or hashed visitor IP is required.
    for scope, limit in ((f"session:{session}", 120), ("global", 1200)):
        key = hmac.new(
            secret.encode(), f"{scope}:{window}".encode(), hashlib.sha256
        ).hexdigest()
        count = await connection.fetchval(
            """INSERT INTO analytics_rate_limits(key,bucket,count) VALUES($1,$2,1)
            ON CONFLICT(key) DO UPDATE SET count=analytics_rate_limits.count+1 RETURNING count""",
            key,
            window,
            timeout=2,
        )
        if count > limit:
            raise HTTPException(
                429, "Analytics rate limit", headers={"Retry-After": "60"}
            )
    await connection.execute(
        "DELETE FROM analytics_rate_limits WHERE bucket<$1", window - 2, timeout=2
    )


async def purge_events(pool):
    # Bounded chunks; no unbounded deletion/lock competing with live translation.
    async with pool.acquire(timeout=1) as connection:
        await connection.execute(
            """DELETE FROM analytics_events WHERE id IN
            (SELECT id FROM analytics_events WHERE received_at<now()-interval '90 days' LIMIT 10000)""",
            timeout=2,
        )


async def retention_loop(pool):
    while True:
        await asyncio.sleep(3600)
        try:
            await purge_events(pool)
        except Exception:
            continue  # Next hourly pass retries; cannot take down live rooms.


router = APIRouter()


@router.get("/api/v1/analytics/config")
async def public_config(request: Request, response: Response, pool=Depends(get_pool)):
    response.headers["Cache-Control"] = "no-store"
    if request.headers.get("origin") not in origins():
        raise HTTPException(403, "Analytics origin not allowed")
    try:
        async with pool.acquire(timeout=1) as c:
            cfg = await configuration(c)
    except Exception:
        return {
            "enabled": False,
            "groups": dict.fromkeys(GROUPS, False),
            "release": "access-analytics-v1",
        }
    return {
        "enabled": cfg["enabled"],
        "groups": cfg["groups"],
        "release": "access-analytics-v1",
    }


@router.post("/api/v1/analytics/events")
async def collect(request: Request, pool=Depends(get_pool)):
    if request.headers.get("origin") not in origins():
        raise HTTPException(403, "Analytics origin not allowed")
    slots = request.app.state.analytics_ingest_slots
    try:
        await asyncio.wait_for(slots.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Analytics busy") from None
    try:
        return await asyncio.wait_for(_ingest(request, pool), timeout=4)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Analytics temporarily unavailable") from None
    finally:
        slots.release()


async def _ingest(request: Request, pool):
    if request.headers.get("origin") not in origins():
        raise HTTPException(403, "Analytics origin not allowed")
    if request.headers.get("content-type", "").split(";")[0].lower() not in (
        "application/json",
        "text/plain",
    ):
        raise HTTPException(415, "Unsupported analytics content type")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 20480:
            raise HTTPException(413, "Analytics batch too large")
    try:
        payload = Batch.model_validate_json(raw)
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(400, "Invalid analytics payload") from None
    try:
        async with pool.acquire(timeout=1) as c:
            cfg = await configuration(c)
            if not cfg["enabled"]:
                return {"accepted": 0, "disabled": True}
            await rate_limit(c, request, cfg["rate_secret"], payload.session)
            campaign = (
                payload.campaign
                if payload.consent.attribution and cfg["groups"]["attribution"]
                else {}
            )
            events = [
                e for e in payload.events if cfg["groups"].get(EVENTS[e.name], False)
            ]
            async with c.transaction():
                accepted = 0
                for e in events:
                    result = await c.execute(
                        """INSERT INTO analytics_events(id,occurred_at,visitor,session,name,step,device,language,campaign,props)
                        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(id) DO NOTHING""",
                        e.id,
                        datetime.fromtimestamp(e.at / 1000, timezone.utc),
                        payload.visitor,
                        payload.session,
                        e.name,
                        e.step,
                        e.device,
                        payload.language,
                        json.dumps(campaign),
                        json.dumps(e.props),
                        timeout=2,
                    )
                    accepted += int(result == "INSERT 0 1")
            return {"accepted": accepted}
    except HTTPException:
        raise
    except (asyncio.TimeoutError, asyncpg.PostgresError):
        raise HTTPException(503, "Analytics temporarily unavailable") from None


@router.get("/api/v1/admin/analytics/settings")
async def settings(user: CurrentUser = Depends(admin_user), pool=Depends(get_pool)):
    async with pool.acquire(timeout=1) as c:
        cfg = await configuration(c)
    return {"enabled": cfg["enabled"], "groups": cfg["groups"]}


@router.put("/api/v1/admin/analytics/settings")
async def update_settings(
    payload: Settings, user: CurrentUser = Depends(admin_csrf), pool=Depends(get_pool)
):
    async with pool.acquire(timeout=1) as c:
        await c.execute(
            "UPDATE analytics_settings SET enabled=$1,groups=$2::jsonb,updated_at=now() WHERE id=TRUE",
            payload.enabled,
            json.dumps(payload.groups.model_dump()),
            timeout=2,
        )
    return {"saved": True}


REPORT_SQL = """
WITH raw AS MATERIALIZED (SELECT * FROM analytics_events WHERE received_at>=now()-make_interval(days=>$1)),
totals AS (SELECT count(*) events,count(DISTINCT visitor) visitors,count(DISTINCT session) sessions,
 count(DISTINCT session) FILTER(WHERE name IN ('form_view','form_start','form_step_view','form_step_complete','form_submit_attempt','lead_submit_accepted','success_view')) funnel_sessions FROM raw),
names AS (SELECT name,count(*) attempts,count(DISTINCT session) sessions FROM raw GROUP BY name),
views AS (SELECT step,count(DISTINCT session) sessions FROM raw WHERE name='form_step_view' GROUP BY step),
completed AS (SELECT step,count(DISTINCT session) sessions FROM raw WHERE name='form_step_complete' GROUP BY step),
active AS (SELECT step,sum((props->>'active_ms')::bigint) ms,count(DISTINCT session) sessions FROM raw WHERE name='active_time' GROUP BY step),
journeys AS (SELECT session,max(received_at) last_seen,bool_or(name='lead_submit_accepted') accepted FROM raw
 WHERE name IN ('form_view','form_step_view','form_step_complete','form_submit_attempt','lead_submit_accepted','success_view','redirect_initiated','platform_cta_click') GROUP BY session),
states AS (SELECT *,CASE WHEN accepted THEN 'accepted' WHEN last_seen>now()-interval '30 minutes' THEN 'in_progress' WHEN last_seen>now()-interval '24 hours' THEN 'provisional' ELSE 'consolidated' END state FROM journeys),
latest_step AS (SELECT DISTINCT ON(session) session,step FROM raw WHERE name='form_step_view' ORDER BY session,occurred_at DESC,received_at DESC,id DESC),
last_steps AS (SELECT coalesce(l.step,'unknown') step,count(*) count FROM states s LEFT JOIN latest_step l USING(session) WHERE state IN ('provisional','consolidated') GROUP BY l.step),
heat AS (SELECT step,device,(props->>'x')::int x,(props->>'y')::int y,count(*) clicks,count(DISTINCT session) sessions FROM raw WHERE name='heat_click' GROUP BY step,device,x,y HAVING count(DISTINCT session)>=3),
segments AS (SELECT device,language,count(DISTINCT session) sessions FROM raw GROUP BY device,language HAVING count(DISTINCT session)>=3),
campaigns AS (SELECT campaign,count(DISTINCT session) sessions FROM raw WHERE campaign!='{}'::jsonb GROUP BY campaign HAVING count(DISTINCT session)>=3),
errors AS (SELECT name,props->>'code' code,count(*) attempts FROM raw WHERE name IN ('form_validation_error','form_submit_failed') GROUP BY name,code),
choices AS (SELECT DISTINCT ON(session,step) * FROM raw WHERE name='form_step_complete' ORDER BY session,step,occurred_at DESC,received_at DESC,id DESC),
options AS (SELECT step,(props->>'option')::int option,count(DISTINCT session) sessions FROM choices WHERE props ? 'option' GROUP BY step,option HAVING count(DISTINCT session)>=3
 UNION ALL SELECT step,o.value::int option,count(DISTINCT session) sessions FROM choices CROSS JOIN LATERAL jsonb_array_elements_text(props->'options') o GROUP BY step,o.value HAVING count(DISTINCT session)>=3),
scroll AS (SELECT step,(props->>'depth')::int depth,count(DISTINCT session) sessions FROM raw WHERE name='scroll_depth' GROUP BY step,depth HAVING count(DISTINCT session)>=3),
daily AS (SELECT to_char(received_at AT TIME ZONE 'America/Fortaleza','YYYY-MM-DD') AS "day",count(DISTINCT session) sessions FROM raw GROUP BY "day" ORDER BY "day")
SELECT jsonb_build_object(
 'totals',(SELECT row_to_json(t) FROM totals t),'events',(SELECT coalesce(jsonb_agg(n),'[]') FROM names n),
 'views',(SELECT coalesce(jsonb_agg(v),'[]') FROM views v),'completed',(SELECT coalesce(jsonb_agg(v),'[]') FROM completed v),
 'active',(SELECT coalesce(jsonb_agg(v),'[]') FROM active v),'heatmap',(SELECT coalesce(jsonb_agg(v),'[]') FROM heat v),
 'segments',(SELECT coalesce(jsonb_agg(v),'[]') FROM segments v),'campaigns',(SELECT coalesce(jsonb_agg(v),'[]') FROM campaigns v),
 'errors',(SELECT coalesce(jsonb_agg(v),'[]') FROM errors v),'options',(SELECT coalesce(jsonb_agg(v),'[]') FROM options v),
 'scroll',(SELECT coalesce(jsonb_agg(v),'[]') FROM scroll v),'daily',(SELECT coalesce(jsonb_agg(v),'[]') FROM daily v),
 'last_steps',(SELECT coalesce(jsonb_object_agg(step,count),'{}') FROM last_steps),
 'abandonment',jsonb_build_object('accepted',(SELECT count(*) FROM states WHERE state='accepted'),
 'in_progress',(SELECT count(*) FROM states WHERE state='in_progress'),'provisional',(SELECT count(*) FROM states WHERE state='provisional'),
 'consolidated',(SELECT count(*) FROM states WHERE state='consolidated')))
"""


@router.get("/api/v1/admin/analytics/report")
async def report(
    response: Response,
    days: int = 7,
    user: CurrentUser = Depends(admin_user),
    pool=Depends(get_pool),
):
    if days not in (1, 7, 30, 90):
        raise HTTPException(400, "Invalid analytics period")
    response.headers["Cache-Control"] = "no-store"
    try:
        async with pool.acquire(timeout=1) as c:
            data = decode(await c.fetchval(REPORT_SQL, days, timeout=3))
    except (asyncio.TimeoutError, asyncpg.PostgresError):
        raise HTTPException(503, "Analytics report temporarily unavailable") from None
    return {
        **data,
        "days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "minimum_group": 3,
        "location": "unknown",
        "scope": "consented_browser_observations_only",
    }
