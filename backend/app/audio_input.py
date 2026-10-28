"""Recognize a proven no-media recorder output, not silence or short speech."""


def _vint(data: bytes, offset: int, *, element_id: bool = False) -> tuple[int, int] | None:
    if offset >= len(data) or not data[offset]:
        return None
    width, marker = 1, 0x80
    while not data[offset] & marker:
        width += 1
        marker >>= 1
    if width > (4 if element_id else 8) or offset + width > len(data):
        return None
    value = int.from_bytes(data[offset:offset + width], "big")
    if not element_id:
        value &= (1 << (7 * width)) - 1
        if value == (1 << (7 * width)) - 1:  # Unknown length is not evidence of emptiness.
            return None
    return value, offset + width


def is_empty_browser_webm(content: bytes, content_type: str) -> bool:
    # Chromium can stop before the muxer writes any Segment/Tracks/Cluster:
    # a complete EBML webm header followed only by reserved zero bytes (110 B
    # in the observed case). Never infer emptiness from file size/duration alone.
    if content_type.split(";", 1)[0].lower() != "audio/webm" or len(content) > 4096:
        return False
    if not content.startswith(b"\x1a\x45\xdf\xa3"):
        return False
    size = _vint(content, 4)
    if size is None:
        return False
    length, start = size
    end = start + length
    if end > len(content) or any(content[end:]):
        return False  # Any media/unknown/truncated Segment must follow normal validation.
    offset, webm = start, False
    while offset < end:
        field = _vint(content[:end], offset, element_id=True)
        if field is None:
            return False
        field_id, offset = field
        field_size = _vint(content[:end], offset)
        if field_size is None:
            return False
        field_length, offset = field_size
        if offset + field_length > end:
            return False
        if field_id == 0x4282:
            if webm or content[offset:offset + field_length] != b"webm":
                return False
            webm = True
        offset += field_length
    return offset == end and webm
