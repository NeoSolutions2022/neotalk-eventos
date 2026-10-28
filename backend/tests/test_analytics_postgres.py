"""Real PostgreSQL tests. Only run against the isolated cluster created by the harness."""

import asyncio
import json
import os
import secrets
import time
import unittest
from uuid import uuid4

import asyncpg
from fastapi.testclient import TestClient
from app.auth import COOKIE_NAME, token_hash
from app.main import app

URL = os.getenv("ANALYTICS_TEST_DATABASE_URL", "")


def batch(name="form_step_view", step="perfil_de_uso", props=None):
    return dict(
        schema=1,
        release="access-analytics-v1",
        visitor=str(uuid4()),
        session=str(uuid4()),
        consent=dict.fromkeys(
            ("funnel", "engagement", "heatmap", "errors", "attribution"), True
        ),
        device="mobile",
        language="pt",
        campaign={},
        events=[
            dict(
                id=str(uuid4()),
                at=int(time.time() * 1000),
                name=name,
                step=step,
                device="mobile",
                props=props or {},
            )
        ],
    )


async def sql(query, *args):
    c = await asyncpg.connect(URL)
    try:
        if query.lstrip().startswith("CREATE TABLE"):
            await c.execute(query)
            return []
        return await c.fetch(query, *args)
    finally:
        await c.close()


@unittest.skipUnless(
    os.getenv("ANALYTICS_TEST_LOCAL_ONLY") == "1" and "127.0.0.1" in URL,
    "requires isolated local PostgreSQL harness",
)
class AnalyticsPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()
        cls.origin = {"Origin": "https://neotalk.app"}
        cls.admin = secrets.token_urlsafe(48)
        cls.regular = secrets.token_urlsafe(48)
        cls.csrf = secrets.token_urlsafe(32)
        for role, token in [("admin", cls.admin), ("user", cls.regular)]:
            asyncio.run(
                sql(
                    "WITH u AS (INSERT INTO users(name,password_hash,role) VALUES('QA synthetic','not-a-login-password',$1) RETURNING id) INSERT INTO user_sessions(user_id,token_hash,csrf_token,expires_at) SELECT id,$2,$3,now()+interval '1 hour' FROM u RETURNING id",
                    role,
                    token_hash(token),
                    cls.csrf,
                )
            )

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def setUp(self):
        asyncio.run(sql("TRUNCATE analytics_events,analytics_rate_limits"))
        asyncio.run(
            sql(
                "UPDATE analytics_settings SET enabled=TRUE,groups=$1::jsonb",
                json.dumps(
                    dict.fromkeys(
                        ("funnel", "engagement", "heatmap", "errors", "attribution"),
                        True,
                    )
                ),
            )
        )
        self.client.cookies.clear()

    def post(self, data, **kwargs):
        return self.client.post(
            "/api/v1/analytics/events", json=data, headers=self.origin, **kwargs
        )

    def admin_client(self, role="admin"):
        self.client.cookies.set(
            COOKIE_NAME, self.admin if role == "admin" else self.regular
        )

    def report(self):
        self.admin_client()
        r = self.client.get("/api/v1/admin/analytics/report")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_01_migration_idempotent_and_configuration(self):
        from app.analytics import SCHEMA

        asyncio.run(sql(SCHEMA))
        r = self.client.get("/api/v1/analytics/config", headers=self.origin)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.headers["access-control-allow-origin"], "https://neotalk.app"
        )
        self.assertNotIn("rate_secret", r.text)
        self.assertNotIn("access-control-allow-credentials", r.headers)

    def test_02_admin_and_csrf_use_existing_platform_session(self):
        self.assertEqual(
            self.client.get("/api/v1/admin/analytics/report").status_code, 401
        )
        self.admin_client("user")
        self.assertEqual(
            self.client.get("/api/v1/admin/analytics/report").status_code, 403
        )
        self.admin_client()
        settings = {
            "enabled": False,
            "groups": dict.fromkeys(
                ("funnel", "engagement", "heatmap", "errors", "attribution"), True
            ),
        }
        self.assertEqual(
            self.client.put(
                "/api/v1/admin/analytics/settings", json=settings
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.put(
                "/api/v1/admin/analytics/settings",
                json=settings,
                headers={"X-CSRF-Token": self.csrf},
            ).status_code,
            200,
        )
        self.assertEqual(self.post(batch()).json(), {"accepted": 0, "disabled": True})

    def test_03_cors_does_not_open_admin_or_auth(self):
        headers = {
            **self.origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        }
        r = self.client.options("/api/v1/analytics/events", headers=headers)
        self.assertEqual(r.status_code, 204)
        self.assertNotIn("access-control-allow-credentials", r.headers)
        for path in ("/api/v1/admin/analytics/report", "/api/v1/auth/me"):
            r = self.client.options(path, headers=headers)
            self.assertNotEqual(
                r.headers.get("access-control-allow-origin"), "https://neotalk.app"
            )
        r = self.client.post(
            "/api/v1/analytics/events",
            json=batch(),
            headers={"Origin": "https://evil.invalid"},
        )
        self.assertEqual(r.status_code, 403)
        self.admin_client()
        self.assertEqual(
            self.client.get(
                "/api/v1/admin/analytics/report", headers=self.origin
            ).status_code,
            403,
        )

    def test_04_insert_uuid_dedup_and_plain_text_beacon(self):
        b = batch()
        self.assertEqual(self.post(b).json()["accepted"], 1)
        self.assertEqual(self.post(b).json()["accepted"], 0)
        b["events"][0]["id"] = str(uuid4())
        r = self.client.post(
            "/api/v1/analytics/events",
            content=json.dumps(b),
            headers={**self.origin, "Content-Type": "text/plain;charset=UTF-8"},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["accepted"], 1)
        self.assertEqual(self.report()["totals"]["sessions"], 1)

    def test_05_reject_pii_tokens_invalid_types_and_large_batches(self):
        cases = []
        b = batch()
        b["email"] = "private@example.invalid"
        cases.append(b)
        b = batch()
        b["events"][0]["props"] = {"value": "private"}
        cases.append(b)
        b = batch()
        b["events"][0]["props"] = {"url": "?code=secret"}
        cases.append(b)
        b = batch()
        b["events"][0]["name"] = []
        cases.append(b)
        b = batch()
        b["events"][0]["name"] = "account_created"
        cases.append(b)
        b = batch()
        b["events"] *= 21
        cases.append(b)
        b = batch()
        b["consent"]["funnel"] = False
        cases.append(b)
        b = batch()
        b["campaign"] = {"utm_source": "private@example.invalid"}
        cases.append(b)
        b = batch()
        b["events"][0]["at"] = 0
        cases.append(b)
        for b in cases:
            r = self.post(b)
            self.assertEqual(r.status_code, 400, r.text)
            self.assertNotIn("private", r.text)
            self.assertNotIn("secret", r.text)
        r = self.client.post(
            "/api/v1/analytics/events",
            content="x" * 20481,
            headers={**self.origin, "Content-Type": "application/json"},
        )
        self.assertEqual(r.status_code, 413)
        self.assertEqual(
            self.post(batch("heat_click", "contato", {"x": 1, "y": 2})).status_code, 400
        )
        self.assertEqual(
            self.post(batch("heat_click", props={"x": 20, "y": 0})).status_code, 400
        )

    def test_06_report_heatmap_qualification_and_no_id_leaks(self):
        for i in range(3):
            b = batch()
            base = b["events"][0]
            b["campaign"] = {"utm_source": "qa_event"}
            b["events"] = [
                {
                    **base,
                    "id": str(uuid4()),
                    "name": name,
                    "step": step,
                    "props": props,
                    "at": base["at"] + index,
                }
                for index, (name, step, props) in enumerate(
                    [
                        ("form_view", "perfil_de_uso", {}),
                        ("form_step_view", "perfil_de_uso", {}),
                        ("form_step_complete", "perfil_de_uso", {"option": 0}),
                        ("heat_click", "perfil_de_uso", {"x": 3, "y": 4}),
                        ("active_time", "perfil_de_uso", {"active_ms": 10000}),
                        (
                            "form_step_complete",
                            "tipos_de_conteudo",
                            {"options": [0, 2]},
                        ),
                        ("lead_submit_accepted", "contato", {}),
                        ("form_step_complete", "perfil_de_uso", {"option": 1}),
                        ("scroll_depth", "perfil_de_uso", {"depth": 100}),
                    ]
                )
            ]
            self.assertEqual(self.post(b).json()["accepted"], 9)
            if i == 0:
                self.assertEqual(self.report()["heatmap"], [])
        r = self.report()
        self.assertEqual(r["totals"]["sessions"], 3)
        self.assertEqual(r["heatmap"][0]["clicks"], 3)
        self.assertEqual(r["active"][0]["ms"], 30000)
        self.assertEqual(len(r["options"]), 3)
        self.assertEqual(
            [o["option"] for o in r["options"] if o["step"] == "perfil_de_uso"], [1]
        )
        self.assertNotIn(b["visitor"], json.dumps(r))
        self.assertNotIn(b["session"], json.dumps(r))
        self.assertEqual(r["location"], "unknown")
        self.assertEqual(r["abandonment"]["accepted"], 3)

    def test_07_group_kill_switch_and_funnel_denominator(self):
        self.assertEqual(self.post(batch()).status_code, 200)
        b = batch("heat_click", props={"x": 1, "y": 2})
        b["consent"]["funnel"] = False
        self.assertEqual(self.post(b).status_code, 200)
        r = self.report()
        self.assertEqual(r["totals"]["sessions"], 2)
        self.assertEqual(r["totals"]["funnel_sessions"], 1)
        asyncio.run(
            sql(
                "UPDATE analytics_settings SET groups=jsonb_set(groups,'{heatmap}','false')"
            )
        )
        self.assertEqual(
            self.post(batch("heat_click", props={"x": 1, "y": 2})).json()["accepted"], 0
        )

    def test_08_abandonment_resumption_and_retention(self):
        b = batch()
        self.post(b)
        asyncio.run(
            sql("UPDATE analytics_events SET received_at=now()-interval '25 hours'")
        )
        self.assertEqual(self.report()["abandonment"]["consolidated"], 1)
        b["events"][0].update(
            id=str(uuid4()), name="lead_submit_accepted", step="contato"
        )
        self.post(b)
        self.assertEqual(self.report()["abandonment"]["consolidated"], 0)
        asyncio.run(
            sql("UPDATE analytics_events SET received_at=now()-interval '100 days'")
        )
        from app.analytics import purge_events

        async def purge():
            p = await asyncpg.create_pool(URL, min_size=1, max_size=1)
            try:
                await purge_events(p)
            finally:
                await p.close()

        asyncio.run(purge())
        self.assertEqual(self.report()["totals"]["events"], 0)

    def test_09_shared_database_rate_limit(self):
        b = batch()
        for i in range(121):
            response = self.post(b)
            if response.status_code == 429:
                break
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)


if __name__ == "__main__":
    unittest.main(verbosity=2)
