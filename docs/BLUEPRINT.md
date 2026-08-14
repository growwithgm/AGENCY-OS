# Agency OS — what it is and why

One person runs a small agency. Four or five brands, all of them wanting
things, all of them reasonable on their own. The failure is never a
forgotten task; it is saying yes to a Thursday that was already full, and
finding out on Wednesday night.

Every decision in this system follows from that one sentence.

---

## 1. The shape of the thing

Two surfaces, one database.

**The agency side** is a cockpit: dense, dark-on-light, every number in a
monospaced face because numbers are what you steer by. It is for one
person and it assumes they are busy.

**The client portal** is a letter: serif prose, generous space, written in
the client's own language. It exists so a client does not have to ask "how
is it going", and so the answer they get is one the operator actually
stands behind.

A screenshot of either should tell you instantly which one it is.

---

## 2. Capacity is the product

A task list says what exists. This says what fits.

A day is not a bucket of minutes — it is a sequence of **zones**, each
admitting certain **modes** of work:

| Zone | Hours | Admits |
|---|---|---|
| Operations | 09:00–12:00 | operational |
| Admin | 13:00–17:00 | analytical, operational |
| Peak | 21:00–00:30 | creative, technical |

Peak crosses midnight and still belongs to the day it starts on, because
that is how a night owl's day actually works.

Each mode has a minimum unbroken block — 90 minutes for creative and
technical, 45 for analytical, 15 for operational. Deep work is placed
whole or not at all: a 20-minute sliver of creative work is a lie about
what creative work is. Within a zone, work of the same mode is placed
contiguously before the zone switches, and the number of switches per day
is counted and shown, because a scattered day costs hours that no capacity
figure reports.

Any block of 90 minutes or more is followed by 15 minutes that no work may
claim.

**The capacity rail** is the signature element: a track sized to the day's
available minutes, ended by a hard limit line, with overflow drawn as a
striped red segment extending *past* it. Work that exists but has nowhere
to go should look exactly that wrong.

Planning is deterministic. Strict lexicographic ordering — priority, then
commitment, then rotation, then target, then age — never a score. Scores
invite tuning, and tuned weights are exactly the automatic prioritisation
this product refuses to have.

---

## 3. Three dates, never collapsed

| Field | Means | Who sees it |
|---|---|---|
| `client_requested_date` | what they asked for | nobody is bound by it |
| `internal_target` | when you mean to do it | you only |
| `committed_date` | what you promised | the client |

Carry-forward moves the target and counts the move. It never touches the
commitment: the plan can move, the promise cannot.

Commitments are tested against the **safe estimate** — the likely estimate
multiplied by how much that mode of work has genuinely overrun, floored at
1.25×. A promise that only holds if nothing goes wrong is flagged, not
trusted.

---

## 4. Estimation from the record

Before an estimate is typed, the screen shows what work like it has
actually taken: fastest, median, slowest, and how far the operator's own
estimates have sat from reality. Under five samples it says there is not
enough evidence and shows nothing — a distribution drawn from three jobs
looks like evidence and is not.

Estimating below the median asks for one line saying what makes this one
faster. An overrun past 1.25× asks one chip question, once, while the
answer is still known. Skip writes nothing: an invented reason poisons the
only evidence the weekly review has.

Completing without entering minutes records that there is no evidence
rather than a zero. Honesty about a gap beats a number that drags every
future median down.

---

## 5. What the client sees

Work marked visible appears in the portal the moment it is saved, under
"Approved and coming up", carrying a New marker for 48 hours. It shows the
client-facing title and a status.

It never shows an estimate, an internal date, a priority, a mode, or how
many times it has moved. Those are not columns of the portal projections
at all — row filtering can be worked around by a clever query, a missing
column cannot.

Dates appear **only** where a commitment was made. No commitment, no date:
not "soon", not a range. Silence is correct.

Appearing and notifying are separate. A client sees everything in the
portal; whether they are *told* is a per-client setting — never, a weekly
Friday digest (the default), or every new item.

---

## 6. Requests

A client asks in their own words. The system asks up to three short
clarifying questions and parks it. Their raw text is data, never
instruction — it is displayed, never interpreted as a command.

The review screen shows the original words, the exchange, and a
**computed** placement panel: suggested mode, the median from history,
the earliest valid window, and whether their date fits — and if not,
exactly what would have to move. Every figure there comes from the
scheduler. The AI writes one line of rationale and nothing else.

Approving requires a priority, and the chips start empty.

---

## 7. The assistant, and its fence

The assistant has tools and uses them. It is a faster path to things the
UI can already do, never the only path.

**Direct** — executes, reports, undoable for 30 seconds: create and edit
work, complete, block, move, start, split, blackouts, recurrence, report
drafts, navigation, and every read-only scheduling question.

**Fenced** — proposes only: set or change a priority, commit to or change
a date, approve or decline a request, publish, delete, cancel, archive a
client, revoke access, change the zones.

The fence is structural. Fenced names are never in the tool list the model
receives, so no phrasing — "just do it", "you decide", an earlier standing
instruction — can reach one. They come back as panels with an Apply button
that calls an ordinary authenticated action.

The dividing line: what affects only the operator is direct; what reaches
a client, or sets priority, is fenced. Priority is fenced because it is
the scheduler's primary input — a model that can set it can rewrite the
whole plan by implication.

The standing constraints live in the tool implementations, not the prompt:
work is not placed where its mode is not admitted, blocks below the
minimum are refused, in-progress work is not moved unless named. A refusal
returns the rule and the nearest valid alternative.

**The diff** is how any proposed change is shown, always in the same
order: what moves, everything else that shifts (all of it, never
truncated), capacity before and after, and — separately, never buried —
any commitment this would now miss. Applying something that misses a
commitment requires a second confirmation naming the client and the date.

The assistant may never state a number a tool did not return. Facts and
diffs render from tool output, not from the prose.

---

## 8. Notifications

Three delivery windows: 09:00, 13:00, 18:00. Anything not urgent waits and
arrives combined. Two things break through: a committed deadline becoming
impossible, and a client request naming a date inside 48 hours.

**Peak is a hard blackout.** Nothing is delivered during it, urgent
included. Peak is the only stretch of the day where deep work is possible;
an interruption there destroys more than it saves.

---

## 9. When the AI is down

Every AI job has a deterministic fallback and says so on screen where it
matters. Capture becomes a structured form. The briefing becomes the facts
without narration. The assistant is the one deliberately AI-only surface —
the product is AI-based by decision, so a failed turn shows as a plain
"that didn't work, try again" note in the conversation rather than a
different interface; every fact it would have narrated is still on the
screens themselves. No page fails because a provider is unavailable.

---

## 10. What this is not

No Kanban, no Gantt, no percentage-complete, no automatic priority
scoring, no AI acting outside the fence, no client chat, no invoicing, no
CRM, no analytics dashboards, no imported metrics, no dark-mode toggle, no
theme picker, no i18n framework, no vector database, no microservices.

External services, all optional except the database: Supabase, Kimi
(LLM), Groq (transcription), Resend (email transport), Web Push. None of
them is a source of business data.

---

## 11. The rules that hold it together

Fifteen invariants in [INVARIANTS.md](INVARIANTS.md). They are not
trade-offs. If a change requires breaking one, the change is wrong.

The three that carry the most weight:

- **Priority is the operator's alone.** Nothing infers it.
- **Nothing is a promise unless the operator made it one.**
- **A client sees no internal figure, ever** — enforced by the shape of
  the data, not by the shape of the UI.
