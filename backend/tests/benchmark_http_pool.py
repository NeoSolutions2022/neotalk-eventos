"""Reproducible loopback evidence; no production network, GPT or microphone."""
import argparse
import asyncio
import json
import platform
import statistics
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_service_http import ServiceHttpTests
from test_services import FakePool
from app import service_http, services


@asynccontextmanager
async def temporary_clients():
    yield


async def benchmark(rounds):
    samples = []
    for index in range(rounds):
        fixture = ServiceHttpTests()
        await fixture.asyncSetUp()
        try:
            variants = ["temporary", "pooled"] if index % 2 == 0 else ["pooled", "temporary"]
            with patch.object(services, "OPENAI_BASE_URL", fixture.url), patch.object(services, "OPENAI_API_KEY", "local-test"):
                for variant in variants:
                    services.invalidate_agent_context_cache()
                    pool = FakePool()
                    fixture.requests.clear()
                    connections_before = fixture.connections
                    started = time.perf_counter()
                    context = service_http.http_lifespan((services.NEOTALK_API_TIMEOUT_SECONDS, 45)) if variant == "pooled" else temporary_clients()
                    async with context:
                        for call in range(12):
                            await services.translate_to_glosses(pool, f"round {index} variant {variant} call {call}")
                    elapsed = (time.perf_counter() - started) * 1000
                    connections = fixture.connections - connections_before
                    assert connections == (1 if variant == "pooled" else 12)
                    assert len(fixture.requests) == 12
                    assert len({json.dumps(body) for _, body in fixture.requests}) == 12
                    samples.append({"round": index + 1, "variant": variant, "elapsed_ms": elapsed,
                                    "tcp_connections": connections, "requests": len(fixture.requests)})
        finally:
            await fixture.asyncTearDown()
    summary = {}
    for variant in ("temporary", "pooled"):
        values = [r["elapsed_ms"] for r in samples if r["variant"] == variant]
        summary[variant] = {"rounds": len(values), "mean_ms": statistics.mean(values),
                            "median_ms": statistics.median(values), "min_ms": min(values), "max_ms": max(values)}
    return {"captured_at": datetime.now(timezone.utc).isoformat(), "scope": "controlled HTTP/1.1 loopback; not production",
            "python": platform.python_version(), "rounds": rounds, "calls_per_variant_per_round": 12,
            "variant_order": "alternating; includes client creation and shutdown; cold context each variant",
            "synthetic_connection_ms": 20, "synthetic_response_ms": 5,
            "limitations": ["No TLS, GPT, WAN, worker, Unity or microphone.", "One local process; round means are not production percentiles."],
            "samples": samples, "summary": summary}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=6)
    args = parser.parse_args()
    if not 2 <= args.rounds <= 30:
        parser.error("rounds must be between 2 and 30")
    result = asyncio.run(benchmark(args.rounds))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], indent=2))
