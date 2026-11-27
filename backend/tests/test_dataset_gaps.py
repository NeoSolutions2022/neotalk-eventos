import unittest
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

from app.dataset_gaps import measure_vocabulary, missing_candidates, record_missing_terms
from app.main import agent_translate
from app.schemas import AgentTranslateIn
from app.services import NoValidGlosses


class CandidateTests(unittest.TestCase):
    def test_live_counts_all_words_and_repeats_with_compounds_and_privacy(self):
        self.assertEqual(
            measure_vocabulary("Eu: bom dia! dúvida, acompanho acompanho de foo@bar.test https://site.test X123 9999",
                               ["BOM_DIA", "DUVIDA", "EU"]),
            (7, 4, {"ACOMPANHO": ("ACOMPANHO", 2), "DE": ("DE", 1)}),
        )
        self.assertEqual(measure_vocabulary("bom. dia", ["BOM_DIA"])[1], 0)

    def test_normalizes_duplicates_and_excludes_available_terms(self):
        self.assertEqual(missing_candidates(["acompanhar", "ACOMPANHAR", "dúvida", "perguntar dúvida"],
                                          frozenset({"DÚVIDA", "PERGUNTAR_DÚVIDA"})), ["ACOMPANHAR"])

    def test_rejects_contacts_numbers_stopwords_and_sentences(self):
        self.assertEqual(missing_candidates(["EU", "para", "não", "a@x.com", "+5585999999999", "123",
                                            "https://site.test", "esta frase contem muitos termos diferentes", 7], frozenset()), [])
        self.assertEqual(missing_candidates("ACOMPANHAR", frozenset()), [])

    def test_limits_candidates_per_request(self):
        words = ["TERMO" + chr(65+i) for i in range(20)]
        self.assertEqual(len(missing_candidates(words, frozenset())), 12)


class RecordingTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_optional_write_does_not_raise(self):
        pool = AsyncMock()
        pool.execute.side_effect = RuntimeError("db unavailable")
        await record_missing_terms(pool, ["ACOMPANHAR"], "response-1", "live")

    async def test_empty_candidates_do_not_touch_database(self):
        pool = AsyncMock()
        await record_missing_terms(pool, [], "response-1", "live")
        pool.execute.assert_not_awaited()

    async def test_translation_response_does_not_wait_for_optional_write(self):
        pool = AsyncMock()
        tasks = BackgroundTasks()
        result = {"gloss_text": "EU", "missing_concepts": ["ACOMPANHAR"], "openai_response_id": "r1"}
        with patch("app.main.translate_to_glosses", AsyncMock(return_value=result)):
            self.assertEqual(await agent_translate(AgentTranslateIn(text="Eu vou acompanhar"), None, tasks, pool, None), result)
        pool.execute.assert_not_awaited()
        await tasks()
        pool.execute.assert_awaited_once()

    async def test_records_gap_even_when_there_are_no_playable_glosses(self):
        pool = AsyncMock()
        tasks = BackgroundTasks()
        with patch("app.main.translate_to_glosses", AsyncMock(side_effect=NoValidGlosses(["ACOMPANHAR"], "r2"))):
            result = await agent_translate(AgentTranslateIn(text="Acompanhar"), None, tasks, pool, None)
        self.assertTrue(result["skipped"])
        await tasks()
        self.assertEqual(pool.execute.call_args.args[1], "r2")

    async def test_live_observation_persists_even_when_agent_returns_502(self):
        pool = AsyncMock()
        tasks = BackgroundTasks()
        payload = AgentTranslateIn(text="Eu acompanho", live_observation_id=uuid4())
        user = SimpleNamespace(id=uuid4())
        with patch("app.main.translate_to_glosses", AsyncMock(side_effect=HTTPException(502, "offline"))), \
             patch("app.main.record_live_coverage", AsyncMock()) as record:
            response = await agent_translate(payload, None, tasks, pool, user)
            self.assertEqual(response.status_code, 502)
            record.assert_not_awaited()
            await response.background()
            record.assert_awaited_once()
            self.assertEqual(record.call_args.args[1], "Eu acompanho")
