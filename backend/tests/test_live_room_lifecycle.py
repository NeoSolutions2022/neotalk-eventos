"""Endpoint/SQL contract regression tests; PostgreSQL is mocked, not an integration DB."""
import unittest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from fastapi import HTTPException
from app.auth import CurrentUser
from app.main import start_room, finish_room, create_batch, update_batch, heartbeat_room
from app.schemas import RoomFinish, BatchCreate, BatchUpdate


class LiveRoomLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.room = uuid4()
        self.user = CurrentUser(id=uuid4(), name="QA", email=None, role="user", csrf_token="qa",
                                onboarding_version=0, onboarding_step=0, onboarding_status="pending", password_set=False)
        self.pool = AsyncMock()

    async def test_start_never_reopens_finished_rooms_and_checks_owner(self):
        self.pool.fetchrow.return_value = None
        with self.assertRaises(HTTPException) as error:
            await start_room(self.room, self.pool, self.user)
        self.assertEqual(error.exception.status_code, 404)
        query, room, owner, role = self.pool.fetchrow.call_args.args
        self.assertIn("status IN ('ready', 'live')", query)
        self.assertEqual(owner, self.user.id)

    async def test_finish_preserves_existing_duration_and_end_time(self):
        self.pool.fetchrow.return_value = {"id": self.room, "duration_seconds": 1800}
        await finish_room(self.room, RoomFinish(duration_seconds=0), self.pool, self.user)
        query = self.pool.fetchrow.call_args.args[0]
        self.assertIn("GREATEST(duration_seconds, $2)", query)
        self.assertIn("COALESCE(ended_at, NOW())", query)
        self.assertIn("user_id = $3", query)
        self.assertIn("closed_batches AS", query)
        self.assertIn("status IN ('queued', 'translating')", query)
        self.assertIn("room_id IN (SELECT id FROM finished_room)", query)

    async def test_late_status_patch_returns_terminal_state_without_regression(self):
        self.pool.fetchrow.side_effect = [None, {"id": self.room, "status": "done"}]
        result = await update_batch(self.room, BatchUpdate(status="translating"), self.pool, self.user)
        self.assertEqual(result["status"], "done")
        query = self.pool.fetchrow.call_args_list[0].args[0]
        self.assertIn("status NOT IN ('done', 'error')", query)
        self.assertIn("COALESCE(completed_at, NOW())", query)
        self.assertIn("rooms.user_id=$2", self.pool.fetchrow.call_args_list[1].args[0])

    async def test_unknown_or_other_users_batch_is_still_404(self):
        self.pool.fetchrow.return_value = None
        with self.assertRaises(HTTPException) as error:
            await update_batch(self.room, BatchUpdate(status="done"), self.pool, self.user)
        self.assertEqual(error.exception.status_code, 404)

    async def test_closed_room_cannot_accept_a_new_batch(self):
        connection = AsyncMock()
        connection.fetchval.return_value = None
        connection.transaction = MagicMock()
        connection.transaction.return_value.__aenter__ = AsyncMock()
        connection.transaction.return_value.__aexit__ = AsyncMock(return_value=False)
        self.pool.acquire = MagicMock()
        self.pool.acquire.return_value.__aenter__ = AsyncMock(return_value=connection)
        self.pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
        with self.assertRaises(HTTPException) as error:
            await create_batch(self.room, BatchCreate(text="teste"), self.pool, self.user)
        self.assertEqual(error.exception.status_code, 404)
        self.assertIn("status='live'", connection.fetchval.call_args.args[0])
        connection.fetchrow.assert_not_awaited()

    async def test_closed_room_heartbeat_is_404_not_500(self):
        self.pool.execute.return_value = "UPDATE 0"
        with self.assertRaises(HTTPException) as error:
            await heartbeat_room(self.room, self.pool, self.user)
        self.assertEqual(error.exception.status_code, 404)

    async def test_live_room_heartbeat_is_204(self):
        self.pool.execute.return_value = "UPDATE 1"
        response = await heartbeat_room(self.room, self.pool, self.user)
        self.assertEqual(response.status_code, 204)
