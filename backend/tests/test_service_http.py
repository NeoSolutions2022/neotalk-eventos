"""Real loopback HTTP/1.1, not a provider latency benchmark."""
import asyncio
import json
import time
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

import httpx

from app import service_http, services
from test_services import FakePool, response_payload


class ServiceHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.connections = 0
        self.requests = []
        self.active_requests = 0
        self.peak_requests = 0
        self.handlers = set()
        self.writers = set()
        services.invalidate_agent_context_cache()

        async def handle(reader, writer):
            task = asyncio.current_task()
            self.handlers.add(task)
            self.writers.add(writer)
            self.connections += 1
            try:
                # Explicit synthetic connection-establishment cost, once/TCP.
                await asyncio.sleep(.02)
                while True:
                    raw = await reader.readuntil(b"\r\n\r\n")
                    headers = dict(line.split(":", 1) for line in raw.decode().split("\r\n")[1:] if ":" in line)
                    headers = {k.lower(): v.strip() for k, v in headers.items()}
                    data = await reader.readexactly(int(headers.get("content-length", 0)))
                    self.active_requests += 1
                    self.peak_requests = max(self.peak_requests, self.active_requests)
                    await asyncio.sleep(.005)
                    self.requests.append((headers, json.loads(data) if data else None))
                    body = json.dumps({"id": "loopback", **response_payload('{"glosses":["CASA"]}')}).encode()
                    writer.write(b"HTTP/1.1 200 OK\r\nSet-Cookie: provider_session=must-not-carry\r\nContent-Type: application/json\r\nContent-Length: "
                                 + str(len(body)).encode() + b"\r\n\r\n" + body)
                    await writer.drain()
                    self.active_requests -= 1
            except (asyncio.IncompleteReadError, ConnectionError):
                pass
            finally:
                writer.close()
                await writer.wait_closed()
                self.writers.discard(writer)
                self.handlers.discard(task)

        self.server = await asyncio.start_server(handle, "127.0.0.1", 0)
        self.url = f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        for writer in tuple(self.writers):
            writer.close()
        if self.handlers:
            await asyncio.gather(*tuple(self.handlers), return_exceptions=True)

    async def test_translation_reuses_one_socket_without_reusing_outputs(self):
        pool = FakePool()
        with patch.object(services, "OPENAI_BASE_URL", self.url), patch.object(services, "OPENAI_API_KEY", "local-test"):
            start = time.perf_counter()
            for i in range(12):
                await services.translate_to_glosses(pool, f"frase {i}")
            baseline_ms = (time.perf_counter() - start) * 1000
            self.assertEqual(self.connections, 12)
            self.requests.clear()
            start = time.perf_counter()
            async with service_http.http_lifespan((services.NEOTALK_API_TIMEOUT_SECONDS, 45)):
                for i in range(12):
                    await services.translate_to_glosses(pool, f"outra {i}")
                async with service_http.service_client(services.NEOTALK_API_TIMEOUT_SECONDS) as client:
                    borrowed = client
                self.assertFalse(borrowed.is_closed)
            candidate_ms = (time.perf_counter() - start) * 1000
        self.assertTrue(borrowed.is_closed)
        self.assertIsNone(service_http._clients)
        self.assertEqual(self.connections, 13, "12 new sockets become one reused socket")
        self.assertEqual(len(self.requests), 12, "each phrase still reaches the service")
        self.assertEqual(len({json.dumps(body) for _, body in self.requests}), 12)
        print(f"LOOPBACK 12 translations: fresh={baseline_ms:.1f}ms/12 TCP; pooled={candidate_ms:.1f}ms/1 TCP; includes synthetic 20ms/TCP, no TLS/GPT")

    async def test_auth_is_per_request_and_borrowed_client_survives_failure(self):
        async with service_http.http_lifespan((5,)):
            async with service_http.service_client(5) as client:
                await client.get(self.url, headers={"Authorization": "first-test"})
            try:
                async with service_http.service_client(5) as client:
                    raise ValueError("caller failed")
            except ValueError:
                pass
            async with service_http.service_client(5) as client:
                await client.get(self.url, headers={"Authorization": "second-test"})
                self.assertNotIn("Authorization", client.headers)
        self.assertEqual(self.connections, 1)
        self.assertEqual([headers["authorization"] for headers, _ in self.requests], ["first-test", "second-test"])
        self.assertTrue(all("cookie" not in headers for headers, _ in self.requests))

    async def test_parallel_burst_stays_within_connection_budget(self):
        async with service_http.http_lifespan((5,)):
            async with service_http.service_client(5) as client:
                responses = await asyncio.gather(*(client.get(self.url) for _ in range(60)))
            self.assertEqual(len(responses), 60)
            self.assertTrue(all(response.status_code == 200 for response in responses))
            # Lifetime TCP creations can exceed 20 as idle connections expire;
            # the limit is concurrent requests/connections, not a lifetime cap.
            self.assertLessEqual(self.peak_requests, 20)
            self.assertGreater(self.peak_requests, 1)
            self.assertEqual(len(self.requests), 60)

    async def test_nested_lifespan_rejected_without_destroying_active_pool(self):
        async with service_http.http_lifespan((5,)):
            original = service_http._clients
            with self.assertRaises(RuntimeError):
                async with service_http.http_lifespan((5,)):
                    self.fail("duplicate owner")
            self.assertIs(service_http._clients, original)
            async with service_http.service_client(5) as client:
                self.assertEqual((await client.get(self.url)).status_code, 200)

    async def test_startup_failure_closes_already_created_clients(self):
        first = httpx.AsyncClient()
        with patch.object(service_http.httpx, "AsyncClient", side_effect=[first, RuntimeError("construction failed")]):
            with self.assertRaises(RuntimeError):
                async with service_http.http_lifespan((1, 2)):
                    self.fail("startup should fail")
        self.assertTrue(first.is_closed)
        self.assertIsNone(service_http._clients)

    async def test_api_lifespan_composes_db_and_http_cleanup_on_exception(self):
        from app import main
        entered = []
        @asynccontextmanager
        async def database(_):
            entered.append("start")
            try:
                yield
            finally:
                entered.append("stop")
        with patch.object(main, "lifespan", database):
            with self.assertRaises(ValueError):
                async with main.api_lifespan(main.app):
                    self.assertIsNotNone(service_http._clients)
                    raise ValueError("shutdown path")
        self.assertEqual(entered, ["start", "stop"])
        self.assertIsNone(service_http._clients)
