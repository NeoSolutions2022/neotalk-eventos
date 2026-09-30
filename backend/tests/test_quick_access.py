import os
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import asyncpg
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import ATTEMPTS, COOKIE_NAME, CurrentUser, current_user, normalize_phone
from app.database import get_pool
from app.main import app


def guest_record():
    return dict(id=uuid4(), name="Pessoa Teste", email=None, whatsapp_phone="+5585999991234",
                role="user", onboarding_version=0, onboarding_step=0,
                onboarding_status="pending", password_set=False)


class QuickAccessTests(unittest.TestCase):
    def setUp(self):
        ATTEMPTS.clear()
        self.mode = patch.dict(os.environ, {"PUBLIC_ACCESS_MODE": "quick"})
        self.mode.start()
        self.pool = AsyncMock()
        self.pool.fetchrow.side_effect = lambda *args: guest_record()
        app.dependency_overrides[get_pool] = lambda: self.pool
        # No lifespan here: API behavior tested against a mocked PostgreSQL pool.
        self.client = TestClient(app)
        self.data = {"name": "Pessoa Teste", "whatsapp_phone": "(85) 99999-1234"}

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.mode.stop()

    def test_config_and_new_guest_session(self):
        config = self.client.get("/api/v1/auth/config")
        self.assertEqual(config.json()["public_access_mode"], "quick")
        self.assertEqual(config.headers["cache-control"], "no-store")
        result = self.client.post("/api/v1/auth/quick-access", json=self.data)
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json()["role"], "user")
        self.assertFalse(result.json()["password_set"])
        self.assertIsNone(result.json()["email"])
        self.assertTrue(result.json()["csrf_token"])
        self.assertIn("HttpOnly", result.headers["set-cookie"])
        self.assertIn("SameSite=lax", result.headers["set-cookie"])
        query, name, phone, source, password = self.pool.fetchrow.call_args.args
        self.assertIn("FALSE,'user'", query)
        self.assertEqual(phone, "+5585999991234")
        self.assertEqual(source, "platform")
        self.assertNotEqual(password, self.data["whatsapp_phone"])

    def test_unverified_phone_never_recovers_another_identity(self):
        first = self.client.post("/api/v1/auth/quick-access", json=self.data).json()
        self.client.cookies.clear()
        second = self.client.post("/api/v1/auth/quick-access", json=self.data).json()
        self.assertNotEqual(first["id"], second["id"])
        for call in self.pool.fetchrow.call_args_list:
            self.assertIn("INSERT INTO users", call.args[0])

    def test_existing_session_preserved(self):
        record = {**guest_record(), "email": "admin@example.com", "role": "admin",
                  "password_set": True, "status": "active", "csrf_token": "existing-csrf"}
        self.pool.fetchrow.side_effect = None
        self.pool.fetchrow.return_value = record
        self.client.cookies.set(COOKIE_NAME, "existing-session")
        result = self.client.post("/api/v1/auth/quick-access", json=self.data)
        self.assertEqual(result.json()["id"], str(record["id"]))
        self.assertNotIn("set-cookie", result.headers)
        self.pool.execute.assert_not_awaited()

    def test_legacy_form_accepts_name_without_phone_only_in_quick_mode(self):
        result = self.client.post("/api/v1/auth/quick-access", json={"name": "Form Lead", "source": "acesso"})
        self.assertEqual(result.status_code, 201)
        self.assertIsNone(self.pool.fetchrow.call_args.args[2])
        self.client.cookies.clear()
        with patch.dict(os.environ, {"PUBLIC_ACCESS_MODE": "password"}):
            result = self.client.post("/api/v1/auth/quick-access", json={"name": "Form Lead", "source": "acesso"})
            self.assertEqual(result.status_code, 403)

    def test_default_and_unknown_mode_disable_quick_endpoint(self):
        for mode in ("password", "typo"):
            with patch.dict(os.environ, {"PUBLIC_ACCESS_MODE": mode}):
                self.assertEqual(self.client.get("/api/v1/auth/config").json()["public_access_mode"], "password")
                self.assertEqual(self.client.post("/api/v1/auth/quick-access", json=self.data).status_code, 403)
        self.pool.fetchrow.assert_not_awaited()

    def test_invalid_input_and_origin_rejected(self):
        for payload in ({"name": "  ", "whatsapp_phone": "85999991234"},
                        {"name": "Pessoa"}, {"name": "Pessoa", "whatsapp_phone": "00000000000"}):
            self.assertEqual(self.client.post("/api/v1/auth/quick-access", json=payload).status_code, 422)
        result = self.client.post("/api/v1/auth/quick-access", json=self.data, headers={"Origin": "https://evil.example"})
        self.assertEqual(result.status_code, 403)
        self.pool.fetchrow.assert_not_awaited()

    def test_rate_limit(self):
        with patch("app.main.hash_password", return_value="test-only-hash"):
            for _ in range(12):
                self.client.cookies.clear()
                self.assertEqual(self.client.post("/api/v1/auth/quick-access", json=self.data).status_code, 201)
            self.client.cookies.clear()
            self.assertEqual(self.client.post("/api/v1/auth/quick-access", json=self.data).status_code, 429)

    def test_guest_cannot_access_admin_endpoints(self):
        record = {**guest_record(), "status": "active", "csrf_token": "valid"}
        self.pool.fetchrow.side_effect = None
        self.pool.fetchrow.return_value = record
        self.client.cookies.set(COOKIE_NAME, "guest-session")
        self.assertEqual(self.client.get("/api/v1/admin/integrations").status_code, 403)

    def test_guest_password_setup_requires_csrf_and_email(self):
        guest = CurrentUser(**{**guest_record(), "csrf_token": "token"})
        app.dependency_overrides[current_user] = lambda: guest
        self.assertEqual(self.client.post("/api/v1/auth/password", json={"password": "long-test-password"}).status_code, 403)
        headers = {"X-CSRF-Token": "token"}
        self.assertEqual(self.client.post("/api/v1/auth/password", json={"password": "long-test-password"}, headers=headers).status_code, 422)
        result = self.client.post("/api/v1/auth/password", json={"password": "long-test-password", "email": " Guest@Example.com "}, headers=headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.pool.execute.call_args.args[3], "guest@example.com")
        self.pool.execute.side_effect = asyncpg.UniqueViolationError("duplicate email")
        self.assertEqual(self.client.post("/api/v1/auth/password", json={"password": "long-test-password", "email": "admin@example.com"}, headers=headers).status_code, 409)

    def test_lead_ticket_flow_is_still_available_in_password_mode(self):
        self.pool.fetchrow.side_effect = [{"user_id": uuid4()}, {**guest_record(), "email": "lead@example.com"}]
        with patch.dict(os.environ, {"PUBLIC_ACCESS_MODE": "password"}):
            result = self.client.post("/api/v1/auth/lead-access/consume", json={"code": "x" * 48})
        self.assertEqual(result.status_code, 200)
        self.assertIn("consumed_at IS NULL", self.pool.fetchrow.call_args_list[0].args[0])
        self.assertEqual(result.json()["email"], "lead@example.com")


class PhoneTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize_phone("(85) 99999-1234"), "+5585999991234")
        self.assertEqual(normalize_phone("+55 (85) 99999-1234"), "+5585999991234")
        self.assertEqual(normalize_phone("+1 415 555 1234"), "+14155551234")

    def test_rejects_non_phone(self):
        for value in ("invalid text", "00000000000", "1234", "1234567890123456"):
            with self.assertRaises(HTTPException):
                normalize_phone(value)
