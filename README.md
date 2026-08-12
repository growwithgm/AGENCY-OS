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
                                   · runAI() → Kimi (briefing, advice, reports)
Client ──► /c/<token> portal (read-only, RLS-scoped JWT)
Cron  ──► /api/cron/*  (schedule rebuild, report drafts, notifications)
```

Web **primary surface** hai — har kaam wahan se ho sakta hai. Claude us par ek tez raasta hai: baat-cheet se task banana, edit karna, schedule dekhna.

## Repo layout

| Path | Kya hai |
|---|---|
| `supabase/migrations/` | Schema, RLS policies, seed |
| `src/scheduler/` | Deterministic engine (slots, topo-sort, scoring, first-fit, overflow) + tests + read models |
| `src/tasks/` | Shared task operations — MCP aur web dono yahi call karte hain |
| `src/mcp/` + `src/app/api/mcp/` | MCP server (14 tools) |
| `src/briefing/` | Deterministic briefing data + at_risk/stale classification (tests ke saath) |
| `src/ai/` | `runAI()` wrapper, `jobs.config.ts` (model/effort/tokens), prompts, judgement layer, cache |
| `src/push/` | Web Push delivery, send policy (tested), notification triggers |
| `src/requests/` | Client work requests — rate limits, injection defence, approval (tested) |
| `src/reporting/` | Draft generation (task history se) + approval |
| `src/jobs/` | Job queue worker |
| `src/app/api/cron/` | Schedule rebuild, report drafts, notification triggers |
| `src/app/` | Dashboard, task CRUD, requests queue, report approve, settings |
| `src/app/c/[token]/` | Client portal — token → scoped JWT → har query RLS se |

## Setup

### 1. Database (Supabase)

```bash
supabase db push   # ya SQL editor mein 0001 → 0006, tarteeb se
```

### 2. Web app

```bash
cp .env.example .env.local   # sab values bharein
npm install
npm run dev
```

**Zaroori:** `MOONSHOT_API_KEY` se pehle Moonshot account par kam az kam $1 top-up (K3 access ki shart). `NEXT_PUBLIC_` prefix kisi secret par kabhi nahi.

### 3. Cron (cron-job.org)

Scheduled kaam cron-job.org se chalte hain, Vercel crons se nahi — poori tafseel aur jobs ki list: [`docs/CRON.md`](docs/CRON.md).

Mukhtasiran: har job `GET` hai, timezone `Asia/Karachi`, aur auth ek header se — `x-cron-secret: <CRON_SECRET>` (URL mein kabhi nahi, wo logs mein reh jata hai). Naya setup `/api/cron/ping` par test karein.

Sab jobs ek saath banane ke liye:

```bash
CRONJOB_API_KEY=xxx APP_BASE_URL=https://aapka-app.vercel.app CRON_SECRET=yyy \
  node scripts/setup-cronjobs.mjs --dry-run   # pehle dekh lein
```

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

### Tools (14)

**Read:** `list_clients`, `list_tasks`, `get_schedule` (overflow samet), `get_briefing(narrative?)`, `ask_advice(question)`, `list_pending_requests`, `get_request`

**Write:** `create_task`, `update_task`, `complete_task`, `block_task`, `add_blackout`, `approve_request`, `decline_request`

`get_briefing` din ka poora picture deta hai — aaj ke blocks, at_risk, blocked, stale tasks, overflow, 14-din capacity, aur har client ka retainer usage. `narrative: true` do to saath AI briefing bhi. `ask_advice` usi data par sawal ka jawab deta hai ("is hafte kya kaatun", "kaunsa client ignore ho raha hai").

Capture ab Claude khud karta hai: sawal poochta hai, tasdeeq leta hai, phir `create_task` call karta hai — jismein `priority` **required** field hai aur tool description mein saaf likha hai ke priority hamesha user se poochni hai.

Har write ke baad scheduler khud rebuild hota hai. Sab tools database-scoped hain — koi shell ya filesystem access nahi.

**Report approval MCP par nahi hai.** `generate_report` / `approve_report` jaan boojh kar mojood nahi — approval human gate hai aur sirf web app par rehta hai.

⚠️ MCP secret operator-grade access deta hai — client portal token se bilkul alag cheez hai. Kisi client ko kabhi na dein.

## AI layer

Do hisse hain:

**Judgement** — `get_briefing` ka deterministic JSON AI ko diya jata hai, aur wo raye deta hai:

| Job | Model | effort | Kab |
|---|---|---|---|
| `daily_briefing` | kimi-k3 | low | Dashboard par, roz ek dafa |
| `overload_advice` | kimi-k3 | high | Sirf jab overflow ya at_risk ho |
| `ask_advice` | kimi-k3 | high | `ask_advice` tool call par |
| `estimate_insight` | kimi-k2.5 | — | Hafta-war (weekly cron) |
| `clarify_client_request` | kimi-k2.5 | — | Client portal par request ke sawal |

**Report drafts** — `weekly_report` (k3, low) aur `monthly_report` (k3, high), sirf task history se.

Har job ka model, effort aur token cap ek file mein hai: `src/ai/jobs.config.ts`. Koi job `max` effort istemal nahi karta — ek test isay enforce karta hai.

AI ko sirf taiyar JSON milta hai — wo khud DB query nahi karta. Classification (at_risk, stale, overflow, capacity) deterministic code mein hai aur tested hai. AI schedule badalne ki **tajweez** de sakta hai, schedule **bana** nahi sakta.

Briefing aur advice `ai_cache` table mein roz ek dafa banti hain; dashboard par refresh button aaj ka cache girata hai. Provider down ho to dashboard ka baqi hissa phir bhi chalta hai.

## Push notifications (PWA)

VAPID keys banayein:

```bash
npx web-push generate-vapid-keys
```

Output ki public key **do** env vars mein jati hai (`VAPID_PUBLIC_KEY` aur `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — dono same), private key sirf `VAPID_PRIVATE_KEY` mein, aur `VAPID_SUBJECT` mein apna `mailto:` address.

Phir `/settings` par jaa kar **Enable notifications** dabayein.

**iPhone/iPad:** Safari par push tabhi chalta hai jab site home screen par install ho — **Share → Add to Home Screen**, phir usi icon se kholain. Settings page iOS detect kar ke ye hidayat khud dikha deta hai.

### Kab kya jati hai

| Notification | Waqt (PKT) | Shart |
|---|---|---|
| Aaj ka plan | 08:30 roz | Din halka ho to **nahi** jati |
| Overload alert | 08:35 roz | Sirf jab overflow ya at-risk ho; wahi masla dobara ho to khamosh |
| Sham ka check | 18:00 roz | Sirf jab aaj ke tasks adhoore hon |
| Report drafts | Fri 17:05 | Sirf jab draft pending ho |
| Bar-bar shift hone wale tasks | Mon 09:00 | Sirf jab koi task 3+ baar move ho chuka ho |
| Client ki nayi request | Fauran | Jab client kaam maange |

Content AI likh sakta hai, lekin **bhejne ka faisla hamesha deterministic code karta hai** — halka din khamoshi se guzarta hai. Har notification par tag hota hai taake purani replace ho, stack na ho. Mar chuke devices (404/410) khud delete ho jate hain; 5 baar fail hone par subscription deactivate.

Sab toggles `/settings` par hain (master switch samet), device list aur test button ke saath.

Cron setup: [`docs/CRON.md`](docs/CRON.md).

## Client work requests

Client apne portal se kaam maang sakta hai: likhta hai → AI max 3 sawal poochta hai (uski apni zubaan mein) → request operator ke paas chali jati hai.

**Request se task kabhi khud nahi banta.** `/requests` par operator ko client ka asal matn, poori sawal-jawab transcript, aur editable draft milta hai — **priority khali hoti hai, wahi bharta hai**, aur `est_minutes` mein pichle kaam ka median suggestion dikhta hai. Approve par task banta hai aur client ke portal par dikhne lagta hai; decline par wajah lazmi hai (client ko dikhani hai ya nahi, ye operator tay karta hai).

Security ki tafseel `docs/BLUEPRINT.md` §10 mein — mukhtasiran: client ka text hamesha delimiters ke andar **data** hai, `client_id` hamesha validated token se aata hai, rate limit 5/client aur 10/IP per 24h, question budget code mein cap, aur client ke paas apni request approve karne ka koi raasta nahi.

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
2a. Client request se task kabhi khud nahi banta — operator approval lazmi.
3. Report bina `approved` client tak nahi jati; approval sirf web par.
4. Har table par RLS; portal short-lived scoped JWT se parhta hai.
5. Har LLM call `runAI()` se — `reasoning_effort` + `max_completion_tokens` hamesha explicit.
6. Har write ke baad scheduler rebuild.
