"""Agency OS API client. The bot is transport only: it holds a shared
secret, never an LLM key (spec §9, invariant 9)."""

import os

import httpx

API_BASE = os.environ["AGENCY_OS_API_BASE"]  # e.g. https://agency-os.vercel.app
BOT_SECRET = os.environ["BOT_SHARED_SECRET"]

_headers = {"x-bot-secret": BOT_SECRET}


async def capture(channel_ref: str, action: str, text: str | None = None) -> dict:
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(
            f"{API_BASE}/api/bot/capture",
            headers=_headers,
            json={"channel_ref": channel_ref, "action": action, "text": text},
        )
        r.raise_for_status()
        return r.json()


async def command(name: str, args: list[str]) -> str:
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(
            f"{API_BASE}/api/bot/command",
            headers=_headers,
            json={"command": name, "args": args},
        )
        r.raise_for_status()
        data = r.json()
        return data.get("message") or data.get("error") or "(empty response)"
