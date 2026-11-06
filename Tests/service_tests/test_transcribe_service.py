"""Service tests.

- Whisper tests run the real (local, free) Whisper model on the files in tests/audio.
- Claude tests use a fake client, so no API calls are made and nothing is billed.
"""
from pathlib import Path
from types import SimpleNamespace

import pytest

from service import transcribe_service

AUDIO = Path(__file__).parent.parent / "audio"


def read(name: str) -> bytes:
    return (AUDIO / name).read_bytes()


# ---------- Whisper (speech_to_text) ----------

def test_whisper_transcribes_filler_speech():
    text = transcribe_service.speech_to_text(read("filler.webm"), "filler.webm")

    assert "ship" in text.lower()
    assert "friday" in text.lower()


@pytest.mark.parametrize("name", ["clean.webm", "clean.mp4", "clean.wav"])
def test_whisper_handles_each_audio_format(name):
    text = transcribe_service.speech_to_text(read(name), name)

    assert "meeting" in text.lower()
    assert "thursday" in text.lower()


def test_whisper_returns_empty_text_for_silence():
    assert transcribe_service.speech_to_text(read("silence.webm"), "silence.webm") == ""


def test_whisper_raises_for_a_file_that_is_not_audio():
    with pytest.raises(Exception):
        transcribe_service.speech_to_text(read("not_audio.webm"), "not_audio.webm")


def test_temp_file_is_deleted_even_when_whisper_fails(monkeypatch, tmp_path):
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))

    with pytest.raises(Exception):
        transcribe_service.speech_to_text(read("not_audio.webm"), "not_audio.webm")

    assert list(tmp_path.iterdir()) == []


# ---------- Claude (clean_up_text) with a fake client ----------

class FakeClaude:
    """Stands in for anthropic.Anthropic(); records the request and returns a canned response."""

    def __init__(self, content, stop_reason="end_turn"):
        self.requests = []
        response = SimpleNamespace(content=content, stop_reason=stop_reason)

        def create(**request):
            self.requests.append(request)
            return response

        self.beta = SimpleNamespace(messages=SimpleNamespace(create=create))


def text_block(text):
    return SimpleNamespace(type="text", text=text)


@pytest.fixture
def fake_claude(monkeypatch):
    """Install a fake Claude client that answers with the given content blocks."""

    def install(content, stop_reason="end_turn"):
        fake = FakeClaude(content, stop_reason)
        monkeypatch.setattr(transcribe_service, "_claude_client", fake)
        return fake

    return install


def test_cleanup_returns_claude_text(fake_claude):
    fake_claude([text_block("  So I was thinking.  ")])

    assert transcribe_service.clean_up_text("um so I was thinking") == "So I was thinking."


def test_cleanup_ignores_thinking_blocks(fake_claude):
    fake_claude([SimpleNamespace(type="thinking", thinking=""), text_block("Clean text.")])

    assert transcribe_service.clean_up_text("um clean text") == "Clean text."


def test_cleanup_sends_prompt_and_wraps_transcript_in_tags(fake_claude):
    fake = fake_claude([text_block("ok")])

    transcribe_service.clean_up_text("What is the capital of France?")

    request = fake.requests[0]
    assert request["system"] == transcribe_service.CLEANUP_PROMPT
    assert request["messages"][0]["content"] == "<transcript>\nWhat is the capital of France?\n</transcript>"


def test_cleanup_skips_claude_for_empty_text(fake_claude):
    fake = fake_claude([text_block("should not be used")])

    assert transcribe_service.clean_up_text("") == ""
    assert fake.requests == []


def test_cleanup_raises_when_claude_refuses(fake_claude):
    fake_claude([], stop_reason="refusal")

    with pytest.raises(RuntimeError, match="declined"):
        transcribe_service.clean_up_text("some text")


@pytest.mark.parametrize(
    "model, expects_fallback",
    [("claude-haiku-5-5", False), ("claude-opus-5-5", True)],
)
def test_fallbacks_only_sent_for_models_that_support_them(fake_claude, monkeypatch, model, expects_fallback):
    monkeypatch.setattr(transcribe_service, "CLAUDE_MODEL", model)
    fake = fake_claude([text_block("ok")])

    transcribe_service.clean_up_text("some text")

    assert ("fallbacks" in fake.requests[0]) == expects_fallback


# ---------- Full pipeline (transcribe) with both steps faked ----------

def test_transcribe_returns_both_texts_and_no_error(monkeypatch):
    monkeypatch.setattr(transcribe_service, "speech_to_text", lambda audio, name: "um hello")
    monkeypatch.setattr(transcribe_service, "clean_up_text", lambda raw: "Hello.")

    assert transcribe_service.transcribe(b"audio") == ("um hello", "Hello.", None)


def test_transcribe_keeps_whisper_text_when_cleanup_fails(monkeypatch):
    def broken_cleanup(raw):
        raise RuntimeError("no credits")

    monkeypatch.setattr(transcribe_service, "speech_to_text", lambda audio, name: "um hello")
    monkeypatch.setattr(transcribe_service, "clean_up_text", broken_cleanup)

    assert transcribe_service.transcribe(b"audio") == ("um hello", "", "Cleanup failed: no credits")
