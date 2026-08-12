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
| `src/mcp/` + `src/app/api/mcp/` | MCP server — Claude ko connect karne ke liye (read + write) |
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

## MCP — Claude ko connect karna (read + write)

Deploy hone ke baad `/api/mcp` par ek MCP server chalta hai (Streamable HTTP). `MCP_SECRET` env mein lamba random string rakhein — unset ho to endpoint band rehta hai.

**claude.ai (web/mobile)** — Settings → Connectors → Add custom connector:

```
https://<aapka-app>.vercel.app/api/mcp?key=<MCP_SECRET>
```

**Claude Code:**

```bash
claude mcp add --transport http agency-os https://<aapka-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_SECRET>"
```

**Claude Desktop** — Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "agency-os": {
      "type": "http",
      "url": "https://<aapka-app>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <MCP_SECRET>" }
    }
  }
}
```

### Tools

**Read:** `list_clients`, `get_client`, `list_tasks`, `get_schedule` (overflow samet), `list_reports`, `get_report`, `get_metrics`, `get_ai_usage` (token/cost visibility)

**Write:** `create_task`, `update_task`, `complete_task`, `block_task`, `add_blackout`, `replan`, `generate_report` (sirf draft banata hai), `approve_report` (invariant-3 gate — sirf operator ke kehne par), `deliver_report`

Sab tools database-scoped hain (invariant 10) — koi shell ya filesystem access nahi. Writes ke baad scheduler khud rebuild hota hai. Reports wala safeguard MCP se bhi qaim hai: draft bina approval ke client tak nahi ja sakta — `deliver_report` draft bhejne se inkaar kar deta hai.

⚠️ MCP secret operator-grade access deta hai — ye client portal token se bilkul alag cheez hai. Kisi client ko kabhi na dein.

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
