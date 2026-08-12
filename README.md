# Agency OS

Ek-banda agency ke liye operations platform: **capture (Claude) → auto scheduling → client reporting**.

Canonical spec: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — code comments `spec §N` se usi ko reference karte hain.

> **Core principle:** Fuzzy kaam AI karta hai. Numeric kaam deterministic code karta hai.
> AI kabhi scheduling calculation nahi karta, aur AI ka output kabhi bina human approval ke client tak nahi jata.

## Architecture

```
Claude (MCP) ──► /api/mcp ──┐
                            ├──► Next.js + Supabase (Postgres + RLS)
Operator ──► Web app ───────┘      · deterministic scheduler
                                   · runAI() → Kimi (sirf report drafts)
Client ──► /c/<token> portal (read-only, RLS-scoped JWT)
Cron  ──► /api/cron/{nightly,weekly,monthly}
```

Web **primary surface** hai — har kaam wahan se ho sakta hai. Claude us par ek tez raasta hai: baat-cheet se task banana, edit karna, schedule dekhna.

## Repo layout

| Path | Kya hai |
|---|---|
| `supabase/migrations/` | Schema, RLS policies, seed |
| `src/scheduler/` | Deterministic engine (slots, topo-sort, scoring, first-fit, overflow) + tests + read models |
| `src/tasks/` | Shared task operations — MCP aur web dono yahi call karte hain |
| `src/mcp/` + `src/app/api/mcp/` | MCP server (8 tools) |
| `src/ai/` | `runAI()` wrapper + report prompts — sirf do LLM jobs |
| `src/reporting/` | Draft generation (task history se) + approval |
| `src/jobs/` | Job queue worker |
| `src/app/api/cron/` | Nightly / weekly / monthly |
| `src/app/` | Dashboard, task CRUD, report review/approve |
| `src/app/c/[token]/` | Client portal — token → scoped JWT → har query RLS se |

## Setup

### 1. Database (Supabase)

```bash
supabase db push   # ya SQL editor mein 0001 → 0003
```

### 2. Web app

```bash
cp .env.example .env.local   # sab values bharein
npm install
npm run dev
```

**Zaroori:** `MOONSHOT_API_KEY` se pehle Moonshot account par kam az kam $1 top-up (K3 access ki shart). `NEXT_PUBLIC_` prefix kisi secret par kabhi nahi.

Cron: `vercel.json` mein UTC schedules hain (02:00 / Fri 17:00 / 1st 09:00 PKT ke mutabiq). Vercel `CRON_SECRET` env set karein — routes `Authorization: Bearer` bhi accept karte hain.

## MCP — Claude ko connect karna

`MCP_SECRET` env mein lamba random string rakhein — unset ho to endpoint band rehta hai.

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

### Tools (8)

**Read:** `list_clients`, `list_tasks`, `get_schedule` (overflow samet)

**Write:** `create_task`, `update_task`, `complete_task`, `block_task`, `add_blackout`

Capture ab Claude khud karta hai: sawal poochta hai, tasdeeq leta hai, phir `create_task` call karta hai — jismein `priority` **required** field hai aur tool description mein saaf likha hai ke priority hamesha user se poochni hai.

Har write ke baad scheduler khud rebuild hota hai. Sab tools database-scoped hain — koi shell ya filesystem access nahi.

**Report approval MCP par nahi hai.** `generate_report` / `approve_report` jaan boojh kar mojood nahi — approval human gate hai aur sirf web app par rehta hai.

⚠️ MCP secret operator-grade access deta hai — client portal token se bilkul alag cheez hai. Kisi client ko kabhi na dein.

## Reports

Weekly (Fri) aur monthly (1st) drafts cron se bante hain, **sirf task history se** — koi metrics, koi connectors. Draft dashboard par aata hai; approve karne par client ke portal par live ho jata hai. Delivery ka waahid channel portal hai — koi email/WhatsApp push nahi.

## Tests

```bash
npm test          # scheduler engine — system ka deterministic core
npm run typecheck
```

## System invariants

Poori list `docs/BLUEPRINT.md` §14 mein. Sab se ahem:

1. Scheduling ki math sirf `src/scheduler/engine.ts` mein — AI wahan kabhi nahi aata.
2. Priority AI kabhi tay nahi karta; task banane se pehle tasdeeq lazmi.
3. Report bina `approved` client tak nahi jati; approval sirf web par.
4. Har table par RLS; portal short-lived scoped JWT se parhta hai.
5. Har LLM call `runAI()` se — `reasoning_effort` + `max_completion_tokens` hamesha explicit.
6. Har write ke baad scheduler rebuild.
