# Agency OS

Capacity-aware work management for one person running a small agency.

The problem it solves is not "what do I have to do" — a list does that. It
is "can I actually do this, and what breaks if I say yes". Everything here
follows from taking that question seriously.

## What it does

**Capture** turns a sentence into structured work. It commits to an
interpretation and asks only for what it genuinely cannot infer. Two things
are never guessed: the client, because putting work on the wrong portal is
worse than one extra tap, and the priority, because priority is what the
scheduler orders everything by.

**The scheduler** treats a day as a sequence of named zones rather than a
bucket of minutes. Operations in the morning, Admin after lunch, Peak at
night for creative and technical work. Work goes only where its kind is
admitted, never below the minimum unbroken block for that kind, and deep
work is placed whole or not at all. Same inputs, same plan, every time —
there is no scoring and nothing to tune.

**Three dates**, kept apart on purpose:

| | what it means | who sees it |
|---|---|---|
| `client_requested_date` | what the client asked for | not a promise |
| `internal_target` | when you intend to do it | you only |
| `committed_date` | what you actually promised | the client |

Commitments are tested against a *safe* estimate — the likely one padded by
how much that kind of work has genuinely overrun — because a promise that
only holds if nothing goes wrong is not a plan.

**The client portal** reads as a letter, not a dashboard. It shows
client-facing titles and status, in the client's own language, and a date
only where a commitment exists. Where there is no commitment there is no
date at all: silence is honest, "soon" is a promise nobody made.

**The assistant** can do things, within a fence. Anything affecting only
you it does directly and reports, with 30 seconds to undo. Anything that
reaches a client, or sets a priority, it can only *propose* — those tools
do not exist in the list the model is given, so no phrasing can reach one.

**The weekly review** is arithmetic: commitments met and missed, hours by
kind of work and by client, context switches per day, peak hours used
against available, estimate accuracy, and what keeps moving.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in Supabase and OPERATOR_EMAIL
npm run dev
```

Database and sign-in setup: **[docs/SETUP.md](docs/SETUP.md)**.
The rules the code will not break: **[docs/INVARIANTS.md](docs/INVARIANTS.md)**.
What the system is and why: **[docs/BLUEPRINT.md](docs/BLUEPRINT.md)**.

```bash
npm test          # 200 tests, no network, no database
npm run typecheck
npm run build
```

Two checks worth running against a real database:

```bash
psql -d <db> -f supabase/schema.sql    # THE schema — one file, no migrations; re-run after every change
psql -d <db> -f scripts/verify-portal-isolation.sql    # proves a client sees only their own
```

## Connect Claude (MCP)

Two MCP endpoints, both guarded by `MCP_SECRET` (header `x-mcp-secret`,
`Authorization: Bearer`, or — for URL-only clients like claude.ai custom
connectors — the secret as a path segment:
`/api/mcp/assistant/<MCP_SECRET>`):

- `/api/mcp` — read and propose only (the plan, capacity, attention,
  simulations, park a capture in the Inbox).
- `/api/mcp/assistant` — the whole app for Claude Code, claude.ai (custom
  connector), or the API's MCP connector: the in-app assistant's full
  toolset, the remaining reads (settings, inbox, cron health, AI usage),
  the operator decisions (priority, committed dates, approve/decline,
  publish, archive, delete), and client management (create a client,
  create/reset a portal login — the one-time password comes back in the
  conversation — disable a login). Decisions live only here — the secret
  is the operator's own credential — and each one requires an explicit
  `confirm: true` on the operator's say-so, audited like a tap in the app.
  The in-app assistant stays fenced exactly as before.

```bash
claude mcp add --transport http agency-os https://<your-app>/api/mcp/assistant \
  --header "x-mcp-secret: <MCP_SECRET>"
```

Full per-client setup (claude.ai connector URL form, Claude API
`mcp_servers` snippet): [docs/SETUP.md](docs/SETUP.md) §8.

## Cron (cron-job.org)

Five scheduled jobs keep the system honest: nightly replan, the morning
attention push, the three delivery windows, Thursday's update drafts and
Friday's client digest. They run from an **external scheduler** —
`vercel.json` deliberately declares no crons, because the windows job runs
three times a day and Vercel's Hobby plan allows one run per day.

One command sets all five up on [cron-job.org](https://cron-job.org)
(idempotent — re-run it after changing the app URL or the secret):

```bash
CRONJOB_API_KEY=... APP_URL=https://your-app.vercel.app CRON_SECRET=... \
  node scripts/setup-cronjobs.mjs
```

The secret is sent as the `x-cron-secret` header, never in the URL. The
full route-by-route table, and the timezone rule (`APP_TIMEZONE` and `TZ`
must be set, and equal), are in [docs/SETUP.md](docs/SETUP.md) §6. Today
and Settings watch the heartbeat: if nothing has planned for 36 hours, the
operator is told instead of trusting a stale plan.

## What it deliberately is not

No Kanban, no Gantt, no percentage-complete, no automatic priority scoring,
no client chat, no invoicing, no CRM, no imported metrics, no analytics
dashboards, no theme picker, no i18n framework, no vector database.

External services, all optional except the first: Supabase (database and
auth), Kimi (the AI jobs — every one has a deterministic fallback), Groq
(voice input), Resend (client digests), Web Push. None of them is a source
of business data.

## Stack

Next.js 15 App Router, React 19, TypeScript, Supabase (Postgres + Auth +
RLS), Vitest. Deployed on Vercel; cron runs from an external scheduler
(see the cron section above — `vercel.json` declares none on purpose).
