"""Controller tests: the service is replaced with a fake, so Whisper and Claude never run."""
import pytest
from fastapi.testclient import TestClient

from main import app
from service import transcribe_service

client = TestClient(app)
URL = "/api/transcribe"


def upload(data: bytes = b"fake audio", filename: str = "recording.webm"):
    return client.post(URL, files={"audio": (filename, data, "audio/webm")})


@pytest.fixture
def fake_service(monkeypatch):
    """Replace the service with a fake and record what it was called with."""
    calls = []

    def fake_transcribe(audio_bytes, filename):
        calls.append((audio_bytes, filename))
        return "um raw text", "Raw text.", None

    monkeypatch.setattr(transcribe_service, "transcribe", fake_transcribe)
    return calls


def test_success_returns_whisper_and_cleaned_text(fake_service):
    response = upload()

    assert response.status_code == 200
    assert response.json() == {"raw_text": "um raw text", "cleaned_text": "Raw text.", "error": None}


def test_audio_and_filename_are_passed_to_service(fake_service):
    upload(b"some audio bytes", "clip.mp4")

    assert fake_service == [(b"some audio bytes", "clip.mp4")]


def test_cleanup_error_is_returned_with_whisper_text(monkeypatch):
    monkeypatch.setattr(
        transcribe_service, "transcribe", lambda audio, name: ("um raw text", "", "Cleanup failed: boom")
    )

    response = upload()

    assert response.status_code == 200
    assert response.json() == {"raw_text": "um raw text", "cleaned_text": "", "error": "Cleanup failed: boom"}


def test_empty_file_returns_400_without_calling_service(fake_service):
    response = upload(b"")

    assert response.status_code == 400
    assert response.json()["detail"] == "Audio file is empty."
    assert fake_service == []


def test_missing_audio_field_returns_422():
    response = client.post(URL, files={"wrong_name": ("recording.webm", b"x", "audio/webm")})

    assert response.status_code == 422


def test_service_crash_returns_500(monkeypatch):
    def crash(audio, name):
        raise RuntimeError("Whisper exploded")

    monkeypatch.setattr(transcribe_service, "transcribe", crash)

    response = upload()

    assert response.status_code == 500
    assert response.json()["detail"] == "Transcription failed: Whisper exploded"


def test_frontend_origin_is_allowed(fake_service):
    response = client.post(
        URL,
        files={"audio": ("recording.webm", b"x", "audio/webm")},
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
