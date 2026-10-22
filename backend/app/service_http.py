"""Bounded outbound connection reuse, owned by the API lifespan.

Only transports are reused: no translation/audio results are cached here.
Authentication headers remain per request, never defaults on a shared client.
"""
from contextlib import AsyncExitStack, asynccontextmanager
from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx


_clients: dict[float, httpx.AsyncClient] | None = None


class _NoProviderCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False


@asynccontextmanager
async def http_lifespan(timeouts: tuple[float, ...]):
    global _clients
    if _clients is not None:
        raise RuntimeError("Service HTTP lifespan is already active")
    async with AsyncExitStack() as stack:
        clients = {}
        for timeout in set(timeouts):
            clients[timeout] = await stack.enter_async_context(httpx.AsyncClient(
                timeout=timeout,
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30),
                cookies=CookieJar(policy=_NoProviderCookies()),
            ))
        _clients = clients
        try:
            yield
        finally:
            _clients = None


@asynccontextmanager
async def service_client(timeout: float):
    if _clients is not None and timeout in _clients:
        yield _clients[timeout]
    else:
        # CLI/direct service tests without an ASGI lifespan still close resources.
        async with httpx.AsyncClient(timeout=timeout) as client:
            yield client
