import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import services
from app.services import AgentResponseIncomplete, _parse_agent_payload


def response_payload(text: str, status: str = "completed", reason: str | None = None) -> dict:
    return {
        "status": status,
        "incomplete_details": {"reason": reason} if reason else None,
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


class ParseAgentPayloadTests(unittest.TestCase):
    def test_parses_completed_structured_output(self) -> None:
        result = _parse_agent_payload(
            response_payload('{"glosses":["CASA"],"reasoning_summary":"Tradução direta."}')
        )

        self.assertEqual(result["glosses"], ["CASA"])

    def test_marks_max_output_tokens_as_retryable(self) -> None:
        with self.assertRaises(AgentResponseIncomplete) as context:
            _parse_agent_payload(response_payload("{", status="incomplete", reason="max_output_tokens"))

        self.assertEqual(context.exception.reason, "max_output_tokens")

    def test_marks_truncated_json_as_retryable(self) -> None:
        with self.assertRaises(AgentResponseIncomplete) as context:
            _parse_agent_payload(response_payload('{"glosses":["CASA"],"reasoning_summary":"texto'))

        self.assertEqual(context.exception.reason, "invalid_json")

    def test_rejects_unexpected_response_status(self) -> None:
        with self.assertRaises(HTTPException) as context:
            _parse_agent_payload(response_payload("{}", status="failed"))

        self.assertEqual(context.exception.status_code, 502)


class FakePool:
    async def fetchrow(self, _query: str) -> dict:
        return {"id": "prompt-id", "version": 1, "instructions": "Traduza para glosas válidas."}

    async def fetch(self, _query: str) -> list[dict]:
        return [{"word": "CASA"}]


class FakeResponse:
    status_code = 200

    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def json(self) -> dict:
        return self.payload


class FakeAsyncClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.requests: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    async def post(self, _url: str, **kwargs) -> FakeResponse:
        self.requests.append(kwargs["json"])
        return self.responses.pop(0)


class TranslateToGlossesTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_incomplete_response_with_larger_budget(self) -> None:
        incomplete = FakeResponse(response_payload("{", status="incomplete", reason="max_output_tokens"))
        completed = FakeResponse(
            {
                "id": "resp-ok",
                **response_payload('{"glosses":["CASA"],"reasoning_summary":"Tradução direta."}'),
            }
        )
        client = FakeAsyncClient([incomplete, completed])

        with (
            patch.object(services, "OPENAI_API_KEY", "test-key"),
            patch.object(services, "OPENAI_MAX_OUTPUT_TOKENS", 2500),
            patch.object(services, "OPENAI_RETRY_MAX_OUTPUT_TOKENS", 5000),
            patch.object(services.httpx, "AsyncClient", return_value=client),
        ):
            result = await services.translate_to_glosses(FakePool(), "Minha casa")

        self.assertEqual(result["gloss_text"], "CASA")
        self.assertEqual(result["openai_response_id"], "resp-ok")
        self.assertEqual([request["max_output_tokens"] for request in client.requests], [2500, 5000])


if __name__ == "__main__":
    unittest.main()
