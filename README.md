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
psql -d <db> -f supabase/schema.sql                    # idempotent, safe to re-run
psql -d <db> -f scripts/verify-portal-isolation.sql    # proves a client sees only their own
```

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
RLS), Vitest. Deployed on Vercel; cron runs either from `vercel.json` or an
external scheduler.
