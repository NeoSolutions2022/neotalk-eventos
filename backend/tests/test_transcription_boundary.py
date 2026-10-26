import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from app import services
from app.main import agent_transcribe
from test_audio_input import EMPTY, HEADER


class Reply:
    def __init__(self, status, payload):
        self.status_code, self.payload = status, payload

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class Client:
    def __init__(self, reply):
        self.post = AsyncMock(return_value=reply)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


class TranscriptionBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_recorder_header_is_explicit_and_never_reaches_provider(self):
        request = SimpleNamespace(headers={"content-type":"audio/webm;codecs=opus"},body=AsyncMock(return_value=EMPTY))
        with patch("app.main.transcribe_audio", AsyncMock()) as provider:
            response = await agent_transcribe(request, object())
        self.assertEqual(response, {"text":"", "skipped":"empty_container"})
        provider.assert_not_awaited()

    async def test_small_media_and_unknown_files_are_not_dropped(self):
        for content in [b"short audio", HEADER+b"\x18\x53\x80\x67\xff"]:
            request=SimpleNamespace(headers={"content-type":"audio/webm"},body=AsyncMock(return_value=content))
            with patch("app.main.transcribe_audio", AsyncMock(return_value="fala")) as provider:
                self.assertEqual(await agent_transcribe(request,object()), {"text":"fala"})
            provider.assert_awaited_once_with(content,"audio/webm")

    async def test_file_rejection_is_not_mislabeled_as_transient_502(self):
        for status in [400,422]:
            client=Client(Reply(status,{"error":{"param":"file","code":"invalid_value","message":"private upstream payload"}}))
            with patch.object(services,"OPENAI_API_KEY","test-key"),patch.object(services,"service_client",return_value=client):
                with self.assertRaises(HTTPException) as error:
                    await services.transcribe_audio(b"media","audio/webm")
            self.assertEqual(error.exception.status_code,422)
            self.assertNotIn("private",error.exception.detail)
            self.assertEqual(client.post.await_count,1)

    async def test_real_transient_failures_remain_retryable(self):
        for status in [429,500,502,503]:
            client=Client(Reply(status,{"error":{"param":None}}))
            with patch.object(services,"OPENAI_API_KEY","test-key"),patch.object(services,"service_client",return_value=client):
                with self.assertRaises(HTTPException) as error:
                    await services.transcribe_audio(b"media","audio/webm")
            self.assertEqual(error.exception.status_code,502)

    async def test_malformed_success_response_never_becomes_spoken_text(self):
        for payload in [None,[],{"text":None},{"text":42},{},ValueError("bad JSON")]:
            client=Client(Reply(200,payload))
            with patch.object(services,"OPENAI_API_KEY","test-key"),patch.object(services,"service_client",return_value=client):
                with self.assertRaises(HTTPException) as error:
                    await services.transcribe_audio(b"media","audio/webm")
            self.assertEqual(error.exception.status_code,502)


if __name__ == "__main__":
    unittest.main()
