/**
 * One request, in three panels: what they said, what was asked back, and
 * where the work would actually land.
 *
 * The third panel is arithmetic over the schedule — zones, the planner, and
 * recorded actuals. No model is involved anywhere on this page (INV-2).
 */

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOperator } from '@/lib/auth';
import { getRequest, type ClientRequest, type RequestState } from '@/data/requests';
import { getClient, listClients } from '@/data/clients';
import { getWork } from '@/data/work';
import { listZones } from '@/data/zones';
import { HORIZON_DAYS, loadPlanInputs } from '@/data/planning';
import { plan } from '@/engines/planner/plan';
import { generateZonedSlots, modeCapacity, type ZonedSlot } from '@/engines/planner/zones';
import { MODES, MODE_MIN_MINUTES, type AtRiskItem, type WorkMode } from '@/engines/planner/types';
import { MIN_SAMPLES } from '@/engines/estimates/learn';
import { MODE_LABELS } from '@/data/types';
import { clockTime, hm, relativePhrase, shortDate } from '@/lib/format';
import { ClientName, ModeChip, PriorityMark } from '@/components/marks';
import { ApproveForm } from '../ApproveForm';
import { askOneMoreQuestionAction, declineRequestAction } from '../actions';

export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<RequestState, string> = {
  clarifying: 'Clarifying',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Declined',
  expired: 'Expired',
};

const STATE_CHIP: Record<RequestState, string> = {
  clarifying: 'chip--waiting',
  pending_approval: 'chip--pending',
  approved: 'chip--done',
  rejected: 'chip--blocked',
  expired: 'chip--scheduled',
};

const RISK_REASON: Record<AtRiskItem['reason'], string> = {
  no_capacity_before_date: 'no room before its date',
  no_capacity_in_horizon: 'no room in the next two weeks',
  dependency_at_risk: 'waiting on something that is itself at risk',
  dependency_cycle: 'caught in a loop of dependencies',
  no_zone_accepts_mode: 'no zone in the week accepts that kind of work',
  no_block_large_enough: 'no unbroken block big enough',
  commitment_needs_buffer: 'too close to its promised date to be safe',
};

/**
 * Reference class for estimates: past work with a recorded actual, read
 * straight from the append-only estimate history.
 */
type HistoryRow = {
  id: string;
  task_id: string;
  est_minutes: number;
  actual_minutes: number | null;
  mode: string | null;
  title: string | null;
  client_id: string | null;
  created_at: string;
};

async function readHistory(db: SupabaseClient): Promise<HistoryRow[]> {
  const { data } = await db.from('estimate_history')
    .select('id, task_id, est_minutes, actual_minutes, mode, title, client_id, created_at')
    .not('mode', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  return (data ?? []) as HistoryRow[];
}

type Distribution =
  | { enough: true; samples: number; fastest: number; median: number; slowest: number }
  | { enough: false; samples: number };

/** Under the sample floor there is no distribution to show, and we say so (INV-10). */
function distributionFor(rows: HistoryRow[], mode: WorkMode): Distribution {
  const minutes = rows
    .filter((r) => r.mode === mode && r.actual_minutes !== null && r.actual_minutes > 0)
    .map((r) => r.actual_minutes as number)
    .sort((a, b) => a - b);

  if (minutes.length < MIN_SAMPLES) return { enough: false, samples: minutes.length };

  const mid = Math.floor(minutes.length / 2);
  const median = minutes.length % 2
    ? minutes[mid]
    : Math.round((minutes[mid - 1] + minutes[mid]) / 2);

  return {
    enough: true,
    samples: minutes.length,
    fastest: minutes[0],
    median,
    slowest: minutes[minutes.length - 1],
  };
}

/** The kind of hour this client's work has usually needed. A suggestion, nothing more. */
function modeFromHistory(rows: HistoryRow[], clientId: string): WorkMode | null {
  const counts = new Map<WorkMode, number>();
  for (const row of rows) {
    if (row.client_id !== clientId) continue;
    const mode = row.mode as WorkMode;
    if (!MODES.includes(mode)) continue;
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }

  let best: WorkMode | null = null;
  for (const mode of MODES) {
    const count = counts.get(mode) ?? 0;
    if (count > 0 && (best === null || count > (counts.get(best) ?? 0))) best = mode;
  }
  return best;
}

const slotMinutes = (slot: ZonedSlot) => (slot.end.getTime() - slot.start.getTime()) / 60_000;

/** Their transcript, paired up: each question with the answer that followed it. */
function pairUp(transcript: ClientRequest['transcript']) {
  const pairs: { question: string | null; answer: string | null }[] = [];
  for (const entry of transcript ?? []) {
    if (entry.role === 'assistant') {
      pairs.push({ question: entry.content, answer: null });
      continue;
    }
    const last = pairs[pairs.length - 1];
    if (last && last.answer === null) last.answer = entry.content;
    else pairs.push({ question: null, answer: entry.content });
  }
  return pairs;
}

export default async function RequestDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireOperator();

  const request = await getRequest(supabase, id);
  if (!request) notFound();

  const now = new Date();
  const [client, clients, history, zones, planInput] = await Promise.all([
    getClient(supabase, request.client_id),
    listClients(supabase),
    readHistory(supabase),
    listZones(supabase),
    loadPlanInputs(supabase, now),
  ]);

  const open = request.state === 'pending_approval' || request.state === 'clarifying';
  const decided = !open;

  // Mode: confirmed by a click, or merely suggested from this client's history.
  const asked = typeof query.mode === 'string' ? query.mode as WorkMode : null;
  const confirmedMode = asked && MODES.includes(asked) ? asked : null;
  const suggestedMode = modeFromHistory(history, request.client_id);
  const mode = confirmedMode ?? suggestedMode;

  const requestedDate = request.draft?.requested_date ?? null;
  const distribution = mode ? distributionFor(history, mode) : null;

  const slots = generateZonedSlots(
    now, HORIZON_DAYS, zones, planInput.blackouts, planInput.fixedBlocks, planInput.capacityRules,
  );
  const earliest = mode
    ? slots.find((s) => s.modes.includes(mode) && slotMinutes(s) >= MODE_MIN_MINUTES[mode]) ?? null
    : null;

  // Capacity per day comes from the engine — this page never counts minutes itself.
  const days = [...new Set(slots.map((s) => s.day))].sort();
  const freeBeforeAsked = mode && requestedDate
    ? days.filter((d) => d <= requestedDate)
      .reduce((total, day) => total + modeCapacity(slots, day, mode), 0)
    : null;

  const needed = distribution?.enough ? distribution.median : null;
  const fits = freeBeforeAsked !== null && needed !== null ? freeBeforeAsked >= needed : null;
  const shortBy = fits === false && needed !== null && freeBeforeAsked !== null
    ? needed - freeBeforeAsked
    : 0;

  const atRisk = plan(planInput).atRisk;
  const clientName = (clientId: string) => clients.find((c) => c.id === clientId) ?? null;

  const createdWork = request.created_task_id
    ? await getWork(supabase, request.created_task_id)
    : null;

  const draftTitle = request.draft?.title?.trim()
    || request.raw_input.replace(/\s+/g, ' ').trim().slice(0, 80);

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Request</div>
          <h1 className="page-title">
            <ClientName name={client?.name ?? request.clients?.name ?? null} colorIndex={client?.color_index} />
          </h1>
        </div>
        <a href="/requests" className="btn btn--sm">All requests</a>
      </div>

      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span className={`chip ${STATE_CHIP[request.state]}`}>{STATE_LABEL[request.state]}</span>
        <span className="tiny dim">
          asked <span className="num">{relativePhrase(request.created_at.slice(0, 10))}</span>
        </span>
        {/* Their own words about urgency and dates, kept as information (INV-1). */}
        {request.draft?.stated_urgency && (
          <span className="tag tag--info">they said: {request.draft.stated_urgency}</span>
        )}
        {requestedDate && (
          <span className="tag tag--info">
            asked for <span className="num">{shortDate(requestedDate)}</span>
          </span>
        )}
      </div>

      {/* ── 1 · Their own words ───────────────────────────────────────────
          The raw text is data. It is printed as text and read by nobody but
          the operator: it never selects a mode, a date or a priority. */}
      <div className="section-label"><span>1 · In their words</span></div>
      <section className="card card--accent">
        <blockquote
          style={{
            borderLeft: '3px solid var(--line)',
            paddingLeft: 12,
            fontFamily: 'var(--font-serif-stack)',
            fontSize: 17,
            fontStyle: 'italic',
            lineHeight: 1.55,
            color: 'var(--ink-700)',
            whiteSpace: 'pre-wrap',
            textWrap: 'pretty',
          }}
        >
          {request.raw_input}
        </blockquote>
        <p className="tiny dim" style={{ marginTop: 10 }}>
          Quoted exactly as they sent it. Everything below is yours to decide — nothing
          here sets it for you.
        </p>
      </section>

      {/* ── 2 · The exchange ── */}
      <div className="section-label"><span>2 · Questions and answers</span></div>
      <section className="card">
        {pairUp(request.transcript).length === 0 ? (
          <p className="small muted">Nothing has been asked yet.</p>
        ) : (
          <div className="rows">
            {pairUp(request.transcript).map((pair, i) => (
              <div key={i} className="rows__row" style={{ display: 'block' }}>
                {pair.question && (
                  <>
                    <div className="tiny dim">You asked</div>
                    <div className="small" style={{ marginBottom: 6 }}>{pair.question}</div>
                  </>
                )}
                {pair.answer ? (
                  <>
                    <div className="tiny dim">{pair.question ? 'They answered' : 'They added'}</div>
                    <div style={{ fontSize: 13.5 }}>{pair.answer}</div>
                  </>
                ) : (
                  <div className="tiny" style={{ color: 'var(--amber)' }}>No answer yet.</div>
                )}
              </div>
            ))}
          </div>
        )}

        {open && (
          <form action={askOneMoreQuestionAction} className="stack" style={{ marginTop: 14 }}>
            <input type="hidden" name="request_id" value={request.id} />
            <div className="field">
              <label className="label" htmlFor="question">Ask them one more question</label>
              <input
                id="question"
                name="question"
                className="input"
                required
                maxLength={240}
                placeholder="What date do you actually need this by?"
              />
              <span className="tiny dim">
                One question at a time. Sending it hands the request back to them until
                they answer.
              </span>
            </div>
            <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }}>Send it</button>
          </form>
        )}
      </section>

      {/* ── 3 · Placement, computed ── */}
      {open && (
        <>
          <div className="section-label"><span>3 · Suggested placement — computed</span></div>
          <section className="card">
            <p className="tiny dim" style={{ marginBottom: 12 }}>
              Every number here comes from your zones, your recorded hours and the planner.
              Same inputs, same answer, every time — nothing on this panel is generated.
            </p>

            <div className="field" style={{ marginBottom: 12 }}>
              <span className="label">
                Mode {confirmedMode ? '— confirmed' : '— suggested, yours to confirm'}
              </span>
              <div className="chips">
                {MODES.map((option) => (
                  <a
                    key={option}
                    href={`/requests/${request.id}?mode=${option}`}
                    className={`choice${mode === option ? ' choice--on' : ''}`}
                    aria-current={confirmedMode === option ? 'true' : undefined}
                  >
                    {MODE_LABELS[option]}
                  </a>
                ))}
              </div>
              <span className="tiny dim">
                {confirmedMode
                  ? 'The numbers below follow this choice.'
                  : suggestedMode
                    ? <>Most of this client&rsquo;s recorded work has been <ModeChip mode={suggestedMode} />. Confirm it or pick another.</>
                    : 'No recorded history for this client yet — pick the kind of hour this needs.'}
              </span>
            </div>

            {mode ? (
              <div className="rows">
                <div className="rows__row">
                  <span>Kind of hour</span>
                  <ModeChip mode={mode} />
                </div>

                <div className="rows__row">
                  <span>
                    Estimate from similar work
                    {distribution?.enough && (
                      <span className="tiny dim"> · median of <span className="num">{distribution.samples}</span> recorded jobs</span>
                    )}
                  </span>
                  <span className="num">
                    {distribution?.enough ? hm(distribution.median) : '—'}
                  </span>
                </div>

                {distribution?.enough ? (
                  <div className="rows__row">
                    <span className="small dim">Fastest / slowest of those</span>
                    <span className="num small dim">
                      {hm(distribution.fastest)} … {hm(distribution.slowest)}
                    </span>
                  </div>
                ) : (
                  <div className="rows__row">
                    <span className="small dim">
                      Not enough similar work yet to compare
                      {distribution && distribution.samples > 0 && (
                        <> — <span className="num">{distribution.samples}</span> of the <span className="num">{MIN_SAMPLES}</span> needed.</>
                      )}
                    </span>
                    <span className="small dim">Your estimate stands alone</span>
                  </div>
                )}

                <div className="rows__row">
                  <span>
                    Earliest window that admits it
                    <span className="tiny dim"> · at least <span className="num">{hm(MODE_MIN_MINUTES[mode])}</span> unbroken</span>
                  </span>
                  <span className="num">
                    {earliest
                      ? `${shortDate(earliest.day)} · ${clockTime(earliest.start.toISOString())}–${clockTime(earliest.end.toISOString())}`
                      : '—'}
                  </span>
                </div>

                {!earliest && (
                  <div className="rows__row">
                    <span className="small risk-text">
                      No zone in the next <span className="num">{HORIZON_DAYS}</span> days has an unbroken
                      {' '}<span className="num">{hm(MODE_MIN_MINUTES[mode])}</span> that admits {MODE_LABELS[mode].toLowerCase()} work.
                    </span>
                  </div>
                )}

                {requestedDate ? (
                  <div className="rows__row">
                    <span>They asked for <span className="num">{shortDate(requestedDate)}</span></span>
                    <span className={`num${fits === false ? ' risk-text' : ''}`}>
                      {freeBeforeAsked !== null ? `${hm(freeBeforeAsked)} free before it` : '—'}
                    </span>
                  </div>
                ) : (
                  <div className="rows__row">
                    <span>They asked for no date</span>
                    <span className="small dim">Where it goes is yours</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="small muted">Pick a mode above and this fills in.</p>
            )}

            {mode && requestedDate && fits === true && (
              <div className="flag" style={{ marginTop: 12 }}>
                <span className="flag__dot" aria-hidden />
                <span>
                  It fits. <span className="num">{hm(freeBeforeAsked ?? 0)}</span> of
                  {' '}{MODE_LABELS[mode].toLowerCase()} time is free before <span className="num">{shortDate(requestedDate)}</span>,
                  and similar work has taken <span className="num">{hm(needed ?? 0)}</span>.
                </span>
              </div>
            )}

            {mode && requestedDate && fits === false && (
              <div className="flag flag--risk" style={{ marginTop: 12, display: 'block' }}>
                <p>
                  It does not fit. <span className="num">{shortDate(requestedDate)}</span> needs
                  {' '}<span className="num">{hm(needed ?? 0)}</span> of {MODE_LABELS[mode].toLowerCase()} time
                  and only <span className="num">{hm(freeBeforeAsked ?? 0)}</span> is free before then —
                  {' '}<span className="num">{hm(shortBy)}</span> short.
                </p>
                <p style={{ marginTop: 8 }}>
                  {atRisk.length > 0
                    ? 'Taking that date means moving work that is already short of room:'
                    : 'Nothing else is at risk right now, so the shortfall comes out of this job itself. It cannot be finished by that date without more hours.'}
                </p>
                {atRisk.length > 0 && (
                  <div className="rows" style={{ marginTop: 4 }}>
                    {atRisk.map((item) => {
                      const owner = clientName(item.task.client_id);
                      return (
                        <div key={item.task.id} className="rows__row">
                          <span className="small">
                            <ClientName name={owner?.name ?? null} colorIndex={owner?.color_index} />
                            {' '}{item.task.title} — {RISK_REASON[item.reason]}
                          </span>
                          <span className="num small">{hm(item.minutes_unplaced)} unplaced</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {mode && requestedDate && fits === null && (
              <p className="tiny dim" style={{ marginTop: 12 }}>
                Without enough recorded work to compare against, nothing here can tell you
                whether <span className="num">{shortDate(requestedDate)}</span> is reachable. There is
                {' '}<span className="num">{hm(freeBeforeAsked ?? 0)}</span> of {MODE_LABELS[mode].toLowerCase()} time
                free before it — judge your estimate against that.
              </p>
            )}
          </section>
        </>
      )}

      {/* ── The decision ── */}
      {request.state === 'pending_approval' && (
        <>
          <div className="section-label"><span>Approve</span></div>
          <ApproveForm
            requestId={request.id}
            defaultTitle={draftTitle}
            confirmedMode={confirmedMode}
            suggestedMinutes={distribution?.enough ? distribution.median : null}
            requestedDate={requestedDate}
          />

          <div className="section-label"><span>Or not</span></div>
          <details>
            <summary className="btn btn--sm" style={{ display: 'inline-flex' }}>Decline this request</summary>
            <form action={declineRequestAction} className="stack" style={{ marginTop: 12 }}>
              <input type="hidden" name="request_id" value={request.id} />
              <div className="field">
                <label className="label" htmlFor="note">Why you are saying no</label>
                <textarea id="note" name="note" required rows={3} className="input" />
                <span className="tiny dim">
                  Required. Even when they never read it, you will want to know in six months.
                </span>
              </div>
              <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input type="checkbox" name="show_to_client" />
                <span className="small">Show this reason to the client</span>
              </label>
              <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }}>Decline</button>
            </form>
          </details>
        </>
      )}

      {request.state === 'clarifying' && (
        <div className="card card--wait" style={{ marginTop: 14 }}>
          <p className="small">
            This one is back with them. When they answer it returns here for your decision.
          </p>
        </div>
      )}

      {decided && (
        <>
          <div className="section-label"><span>Outcome</span></div>
          <div className="card">
            {request.state === 'approved' && createdWork && (
              <>
                <div className="spread">
                  <a href={`/work/${createdWork.id}`} style={{ fontWeight: 500 }}>{createdWork.title}</a>
                  <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <PriorityMark priority={createdWork.priority} />
                    <ModeChip mode={createdWork.mode} />
                    <span className="num small">{hm(createdWork.est_minutes ?? 0)}</span>
                  </span>
                </div>
                <p className="tiny dim" style={{ marginTop: 8 }}>
                  Approved and planned. {createdWork.committed_date
                    ? <>Promised for <span className="num">{shortDate(createdWork.committed_date)}</span>.</>
                    : 'No date was promised.'}
                </p>
              </>
            )}

            {request.state === 'approved' && !createdWork && (
              <p className="small muted">Approved. The work item it created is no longer there.</p>
            )}

            {request.state === 'rejected' && (
              <>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{request.operator_note}</p>
                <p className="tiny dim" style={{ marginTop: 8 }}>
                  Declined. {request.operator_note_visible
                    ? 'This reason is shown to the client.'
                    : 'This reason stays with you.'}
                </p>
              </>
            )}

            {request.state === 'expired' && (
              <p className="small muted">
                This one expired without a decision. Nothing was created and nobody was told.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
