"""Voice → text via Groq Whisper (spec §10). The transcript feeds the same
parse prompt as typed text — no separate logic. Brand-name mangling is fixed
by the client list hardcoded in the parse prompt, not by transcription tweaks."""

import os

import httpx

GROQ_KEY = os.environ["GROQ_API_KEY"]


async def transcribe(audio_bytes: bytes, filename: str) -> str:
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            files={"file": (filename, audio_bytes)},
            data={
                "model": "whisper-large-v3",
                "language": "ur",
                "response_format": "text",
            },
        )
        r.raise_for_status()
        return r.text.strip()
