from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from service import transcribe_service

router = APIRouter(prefix="/api")


class TranscribeResponse(BaseModel):
    raw_text: str
    cleaned_text: str
    error: str | None = None  # set when Whisper worked but the cleanup failed


# A plain "def" (not async) makes FastAPI run this in a worker thread,
# so slow Whisper/LLM calls don't block the server.
@router.post("/transcribe", response_model=TranscribeResponse)
def transcribe(audio: UploadFile = File(...)) -> TranscribeResponse:
    """Receive recorded audio from the frontend and return the transcribed text."""
    audio_bytes = audio.file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    try:
        raw_text, cleaned_text, error = transcribe_service.transcribe(
            audio_bytes, audio.filename or "recording.webm"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")

    return TranscribeResponse(raw_text=raw_text, cleaned_text=cleaned_text, error=error)
