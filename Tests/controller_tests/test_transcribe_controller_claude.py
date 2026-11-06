"""Endpoint tests that call the REAL Claude API (and real Whisper), with nothing faked.

These cost a small amount per run, so they only run when asked for:
    pytest -m claude
"""
import os
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

pytestmark = [
    pytest.mark.claude,
    pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY"), reason="ANTHROPIC_API_KEY is not set"),
]

client = TestClient(app)
AUDIO = Path(__file__).parent.parent / "audio"


def post_audio(name: str):
    with open(AUDIO / name, "rb") as f:
        return client.post("/api/transcribe", files={"audio": (name, f, "audio/webm")})


def has_word(text: str, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", text, re.IGNORECASE) is not None


def test_endpoint_returns_whisper_and_claude_text():
    response = post_audio("filler.webm")

    assert response.status_code == 200
    body = response.json()
    assert body["error"] is None
    assert has_word(body["raw_text"], "um")
    assert not has_word(body["cleaned_text"], "um") and has_word(body["cleaned_text"], "Friday")


@pytest.mark.parametrize("name", ["clean.webm", "clean.mp4", "clean.wav"])
def test_endpoint_works_for_each_audio_format(name):
    response = post_audio(name)

    assert response.status_code == 200
    body = response.json()
    assert body["error"] is None
    assert has_word(body["cleaned_text"], "meeting") and has_word(body["cleaned_text"], "Thursday")


def test_endpoint_does_not_follow_recorded_instruction():
    response = post_audio("instruction.webm")

    assert response.status_code == 200
    cleaned = response.json()["cleaned_text"]
    assert has_word(cleaned, "ocean")
    assert "\n" not in cleaned, f"Claude seems to have written a poem: {cleaned!r}"


def test_endpoint_returns_whisper_text_and_error_when_claude_key_is_wrong(monkeypatch):
    import anthropic

    from service import transcribe_service

    # A real Claude client with a bad key: the real API rejects it.
    monkeypatch.setattr(transcribe_service, "_claude_client", anthropic.Anthropic(api_key="bad-key"))

    response = post_audio("filler.webm")

    assert response.status_code == 200
    body = response.json()
    assert has_word(body["raw_text"], "Friday")
    assert body["cleaned_text"] == ""
    assert body["error"].startswith("Cleanup failed:")
