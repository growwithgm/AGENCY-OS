# Ledger

A capacity-aware work operating system for one person running a small
e-commerce marketing agency alone.

Most task apps answer *what tasks exist*. This one answers:

> **Can the work I have promised physically fit before its deadlines?**

Everything else is in service of that question. The operator finds out he is
over-committed while there is still time to act.

- Rules the system will not break: [`docs/INVARIANTS.md`](docs/INVARIANTS.md)
- Visual contract: [`docs/design-reference.html`](docs/design-reference.html)

## Stack

Next.js (App Router) · Supabase (Postgres, Auth, RLS) · Vercel · Kimi via
`runAI()`. One product, one database, one deployment.

## Layout

| Path | What it is |
|---|---|
| `src/engines/planner/` | The planning engine: slots, ordering, placement, at-risk, carry-forward |
| `src/engines/attention/` | Deterministic detection of conditions worth interrupting for |
| `src/engines/estimates/` | Estimate statistics — arithmetic, not a model |
| `src/data/` | Everything between the database and the engines |
| `src/ai/` | `runAI()`, job config, prompts, and each job with its fallback |
| `src/lib/` | Auth, Supabase clients, secrets, rate limiting, audit, formatting |
| `src/portal/` | Client request intake and the policy that guards it |
| `src/app/(operator)/` | Today, Capture, Inbox, Clients, Assistant, Work, Week, Availability |
| `src/app/portal/` | Client login, home, request form |
| `supabase/migrations/` | Schema, RLS, the three date fields |

## Setup

Full instructions, including the Supabase dashboard settings:
[`docs/SETUP.md`](docs/SETUP.md).

The short version:

1. Paste [`supabase/schema.sql`](supabase/schema.sql) into the Supabase SQL
   editor and run it. That one file is the whole database — tables, RLS,
   portal projections and seed data — and it is idempotent.
2. Turn on the Email provider, turn **off** email signups, and add
   `/auth/callback` to the redirect URLs.
3. `cp .env.example .env.local`, fill it in, `npm install && npm run dev`.
4. Sign in at `/login` with the address in `OPERATOR_EMAIL`.
5. Set your hours on `/availability`, add clients on `/clients`, and give
   their people portal access from each client's page.

`supabase/migrations/` holds the same schema as an ordered migration
history, for an existing database that already has data in it. A fresh
project only needs `schema.sql`.

Two cron jobs, authenticated with `x-cron-secret`: `/api/cron/nightly`
(02:00) generates recurring work, re-plans and refreshes signals;
`/api/cron/morning` (08:30) pushes attention signals, but only when any are
worth pushing. `/api/cron/ping` proves the secret works without doing
anything.

## Authentication

Supabase Auth, magic links, no passwords anywhere. Two identities, both
through RLS.

**Operator** — one allowlisted address. The role lives in the JWT's
`app_metadata`, which only the service-role key can write, so it cannot be
forged by the user it describes. Middleware protects every route, and every
server action re-checks the session because a server action is reachable by
direct POST.

**Client** — an address in `client_contacts`. The session carries
`client_id`; the portal reads through RLS and never touches the
service-role key. An unknown address gets the same "check your email"
screen as a known one.

The service-role key is used in exactly three places: cron, the MCP
endpoint, and the auth handshake, which has to look up identities before a
session exists.

## The three dates

The distinction is load-bearing and is never collapsed:

| Field | Meaning | Client sees it? |
|---|---|---|
| `client_requested_date` | What the client asked for | As their own request |
| `internal_target` | When the operator intends to do it | Never |
| `committed_date` | What the operator actually promised | Only when explicitly marked |

Work appearing under Thursday in the plan does not make the portal say
"delivery Thursday". Carry-forward moves `internal_target` and increments
`slid_count`; `committed_date` is untouched by any automatic process.

## Working without AI

Disable `MOONSHOT_API_KEY` and everything still works:

| Job | Fallback |
|---|---|
| `parse_capture` | The sentence becomes one draft item; client matched by name if it appears |
| `clarify_client_request` | A fixed three-question intake |
| `daily_brief` | The attention signals and figures, stated in order |
| `ask_advice` | The computed figures behind the question, without commentary |
| `draft_client_update` | A structured list of what actually happened |
| `estimate_insight` | The statistics sentence the engine already produced |

Nothing about capture, requests, planning, Today, the portal or approvals
depends on the provider being up.

## Tests

```bash
npm test        # 127 tests: engines, policies, invariants, fallbacks
npm run typecheck
npm run build
```

The invariant tests in `src/data/invariants.test.ts` assert the rules from
`docs/INVARIANTS.md` directly, so breaking one fails the build rather than
production.
