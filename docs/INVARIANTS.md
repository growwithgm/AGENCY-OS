# Invariants

Rules that must never break. Code that touches any of these should reference
the number in a comment (`// INV-3`).

Breaking one of these is not a bug to be traded off against a feature. If a
change requires breaking one, the change is wrong.

---

**INV-1 — Only the operator sets priority.**
AI never assigns or changes it. Client-stated urgency is displayed as a grey
informational tag, never mapped onto priority.

**INV-2 — Scheduling is deterministic.**
Same inputs produce the same plan every time. There is no AI anywhere in the
scheduling path. `src/engines/planner/` contains no AI calls.

**INV-3 — A client request never consumes capacity until the operator
approves it.** Requests and work items are different things in different
tables. `client_requests` is never read by the planner.

**INV-4 — AI output never writes to authoritative data.**
It proposes; code validates; the human confirms. AI results live in draft
records until an operator action promotes them.

**INV-5 — Moving planned work never changes its commitment date.**
Carry-forward moves `internal_target` and increments `slid_count`.
`committed_date` is untouched by any automatic process.

**INV-6 — Nothing is a client promise unless the operator explicitly made it
one.** `committed_date` is only ever set by an explicit operator action.

**INV-7 — No AI-written client-facing text is published without operator
approval.** `client_updates` moves draft → approved → published, and only an
operator action advances it.

**INV-8 — Every client-scoped read is authorised on the server** against that
client's identity, through RLS. Hiding UI is not security.

**INV-9 — Every operator capability requires a server-side operator check.**
Middleware is not sufficient; every server action and route re-checks.

**INV-10 — If a fact is missing, say so.** Never estimate an outcome from
nothing. Under ~5 samples the estimate engine reports insufficient data rather
than a number.

**INV-11 — If the AI is down, everything else still works.** Capture review,
requests, schedule, recurrence, Today, portal, approvals and attention rules
all have deterministic paths. Every AI job has a fallback.

**INV-12 — History is preserved.** Original estimates, original commitments
and actuals are never overwritten. Revisions append to `estimate_history`;
published updates are immutable and corrections create a new version.

**INV-13 — The assistant cannot reach a fenced action.**
Actions that touch a client, set a priority, destroy work or redefine the day
are never placed in the tool list the model is given. They exist only as
proposal builders whose output is a panel the operator taps. No phrasing,
standing instruction or setting creates a path from model output to one of
them. `src/assistant/registry.test.ts` asserts this.

**INV-14 — A client sees no internal figure, ever.**
Estimates, safe estimates, internal targets, priorities, modes and slip counts
are not columns of the portal projections at all — row filtering can be worked
around by a clever query, a missing column cannot.
`scripts/verify-portal-isolation.sql` proves it against a real database.

**INV-15 — Nothing is delivered during peak.**
Notifications wait for a delivery window and arrive combined; during a peak
zone nothing is delivered at all, urgent included. It waits for the zone to
end.
