"""Integration checks on the disposable localhost PostgreSQL harness only."""
import asyncio
import os
import secrets
import unittest

from fastapi.testclient import TestClient

from app.auth import COOKIE_NAME, token_hash
from app.dataset_gaps import SCHEMA, record_missing_terms
from app.main import app
from test_analytics_postgres import URL, sql
import asyncpg


@unittest.skipUnless(os.getenv("ANALYTICS_TEST_LOCAL_ONLY") == "1" and "127.0.0.1" in URL, "requires disposable localhost DB")
class DatasetGapsPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()
        cls.admin, cls.user = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        for role, token in [("admin", cls.admin), ("user", cls.user)]:
            asyncio.run(sql("WITH u AS (INSERT INTO users(name,password_hash,role) VALUES('Gap QA','invalid',$1) RETURNING id) INSERT INTO user_sessions(user_id,token_hash,csrf_token,expires_at) SELECT id,$2,'qa',now()+interval '1 hour' FROM u RETURNING id", role, token_hash(token)))

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def setUp(self):
        asyncio.run(sql("TRUNCATE dataset_missing_terms,dataset_missing_observations,pose_words"))
        self.client.cookies.clear()

    def record(self, terms, observation, source="live"):
        async def run():
            pool = await asyncpg.create_pool(URL, min_size=1, max_size=2)
            try:
                await record_missing_terms(pool, terms, observation, source)
            finally:
                await pool.close()
        asyncio.run(run())

    def report(self, **params):
        self.client.cookies.set(COOKIE_NAME, self.admin)
        response = self.client.get("/api/v1/admin/dataset-gaps", params=params)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_actual_upsert_deduplicates_observations_and_counts_origins(self):
        self.record(["ACOMPANHAR"], "same-batch")
        self.record(["ACOMPANHAR"], "same-batch")
        self.record(["ACOMPANHAR"], "other-batch", "quality")
        row = self.report()["items"][0]
        self.assertEqual(row["occurrences"], 2)
        self.assertEqual(row["live_occurrences"], 1)
        self.assertEqual(row["quality_occurrences"], 1)

    def test_new_dataset_word_hides_previously_missing_term_without_erasing_counts(self):
        self.record(["DÚVIDA"], "r1")
        asyncio.run(sql("INSERT INTO pose_words(word) VALUES('DUVIDA')"))
        self.assertEqual(self.report()["items"], [])
        self.assertEqual(asyncio.run(sql("SELECT occurrences FROM dataset_missing_terms"))[0]["occurrences"], 1)

    def test_search_pagination_and_sort_by_frequency(self):
        self.record(["ACOMPANHAR", "ACONTECER"], "r1")
        self.record(["ACOMPANHAR"], "r2")
        first = self.report(page_size=1)
        self.assertTrue(first["has_next"])
        self.assertEqual(first["items"][0]["term"], "ACOMPANHAR")
        self.assertEqual(self.report(page=2, page_size=1)["items"][0]["term"], "ACONTECER")
        self.assertEqual(len(self.report(search="acom")["items"]), 1)

    def test_admin_only_and_bounded_page_size(self):
        self.assertEqual(self.client.get("/api/v1/admin/dataset-gaps").status_code, 401)
        self.client.cookies.set(COOKIE_NAME, self.user)
        self.assertEqual(self.client.get("/api/v1/admin/dataset-gaps").status_code, 403)
        self.client.cookies.set(COOKIE_NAME, self.admin)
        self.assertEqual(self.client.get("/api/v1/admin/dataset-gaps?page_size=1000").status_code, 422)

    def test_migration_is_idempotent(self):
        async def run():
            connection = await asyncpg.connect(URL)
            try:
                await connection.execute(SCHEMA)
                await connection.execute(SCHEMA)
            finally:
                await connection.close()
        asyncio.run(run())

    def test_concurrent_duplicate_delivery_increments_only_once(self):
        async def run():
            pool = await asyncpg.create_pool(URL, min_size=1, max_size=4)
            try:
                await asyncio.gather(*(record_missing_terms(pool, ["ACOMPANHAR"], "same-request", "live") for _ in range(12)))
            finally:
                await pool.close()
        asyncio.run(run())
        self.assertEqual(self.report()["items"][0]["occurrences"], 1)
