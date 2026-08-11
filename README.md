# Agency OS

Ek-banda agency ke liye operations platform: **task capture → AI structuring → auto scheduling → client reporting**.

Canonical spec: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — code comments `spec §N` se usi ko reference karte hain.

> **Core principle:** Fuzzy kaam AI karta hai. Numeric kaam deterministic code karta hai.
> AI kabhi scheduling calculation nahi karta, aur AI ka output kabhi bina human approval ke client tak nahi jata.

## Architecture

```
Discord (phone) ──► agency-bot (Python, bot/) ──HTTPS + x-bot-secret──► Next.js API
                     · voice → Groq whisper                               · runAI() → Kimi (Moonshot)
                     · koi LLM key nahi                                   · deterministic scheduler
                                                                          · Supabase (Postgres + RLS)
Client ──► /c/<token> portal (read-only, RLS-scoped JWT)
Cron  ──► /api/cron/{nightly,weekly,monthly}
```

## Repo layout

| Path | Kya hai |
|---|---|
| `supabase/migrations/` | Schema, RLS policies, atomic capture-commit function, seed |
| `src/scheduler/` | Deterministic engine (slots, topo-sort, scoring, first-fit, overflow) + tests |
| `src/capture/` | Conversational capture: deterministic checklist + state machine |
| `src/ai/` | `runAI()` wrapper (waahid LLM raasta), prompts (stable cache prefix), strict JSON schemas |
| `src/reporting/` | Deterministic metrics/deltas, 2σ anomaly detection, draft generation, gated delivery |
| `src/connectors/` | Meta / Windsor (Google+GA4) / Shopify → idempotent snapshots + health tracking |
| `src/jobs/` | Job queue worker (report generation request-time par nahi chalti) |
| `src/commands/` | `/today /week /done /block /client /report /approve /replan` handlers |
| `src/app/api/bot/` | Bot-facing endpoints (`x-bot-secret`) |
| `src/app/api/cron/` | Nightly / weekly / monthly (`x-cron-secret` ya Vercel cron Bearer) |
| `src/app/c/[token]/` | Client portal — token → scoped JWT → har query RLS se |
| `src/app/` | Operator dashboard + report review/approve |
| `bot/` | Discord bot (Python) — sirf transport, LLM key nahi |

## Setup

### 1. Database (Supabase)

```bash
# migrations tarteeb se chalayein
supabase db push   # ya SQL editor mein 0001 → 0002 → 0003
```

### 2. Web app (Vercel ya koi Node host)

```bash
cp .env.example .env.local   # sab values bharein
npm install
npm run dev
```

**Zaroori:** `MOONSHOT_API_KEY` se pehle Moonshot account par kam az kam $1 top-up (K3 access ki shart). `NEXT_PUBLIC_` prefix kisi secret par kabhi nahi.

Cron: `vercel.json` mein UTC schedules hain (02:00 / Fri 17:00 / 1st 09:00 PKT ke mutabiq). Vercel `CRON_SECRET` env set karein — routes `Authorization: Bearer` bhi accept karte hain.

### 3. Discord bot

```bash
cd bot
cp .env.example .env         # token, allowed user IDs, API base, shared secret, Groq key
pip install -r requirements.txt
python bot.py
```

Bot outbound-only connect karta hai — koi port forwarding, static IP ya tunnel nahi chahiye.

### 4. Connectors (optional env)

- `META_AD_ACCOUNTS` — JSON `{ "<brand_slug>": "act_..." }`
- `WINDSOR_ACCOUNTS` — JSON `{ "<brand_slug>": { "google": "...", "ga4": "..." } }`
- `SHOPIFY_SHOPS` — JSON `{ "<brand_slug>": { "domain": "...", "token": "env:VAR" } }`

Missing config = wo connector us client ke liye skip; failure = `connection_health` + Discord notification.

## Tests

```bash
npm test          # scheduler engine — system ka deterministic core
npm run typecheck
```

## System invariants

Poori list `docs/BLUEPRINT.md` §14 mein. Sab se ahem:

1. Scheduling ki math sirf `src/scheduler/engine.ts` mein — AI wahan kabhi nahi aata.
2. AI output sirf capture ke **Confirm** par DB mein jata hai; priority hamesha operator chunta hai.
3. Report bina `approved` client tak nahi jati (`deliver.ts` draft bhejne se inkaar karta hai).
4. Har table par RLS; portal short-lived scoped JWT se parhta hai.
5. Har LLM call `runAI()` se — `reasoning_effort` + `max_completion_tokens` hamesha explicit.
