# Agency OS — Live Test Report

**Target:** https://agency-os-rouge-six.vercel.app
**Date:** 2026-08-13
**Operator account used:** persnol.gm@gmail.com (session already active in the browser)
**Method:** Real-user testing in a live Chrome session (operator side) + Playwright/headless Chromium
for anonymous, client-portal, and adversarial checks. A throwaway client login
(`qa-ibban-portal@example.com`) was created to exercise the portal, then removed.
**Spec source:** `docs/BLUEPRINT.md` (+ INVARIANTS.md) in `growwithgm/AGENCY-OS`
(branch `claude/agency-os-blueprint-vjt3uq`).

Screenshots referenced below live in the QA scratchpad folder `qa/report-shots/`
(filenames given per issue).

---

## 1. Summary

| Bucket | Count |
|---|---|
| **Total checks run** | 64 |
| **PASS** | 44 |
| **PARTIAL** | 9 |
| **FAIL / BROKEN** | 7 |
| **Not verifiable in current state** | 4 |

**Headline:** The security and data-isolation spine is strong — anonymous redirects,
generic login errors (no enumeration), client→operator route/API lockout, portal internal-field
hiding, prompt-injection inertness, and the request rate-limit all pass. The scheduler,
capture, work-item, requests, and estimation surfaces are well built and match the blueprint
closely.

**Two features are outright broken:** the **Assistant** ("Ask") throws a server-side exception
on every submission, and the **Weekly Review** route (`/review`) returns 404. Because the
assistant never responds, the single most important spec requirement — that the assistant
**refuses** to change priority — could not be exercised through the UI (the fenced-action
architecture is present in the request-approval flow, but the assistant chat itself is down).

There is no CRITICAL security or data-leak finding.

---

## 2. CRITICAL (security / data leak — fix immediately)

**None found.** All security-sensitive checks passed. Notable positives (evidence in §7):

- No user enumeration; identical generic error for unknown vs. real email.
- Client session cannot reach any operator route (all redirect to `/portal`) or operator API (`401`).
- Portal never exposes estimate / priority / internal date / scheduled day — verified by DOM/page-source
  scan, not just visually. The only `priority` string in the portal HTML is `fetchpriority="low"` on a
  preload tag, not a data value.
- Prompt injection in a client request is inert: it lands as quoted data marked *"nothing here sets it
  for you"*, stays **PENDING APPROVAL**, and priority chips start empty.

---

## 3. BROKEN (feature does not work)

### 3.1 Assistant "Ask" throws a server-side exception (500) — *BROKEN*
- **Spec:** §6 Assistant (chat, tools, DIRECT/CONFIRM, diffs, refusals).
- **Steps:** Open Assistant → type any question (e.g. *"What should I do first today?"*, or
  *"Change the priority of the ibBan creatives to critical"*) → click **Ask**.
- **Expected:** An answer / facts panel, or (for priority) a refusal.
- **Got:** *"Application error: a server-side exception has occurred … Digest: 1939385745@E352"*.
  Reproduced 3× (deterministic same digest). Console: *"An error occurred in the Server Components render."*
  On one attempt it silently reset with no answer instead of crashing — so at best the Ask never returns
  a visible response, at worst it takes down the route.
- **Consequence:** The entire Assistant spec section is untestable through the UI: zone-aware answers,
  the 4-section DIFF (MOVING / KNOCK-ON / CAPACITY / COMMITMENTS), the 30 s Undo toast, the committed-miss
  second confirmation, the empty-message regression, and — most importantly — the **priority-change
  refusal** (§6.1, the "sab se ahem" test). The page header reads **"ADVISORY ONLY,"** suggesting the
  deployed assistant may not carry execution tools at all, but that cannot be confirmed while every Ask 500s.
- **Screenshot:** `assistant-server-error.jpg`

### 3.2 Weekly Review `/review` returns 404 — *BROKEN / SPEC GAP*
- **Spec:** §8.3 — `/review` Friday screen with committed-vs-delivered, hours by mode/client, mode switches,
  peak used vs available, estimate accuracy + overrun factor, overrun reasons, visibility, slippage.
- **Steps:** Click **Review** in the operator nav (or open `/review` directly).
- **Expected:** The review screen renders (empty data is fine).
- **Got:** Next.js **404 — "This page could not be found."** The nav item links straight to a route that
  does not exist. Checklist item "/review ke saare sections render hote hain" therefore **FAILS**.
- **Screenshot:** `review-404.jpg`

### 3.3 Expired-session form submit → client-side exception (ungraceful) — *BROKEN (robustness)*
- **Spec:** §2 session handling; general "no page may hard-fail."
- **Steps:** Log in as client → open `/portal/account` → delete session cookies → submit the change-password form.
- **Expected:** Graceful redirect to `/login` ("your session expired, sign in again").
- **Got:** *"Application error: a client-side exception has occurred."* (Direct navigation to `/portal`
  after clearing cookies **does** correctly redirect to `/login`, so route protection is fine — only the
  in-page authenticated form submit crashes instead of re-authing.) The action does not succeed, so this is
  a UX/robustness bug, not a security hole.

---

## 4. SPEC GAP (in the plan, missing or built differently)

### 4.1 Multi-task capture is **not split** into separate cards — *FAIL*
- **Spec:** §7.1 — "Multi-task input → one card per task, each confirmed independently … '2 items added — 1 for
  ibBan, 1 for Don Cabello.'"
- **Steps (2 attempts):**
  (a) *"ibban creatives need doing before friday and also don cabello pricing page still isnt updated"*
  (b) *"Design a new logo for ibBan. Send the monthly performance report to Don Cabello."*
- **Expected:** Two cards (ibBan + Don Cabello).
- **Got:** A **single** interpretation card assigned to ibBan, with both tasks merged into one title and one
  client-facing wording. No split offered.
- **Screenshot:** `capture-interpretation-panel.jpg`

### 4.2 Capture mode almost always defaults to **Operational** (mis-classification) — *PARTIAL*
- **Spec:** §7.1 interpretation returns `mode`.
- **Got:** "Design a new logo," "Design … Instagram campaign creatives," and a generic task all came back as
  **Operational** by default. The operator can fix it manually (the chip works), and the request-approval
  flow *does* suggest CREATIVE correctly from client history — but the capture-time AI mode guess is
  effectively always "operational."

### 4.3 Weekly digest / Updates split-view & publish flow — *PARTIAL (not exercisable)*
- **Spec:** §8.1 — draft split view ("What they will read" / "Built from"), publish audience, immutable +
  version history.
- **Got:** `/updates` renders with the correct structure and copy (WAITING FOR YOU describes the split view;
  PUBLISHED says *"stays exactly as it was sent"*), but there are **no drafts** to open — drafts are generated
  by the weekly cron from completed work, so the split view, publish-confirmation audience, and
  immutability/versioning could not be functionally tested.

### 4.4 Operator side is **light**, not the dark cockpit the checklist expects — *PARTIAL / by-blueprint*
- **Checklist:** "Operator side dark, portal warm light."
- **Got:** Operator `body` background is `rgb(233,237,240)` (light grey), sidebar `rgb(243,246,248)` — a
  **light** dense-mono cockpit, not `--ink-900` dark. Note: `BLUEPRINT.md` itself says the agency side is
  *"dark-on-light"* (dark text on light), which the app matches; the **rebuild prompt** and prototype called
  for a dark background. The two sides are still instantly distinguishable (operator = cool grey + mono;
  portal = warm serif Spanish prose), so the "screenshot reveals which side" intent holds. Flagging the
  divergence from the checklist wording.
- **Screenshots:** `today-operator-home.jpg` vs `uiux-portal-desktop.png`

### 4.5 Portal is a single page, not `/portal/*` sub-routes — *PARTIAL (cosmetic)*
- **Spec:** §1 lists `/portal/*`. Implemented as one `/portal` page + `/portal/account` + `/portal/request`.
  `/portal/work`, `/portal/requests`, `/portal/work/[id]` all 404. Not a leak (portal shows only the client's
  own data), just a structural difference; deep-linking to a portal work item isn't supported.

---

## 5. UX ISSUES (works, but rough)

### 5.1 Captures persist to the Inbox before "Add work," contradicting the on-screen promise
- Capture page says **"Nothing is saved until you confirm."** In practice, running the AI interpretation
  ("Continue") and then navigating away **auto-parks** the capture into the Inbox ("YOUR CAPTURES"), where it
  survives reloads. No scheduled *work* is created before "Add work" (verified: Work list stayed empty after
  Discard), and captures are removable via **Discard** — so the data-integrity intent holds — but the literal
  "nothing is saved" copy is misleading. `inbox-parked-captures.jpg`

### 5.2 The "Requests" nav badge counts Inbox items, while the Requests page says "nobody asked yet"
- With 3 parked captures and 0 client requests, the **Requests** badge read **3** while the Requests screen
  said *"Nobody has asked you for anything yet."* The badge appears to count Inbox/actionable items generally;
  placing that number on "Requests" is confusing.

### 5.3 Expired-session crash — see §3.3 (also a UX failure: raw error instead of re-login prompt).

### 5.4 A 5000-char capture renders full-length in the Inbox card
- The adversarial 5000-char capture was handled correctly by the parser (title truncated with "…", no crash),
  but its **Inbox card renders the entire 5000 characters** with no clamp, producing an enormous card. Cosmetic.

### 5.5 Request sub-flow is English while the ibBan portal is Spanish
- Portal home renders in Spanish (EN CURSO / APROBADO Y POR HACER / NUEVO …), but `/portal/request`
  ("What do you need?", "1 OF 3 …") is English. Client-facing language should be consistent (§11).

### 5.6 A few secondary text links are below the 44 px tap target
- Login "Forgot password?" (14 px) and portal "Tu cuenta" / "Cerrar sesión" (14 px). Primary buttons are fine.

---

## 6. COSMETIC

- **Duplicate client** in seed data: "Cosmatics Afro Latino" *and* "Cosmetics Afro Latino" (spelling variants).
- Portal surface is a cool near-white (`rgb(247,248,250)`) rather than a distinctly **warm sand** (blueprint
  wanted warm-sand surfaces; warmth mostly lives in cards).
- The overflow card on Today labels an ibBan creative task as **"Internal"** in the "WILL NOT FIT" list even
  though the task belongs to ibBan — likely a mislabel in the overflow card header. `today-over-capacity-overflow.jpg`

---

## 7. PASSED (verified correct — condensed)

**Auth & session**
- Every route (`/`, `/work`, `/clients`, `/settings`, `/capture`, `/assistant`, `/updates`, `/requests`,
  `/portal`, `/clients/[id]`, `/work/[id]`) redirects an anonymous visitor to `/login`.
- Wrong password → single generic *"Email or password is incorrect."* Unknown email and the real operator
  email with a wrong password produce **byte-identical** pages → no user enumeration. `login-error-*.png`
- Operator lands on `/`, client lands on `/portal`. Client session hitting any operator route → `/portal`.
- `/api/push/subscribe|unsubscribe|test` without a session → **401 JSON** `{"error":"unauthorized"}` (not HTML).
  Same 401 with a valid *client* session.
- `/api/mcp` with a wrong secret and with no secret → **401 JSON**. `/api/transcribe` no session → 401 JSON.

**Client management (§3)**
- `/clients/[id]` → **Portal access** creates a login; the password is shown **once** (`c8db-bZNK-fwkx-zUST`
  format: 16 chars, unambiguous, grouped) with a **Copy** button and *"shown only once"* note.
- Contact row shows name · email · last-sign-in (updated from "Never" to "Last signed in 13 Aug" after login) ·
  Reset password / Disable / Remove. **Remove** shows an in-app confirmation naming the email+client, then
  deletes the login ("No logins yet").

**Capture (§7.1)**
- Interpretation ("UNDERSTOOD") panel with editable fields + "read without AI" fallback link.
- **Priority chips always start empty** (verified across 4 captures) — nothing pre-filled.
- Unknown client → header "Client not identified," *"Could not tell which client this is for. Please pick one,"*
  no chip pre-selected, **Add work disabled**. (Chips, not a literal empty dropdown, but the no-guess behaviour holds.)
- "Show to client" toggle (default ON) + "Client sees it as" (`client_title`) field present.
- "Internal — no client" option present. Nothing becomes *work* before **Add work** (Work list empty after Discard).
- Estimate > 3h shows the split suggestion; <5 samples shows *"No similar work … nothing to compare against."*

**Scheduler / Today (§2, §4)**
- Capacity rail shows **"OVER CAPACITY"** with a **striped red overflow segment extending past the limit line**;
  today **and** tomorrow (Fri 14 Aug) capacity both render. `today-over-capacity-overflow.jpg`
- Zones strip renders (Operations 09–12 / Admin 13–17 / Peak 21:00–00:30) with per-zone modes.
- **"0 mode switches today"** count shown beside the rail.
- **Operational never in Peak / Creative never in Operations:** a 4h creative could not be force-placed into
  daytime zones and went to **BACKLOG / WILL NOT FIT (AT RISK)** with the overflow surfaced (not hidden); the
  request-approval panel independently computed a creative's *"earliest window that admits it · at least 1h 30m
  unbroken: Thu 13 Aug · 21:00–00:30"* — i.e. the Peak zone, confirming both mode-zone placement and the 90-min
  minimum block.
- Overflow items are shown with a reason ("WILL NOT FIT" / "AT RISK"), not hidden.

**Work item (§3 dates, §5 estimation)**
- Three dates never collapsed: **THEY ASKED FOR / INTERNAL TARGET / COMMITTED** (with "Make the promise" +
  "Yes, I am promising this date to the client" checkbox). "Do this now" present.
- Estimate vs "ACTUAL SO FAR — " (em-dash, not 0h). Revising estimate requires a "WHY IT CHANGED" reason and
  **appends** to Estimate History (first estimate never overwritten).
- "Mark done" with empty minutes records **"no actual time recorded"** (skip honesty, §5.4) — confirmed after
  the double-tab test.
- Per-item Activity log ("Created today from something you captured").

**Requests (§6, §8.2)**
- Request detail: **IN THEIR WORDS** (raw text quoted, *"nothing here sets it for you"*), **QUESTIONS AND
  ANSWERS**, **SUGGESTED PLACEMENT — COMPUTED** (mode suggested / estimate from history / earliest valid window /
  "they asked for no date"), "Ask them one more question" (one at a time), and **APPROVE** with empty priority
  chips (*"Nothing sets this but you — not how the client phrased it, not the system"*), optional internal/committed
  dates, and "+ Split into another item."
- Client "Request work": max **3** clarifying questions ("1 OF 3 / 2 OF 3 / 3 OF 3"), one at a time; framed
  *"This is a request, not a commitment"* — never "scheduled." `portal-request-*.png`

**Client portal (§5) — isolation verified by DOM scan**
- Shows only the logged-in client's data; both freshly-marked-visible tasks appeared **immediately** with a
  **"NUEVO"** (New) marker.
- Page-source/DOM scan: `estimate`, `critical`, `minutes`, `internal target`, `scheduled`, `overrun`,
  `safe_minutes` all **absent**; no duration tokens or priority words in visible text; **no dates** on
  non-committed items (no "soon," no range). `portal-home.png`
- `/portal/account` change-password page present.

**Activity (§6.6)** — renders with actor filters All / Operator / Assistant / System and a designed empty state
(revert could not be tested — no logged assistant/diff actions, and the assistant is down).

**Updates (§8.1)** — page renders with WAITING FOR YOU (split-view description) and PUBLISHED
(*"stays exactly as it was sent"* immutability) sections.

**Adversarial (§Part 3)**
- Client JWT → operator API / routes: blocked (401 / redirect to portal). ✔
- Prompt injection in a request: inert — lands as **PENDING APPROVAL**, priority empty, nothing auto-executed. ✔
- 5000-char capture: parsed gracefully, title truncated, no crash. ✔
- Same task completed from two tabs: idempotent — ends **DONE** once, no duplication/corruption. ✔
- `/api/mcp` wrong/no secret: 401. ✔
- Client request rate limit: after a handful of requests the portal returns **"You've reached today's limit"**
  and blocks further submissions (attempts 4–8 all capped). ✔

**UI/UX (§Part 2)**
- No horizontal scroll on login or portal at 390 px or 1440 px.
- Fonts self-hosted and loading where used: Archivo + IBM Plex Mono (operator/login), Archivo + Source Serif 4
  (portal). No fallback failure.
- Inputs are 16 px (no iOS zoom). Duration format is consistently `1h`, `2h`, `3h 30m` — **no** "90 min"/"1.5h";
  empty is `—`, never `0h 0m`. Numbers in IBM Plex Mono, right-aligned.
- **0 console errors and 0 failed asset/API requests** on login and portal (mobile + desktop).

---

## Not verifiable in this state (needs data or the fixed feature)

1. Assistant refusal / diff / undo / committed-miss confirmation / empty-message regression — blocked by §3.1.
2. `/review` sections — blocked by §3.2 (404).
3. Updates draft split view / publish-audience / immutability + version — no drafts exist (weekly-cron generated).
4. Activity 24h revert — no assistant/diff actions were logged to revert.
5. Operator-side **mobile** layout (bottom-nav / capacity rail at 390 px): the operator side needs a session that
   only the live browser holds, and the browser runs on a 2560-wide display, so a true 390 px CSS viewport could
   not be forced. Operator navigation is a fixed **left sidebar** (no bottom nav observed).

---

## Test data left on the deployment (please clean up if unwanted)
- Work items on ibBan: *"Design the ibBan summer Instagram campaign creatives"* (now **DONE**), *"Reply to all
  ibBan admin emails and update the shipping spreadsheet"* (Scheduled).
- Client requests from the QA portal user: 1 injection-text request (PENDING APPROVAL), 1 in CLARIFYING, plus
  ~5 "Rate limit test request N" entries.
- The QA client login (`qa-ibban-portal@example.com`) was **removed** at the end of testing.
- All parked test captures were **Discarded**.

---

# Fix verification — 2026-08-13

All fixes are on branch `claude/agency-os-blueprint-vjt3uq`. After every fix
`npx tsc --noEmit`, `npx vitest run` and `npm run build` were kept green;
the suite grew from 200 to 240 tests. Schema changes were applied to a local
Postgres 16 on both a fresh and an upgraded database.

**A constraint on live verification, stated plainly.** The deployment
`agency-os-rouge-six.vercel.app` is not reachable from the build environment
— the network egress policy returns 403 for that host — so I could not drive
the live deployment with a browser myself, nor take deployment screenshots.
Anything needing an operator or client **session** on the deployment is
marked "verify on deploy" below with the exact steps. What I could verify —
tests, types, production build, local Postgres for SQL, and a real headless
Chromium against a locally-served build for the pages that need no session —
I did.

The report ran against an **older deployment**: its assistant read "ADVISORY
ONLY" and `/review` 404'd. The rebuild since then already carried a real
assistant and the `/review` route, so several items were confirmed-correct
rather than newly built.

| # | Item | What was actually wrong | How verified |
|---|---|---|---|
| 1a | Assistant 500 | Stale build. Current submit path and page render already fall back rather than throw when the provider is unreachable. Hardened further: a tool that throws mid-turn now becomes a refusal instead of aborting the turn. | `src/assistant/resilience.test.ts` (3 tests) — degrades when unconfigured, a throwing tool → refusal, fenced tool still refused. **Verify on deploy:** a plain question returns facts+answer; "change the priority of X to critical" (and "just do it"/"you decide") returns a panel, never a silent change; a schedule change shows the 4-section diff → Apply → Undo toast; an empty message returns one line and no offline panel. |
| 1b | `/review` 404 | Stale build — route exists now. The commitment tally was re-keyed on task id (title-matching could credit the wrong task) and every division on the page is guarded. | `src/data/review.test.ts` (8 tests), incl. shared-title and never-negative cases. **Verify on deploy:** `/review` renders with empty and with real data. |
| 1c | Expired-session form crash | Middleware redirected server-action POSTs to an HTML login page, which the action-response parser cannot read. Those POSTs now pass through to the action, which re-checks the session and calls `redirect()` itself. | Build + reasoning about the Next server-action protocol. **Verify on deploy:** sign in as a client, clear cookies, submit the change-password form → lands on `/login`, no client-side exception. |
| 2b | Capture mode always "operational" | Root cause found: the strict parse schema never listed `mode`/`client_title`/`confidence`, so the model was forbidden from returning a mode. All three added; mode constrained to the four values. | `src/ai/jobs/parseCapture.test.ts` (5 tests) guards the schema shape. **Verify on deploy:** "Design a logo" → creative; "send the monthly report" → analytical. |
| 2a | Multi-task capture not split | Schema and UI already supported N cards; the prompt now carries two explicit two-client examples and a split-when-in-doubt rule. | Build. **Verify on deploy:** the two report sentences each yield two cards. |
| 2c | Request flow English under Spanish portal | Static strings moved into the es/en dictionary; the page passes the client's locale. (AI-generated clarifying questions were already localised.) | Build + code. **Verify on deploy:** a Spanish client sees `/portal/request` in Spanish. |
| 3a | "Nothing is saved" was false | Copy now reads "nothing becomes work until you add it"; the inbox says the same. | Local headless Chromium on the served build. |
| 3b | Requests badge counted inbox items | Badge now counts only client requests; parked captures carry their own count on the capture button. | Code + build. **Verify on deploy:** park a capture with zero client requests → Requests badge stays empty, the + button shows a count. |
| 3c | 5000-char inbox card | Preview text clamped to two lines; opening the capture shows all of it. | Code (`.clamp-2`) + build. |
| 3d | Sub-44px tap targets | "Forgot password?" and the portal account/sign-out links are now 44px. | **Headless Chromium, measured:** forgot-password height = 44px; forgot-mode reachable; no horizontal overflow at 390px; 0 console errors. |
| 4b | Overflow item labelled "Internal" | The client lookup was built only from work planned today; an overflowing item whose client had nothing scheduled fell to the no-client label. Now reads from every client. | Code + build. **Verify on deploy:** an over-capacity day shows the real client on "will not fit" items. |
| 4c | Portal surface too cool | Portal ground token changed to warm sand (`#f4f0e6`). | Code + build. |
| — | **Rate-limiter race** (found in the parallel audit, not the report) | The count-then-insert was non-atomic: a burst of parallel sign-in attempts all read the count before any insert landed, so all passed a limit of 10. Now one `rate_limit_hit` DB function under a per-key advisory lock. | **Local Postgres, 50 truly-concurrent calls at limit 10 → exactly 10 allowed, 40 blocked, 10 rows inserted.** Migration `0013`. |

## Left for you to decide or run (deployment not reachable from here)

- **4a — duplicate client.** `scripts/qa-diagnose-duplicates.sql` lists both
  "Cosm(a/e)tics Afro Latino" rows with the amount of work, requests,
  updates and logins attached to each. It changes nothing — you pick which
  to keep; the merge/delete statements are included but commented.
- **QA test data cleanup.** `scripts/qa-cleanup.sql` previews then removes
  exactly the QA artefacts (the two ibBan test items, the injection and
  clarifying requests, the "Rate limit test request" entries), scoped by
  their test text so nothing real is touched.

Both are seed-free runtime data on your Supabase, which this environment
cannot reach — paste each into the Supabase SQL editor.

> **Superseded (language):** the portal was later made English-only by
> decision — the language setting and the Spanish dictionary were removed
> entirely, so 2c and 5.5 no longer apply.
