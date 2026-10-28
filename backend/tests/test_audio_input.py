import unittest
from app.audio_input import is_empty_browser_webm

# Actual header emitted by Edge 155 with the synthetic microphone stopped
# immediately; no media frames, voice, credentials or hardware IDs.
HEADER = bytes.fromhex("1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102")
EMPTY = HEADER + bytes(74)


class EmptyWebmTests(unittest.TestCase):
    def test_observed_110_byte_header_is_empty(self):
        self.assertEqual(len(EMPTY), 110)
        self.assertTrue(is_empty_browser_webm(EMPTY, "audio/webm"))
        self.assertTrue(is_empty_browser_webm(HEADER, "audio/webm;codecs=opus"))

    def test_never_classifies_by_size_alone(self):
        for content in [b"", bytes(110), b"short spoken audio", HEADER + b"\x18\x53\x80\x67\xff", HEADER + b"\xa3\x81\x01"]:
            self.assertFalse(is_empty_browser_webm(content, "audio/webm"))

    def test_any_nonzero_after_header_is_forwarded_even_inside_padding(self):
        for index in range(74):
            candidate = HEADER + bytes(index) + b"\x01" + bytes(73-index)
            self.assertFalse(is_empty_browser_webm(candidate, "audio/webm"))

    def test_other_codecs_and_container_types_are_not_silently_ignored(self):
        for mime in ["audio/mp4", "audio/ogg", "audio/wav"]:
            self.assertFalse(is_empty_browser_webm(EMPTY, mime))
        self.assertFalse(is_empty_browser_webm(EMPTY.replace(b"webm", b"xxxx"), "audio/webm"))

    def test_truncated_or_unknown_length_header_is_not_assumed_empty(self):
        for index in range(len(HEADER)):
            self.assertFalse(is_empty_browser_webm(HEADER[:index], "audio/webm"))
        self.assertFalse(is_empty_browser_webm(HEADER[:4]+b"\xff"+HEADER[5:], "audio/webm"))
        self.assertFalse(is_empty_browser_webm(HEADER[:4]+b"\x00"+HEADER[5:], "audio/webm"))

    def test_bounded_classifier_does_not_scan_large_speech_uploads(self):
        self.assertFalse(is_empty_browser_webm(HEADER+bytes(4097), "audio/webm"))


if __name__ == "__main__":
    unittest.main()
