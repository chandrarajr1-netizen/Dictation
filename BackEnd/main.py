from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from controller.transcribe_controller import router as transcribe_router

app = FastAPI(title="Dictation API")

# Allow the React dev server to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transcribe_router)
