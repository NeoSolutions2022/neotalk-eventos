import unittest
from datetime import datetime, timezone
from io import BytesIO

from pypdf import PdfReader

from app.dataset_pdf import build_dataset_pdf


class DatasetPdfTests(unittest.TestCase):
    def test_contains_all_words_across_multiple_pages(self) -> None:
        words = [f"PALAVRA {index:04d}" for index in range(800)]
        words[0] = "AÇÃO"
        words[-1] = "ÚLTIMA"
        content = build_dataset_pdf(words, datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertTrue(content.startswith(b"%PDF-"))
        reader = PdfReader(BytesIO(content))
        self.assertGreater(len(reader.pages), 1)
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("800 palavras", text)
        self.assertIn("AÇÃO", text)
        self.assertIn("ÚLTIMA", text)
        self.assertIn("PALAVRA 0400", text)
        self.assertIn("PALAVRA 0798", text)


if __name__ == "__main__":
    unittest.main()
