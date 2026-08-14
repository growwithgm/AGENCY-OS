'use client';

/**
 * The chat surface.
 *
 * Three rules shape everything below.
 *
 *   1. The prose is never the source of a number. Under every answer the
 *      facts panel is rendered from the tool results, and the diffs from the
 *      engine's own comparison — not from the sentences the model wrote.
 *   2. A fenced action is never performed by the model. Proposals arrive as
 *      panels; Apply calls an ordinary server action that re-reads the item
 *      and does the work itself.
 *   3. A failed turn reports itself in a line and the conversation
 *      carries on — there is no offline mode.
 *      the same deterministic questions, with no prose at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ChatMessage } from '@/ai/runAI';
import type { Proposal, Step } from '@/assistant/run';
import { DiffPanel } from '@/components/DiffPanel';
import { ClientName } from '@/components/marks';
import { hm, shortDate, clockTime, relativePhrase } from '@/lib/format';
import { MODE_LABELS, PRIORITY_LABELS, type WorkMode } from '@/data/types';
import {
  applyProposalAction, sendMessageAction, undoTurnAction,
  type ReadOnlyRequest, type ReadOnlyResult, type TurnResult, type UndoPayload,
} from './actions';


type Entry =
  | { id: number; kind: 'operator'; text: string }
  | { id: number; kind: 'assistant'; turn: TurnResult }
  | { id: number; kind: 'note'; text: string };

const STARTERS = [
  'What is the state of today?',
  'What should I cut this week?',
  'Which client am I neglecting?',
];

/** How long an undo stays offered before the turn becomes ordinary history. */
const UNDO_WINDOW_MS = 30_000;

/* ── small readers for tool output, which is typed as unknown ─────────── */

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(rec) : [];

function humanKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isDateKey(key: string, value: unknown): boolean {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && (key === 'date' || key.endsWith('_date') || key.endsWith('_target'));
}

/** "14 August" — the form the commitment warning is written in. */
function dayMonth(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function RequestsFacts({ data }: { data: unknown }) {
  const payload = data as {
    requests?: {
      id: string; client: string | null; title: string; state: string;
      stated_urgency: string | null; asked_for_date: string | null; asked_at: string;
    }[];
  };
  const rows = payload?.requests ?? [];
  if (rows.length === 0) return <p className="small dim">No requests match.</p>;

  return (
    <div className="rows">
      {rows.map((r) => (
        <div key={r.id} className="rows__row" style={{ alignItems: 'baseline' }}>
          <span className="small" style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>{r.title}</span>
            <span className="tiny dim" style={{ display: 'block' }}>
              {r.client ?? 'Unknown client'}
              {r.stated_urgency ? ` · they said: ${r.stated_urgency}` : ''}
              {r.asked_for_date ? ` · asked for ${shortDate(r.asked_for_date)}` : ''}
            </span>
          </span>
          <span className="chip chip--pending">{r.state.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}

/* ── the facts panel ──────────────────────────────────────────────────── */

const TOOL_LABELS: Record<string, string> = {
  get_briefing: 'Today',
  can_i_do_this_now: 'Whether this can run now',
  when_can_i_do: 'The next windows',
  propose_placement: 'Simulated move',
  propose_reshuffle: 'Simulated reshuffle',
  what_if: 'Simulation',
  search: 'Search',
  list_activity: 'Recent activity',
  list_requests: 'Client requests',
  get_request: 'The request',
  list_work: 'Work',
  get_work: 'The work item',
  list_clients: 'Clients',
  list_updates: 'Updates',
  get_weekly_review: 'The week',
  update_task: 'Work updated',
  complete_task: 'Work completed',
  move_task: 'Work moved',
  block_task: 'Work blocked',
  unblock_task: 'Work unblocked',
  start_timer: 'Work started',
  navigate: 'A screen to open',
};

function Value({ name, value }: { name: string; value: unknown }) {
  if (isDateKey(name, value)) return <span className="num">{shortDate(value as string)}</span>;
  if ((name.endsWith('minutes') || name.startsWith('minutes')) && num(value) !== null) {
    return <span className="num">{hm(value as number)}</span>;
  }
  if (typeof value === 'boolean') return <span>{value ? 'yes' : 'no'}</span>;
  if (typeof value === 'number') return <span className="num">{value}</span>;
  if (Array.isArray(value)) {
    const words = value.filter((v): v is string => typeof v === 'string');
    if (words.length === value.length) return <span>{words.map(humanKey).join(', ')}</span>;
    return <span><span className="num">{value.length}</span> entries</span>;
  }
  if (typeof value === 'string') return <span>{value}</span>;
  return <span className="dim">recorded</span>;
}

/** Anything without a hand-written renderer still shows its real fields. */
function GenericData({ data }: { data: unknown }) {
  const entries = Object.entries(rec(data)).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return <p className="small dim">Nothing came back from that.</p>;

  return (
    <div className="stack" style={{ gap: 2 }}>
      {entries.map(([key, value]) => (
        <div key={key} className="small">
          <span className="dim">{humanKey(key)}: </span>
          <Value name={key} value={value} />
        </div>
      ))}
    </div>
  );
}

function BriefingFacts({ data }: { data: unknown }) {
  const d = rec(data);
  const items = list(d.items);
  const atRisk = list(d.at_risk);
  const switches = num(d.mode_switches) ?? 0;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="spread">
        <span className="num">{shortDate(str(d.date))}</span>
        <span className="small">
          <span className="num">{hm(num(d.planned_minutes) ?? 0)}</span> planned of{' '}
          <span className="num">{hm(num(d.available_minutes) ?? 0)}</span> available
        </span>
      </div>

      {items.length > 0 && (
        <div className="rows">
          {items.map((item, index) => (
            <div key={str(item.id) ?? index} className="rows__row">
              <span className="small">{str(item.title) ?? 'Untitled work'}</span>
              <span className="small"><ClientName name={str(item.client)} /></span>
              <span className="num small">{hm(num(item.minutes) ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {atRisk.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {atRisk.map((risk, index) => (
            <p key={str(risk.id) ?? index} className="small risk-text">
              {str(risk.title) ?? 'Untitled work'} — {str(risk.reason) ?? 'at risk'}
              {num(risk.minutes_unplaced) ? <>, <span className="num">{hm(num(risk.minutes_unplaced) ?? 0)}</span> with nowhere to go</> : null}
              {str(risk.relevant_date) ? <> before <span className="num">{shortDate(str(risk.relevant_date))}</span></> : null}.
            </p>
          ))}
        </div>
      )}

      {switches > 0 && (
        <p className="tiny dim">
          Today changes kind of work <span className="num">{switches}</span> times.
        </p>
      )}
    </div>
  );
}

function CanIFacts({ data }: { data: unknown }) {
  const d = rec(data);
  const answer = str(d.answer) ?? 'unknown';
  const headline = answer === 'yes'
    ? 'Yes, this can run now.'
    : answer === 'not-in-this-zone'
      ? 'Not in this part of the day.'
      : 'No, not right now.';

  return (
    <div className="stack" style={{ gap: 4 }}>
      <p className="small">{headline}</p>
      {str(d.zone) && <p className="small dim">You are in {str(d.zone)}.</p>}
      {str(d.reason) && <p className="small">{str(d.reason)}</p>}
      {str(d.alternative) && <p className="small">{str(d.alternative)}</p>}
      {num(d.minutes_available_in_zone) !== null && (
        <p className="small">
          <span className="num">{hm(num(d.minutes_available_in_zone) ?? 0)}</span> left in this zone,
          and it needs <span className="num">{hm(num(d.minutes_needed) ?? 0)}</span>.
        </p>
      )}
    </div>
  );
}

function WindowFacts({ data }: { data: unknown }) {
  const d = rec(data);
  const slots = list(d.slots);

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="rows">
        {slots.map((slot, index) => (
          <div key={index} className="rows__row">
            <span className="small">
              <span className="num">{shortDate(str(slot.day))}</span>
              {str(slot.starts_at) && <> at <span className="num">{clockTime(str(slot.starts_at) as string)}</span></>}
              {str(slot.zone) && <span className="muted"> · {str(slot.zone)}</span>}
            </span>
            <span className="num small">{hm(num(slot.minutes_free) ?? 0)} free</span>
          </div>
        ))}
      </div>
      {num(d.minimum_block) !== null && (
        <p className="tiny dim">
          Work of this kind needs at least <span className="num">{hm(num(d.minimum_block) ?? 0)}</span> unbroken.
        </p>
      )}
    </div>
  );
}

function SearchFacts({ data }: { data: unknown }) {
  const d = rec(data);
  const matches = list(d.matches);

  if (matches.length === 0) return <p className="small dim">Nothing matched that.</p>;

  return (
    <div className="rows">
      {matches.map((match, index) => (
        <div key={str(match.id) ?? index} className="rows__row" style={{ display: 'block' }}>
          <div className="spread">
            <a href={`/work/${str(match.id) ?? ''}`}>{str(match.title) ?? 'Untitled work'}</a>
            <span className="small"><ClientName name={str(match.client)} /></span>
          </div>
          <div className="tiny dim">
            {str(match.status) && <>{humanKey(str(match.status) as string)}</>}
            {num(match.est_minutes) !== null && <>, <span className="num">{hm(num(match.est_minutes) ?? 0)}</span> estimated</>}
            {str(match.committed_date) && <>, committed <span className="num">{shortDate(str(match.committed_date))}</span></>}
            {str(match.internal_target) && <>, planned for <span className="num">{shortDate(str(match.internal_target))}</span></>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFacts({ data }: { data: unknown }) {
  const entries = list(rec(data).entries);
  if (entries.length === 0) return <p className="small dim">Nothing has happened recently.</p>;

  return (
    <div className="rows">
      {entries.slice(0, 8).map((entry, index) => (
        <div key={str(entry.id) ?? index} className="rows__row">
          <span className="small">{humanKey(str(entry.action) ?? 'change')}</span>
          <span className="tiny dim">
            {str(entry.actor)} · {relativePhrase(str(entry.created_at)?.slice(0, 10) ?? null)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepFacts({ step }: { step: Step }) {
  const label = TOOL_LABELS[step.tool] ?? humanKey(step.tool);

  return (
    <div className="rows__row" style={{ display: 'block' }}>
      <div className="eyebrow" style={{ marginBottom: 5 }}>{label}</div>
      {step.result.ok ? (
        step.tool === 'get_briefing' ? <BriefingFacts data={step.result.data} />
          : step.tool === 'list_requests' ? <RequestsFacts data={step.result.data} />
          : step.tool === 'can_i_do_this_now' ? <CanIFacts data={step.result.data} />
            : step.tool === 'when_can_i_do' ? <WindowFacts data={step.result.data} />
              : step.tool === 'search' ? <SearchFacts data={step.result.data} />
                : step.tool === 'list_activity' ? <ActivityFacts data={step.result.data} />
                  : <GenericData data={step.result.data} />
      ) : (
        <div className="stack" style={{ gap: 2 }}>
          <p className="small">{step.result.refused}</p>
          {step.result.alternative && <p className="small dim">{step.result.alternative}</p>}
        </div>
      )}
    </div>
  );
}

function Facts({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;

  return (
    <section className="card" style={{ background: 'var(--paper-100)', border: 'none' }}>
      <div className="eyebrow">The facts</div>
      <div className="rows" style={{ marginTop: 4 }}>
        {steps.map((step, index) => <StepFacts key={`${step.tool}-${index}`} step={step} />)}
      </div>
    </section>
  );
}

/* ── proposals ────────────────────────────────────────────────────────── */

const PRIORITY_WORDS: Record<string, number> = {
  critical: 1, urgent: 1, high: 2, normal: 3, medium: 3, low: 4,
};

function readPriority(args: Record<string, unknown>): number | null {
  const raw = args.priority ?? args.new_priority ?? args.value;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 4) return raw;
  if (typeof raw === 'string') {
    const asNumber = Number(raw);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 4) return asNumber;
    return PRIORITY_WORDS[raw.trim().toLowerCase()] ?? null;
  }
  return null;
}

function readDate(args: Record<string, unknown>): string | null {
  for (const key of ['committed_date', 'date', 'target_date', 'new_date', 'value']) {
    const value = args[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}

function readId(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Where the operator does this themselves, for everything not applied here. */
function screenFor(tool: string, args: Record<string, unknown>): { href: string; label: string } {
  switch (tool) {
    case 'approve_request':
    case 'decline_request': {
      const id = readId(args, ['request_id', 'id', 'work_id']);
      return { href: id ? `/requests/${id}` : '/requests', label: 'Open the request' };
    }
    case 'publish_report': {
      const id = readId(args, ['update_id', 'report_id', 'id']);
      return { href: id ? `/updates/${id}` : '/updates', label: 'Open the update' };
    }
    case 'archive_client':
    case 'revoke_portal_access': {
      const id = readId(args, ['client_id', 'id']);
      return { href: id ? `/clients/${id}` : '/clients', label: 'Open the client' };
    }
    case 'change_zone_rules':
      return { href: '/settings', label: 'Open Settings' };
    default: {
      const id = readId(args, ['work_id', 'task_id', 'id']);
      return { href: id ? `/work/${id}` : '/work', label: 'Open the work item' };
    }
  }
}

type Commitment = { clientName: string | null; committedDate: string };

function ProposalPanel({
  proposal, commitment, clientColors, onApplied,
}: {
  proposal: Proposal;
  commitment: Commitment | null;
  clientColors: Record<string, number>;
  onApplied: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const router = useRouter();

  const args = rec(proposal.args);
  const workId = readId(args, ['work_id', 'task_id', 'id']);
  const isPriority = proposal.tool === 'set_priority' || proposal.tool === 'change_priority';
  const isDate = proposal.tool === 'set_committed_date' || proposal.tool === 'change_committed_date';
  const priority = isPriority ? readPriority(args) : null;
  const committedDate = isDate ? readDate(args) : null;

  const applicable = Boolean(workId) && ((isPriority && priority !== null) || (isDate && committedDate !== null));

  const apply = async () => {
    if (!workId) return;
    setPending(true);
    try {
      const result = isPriority && priority !== null
        ? await applyProposalAction({ kind: 'priority', workId, priority })
        : isDate && committedDate !== null
          ? await applyProposalAction({ kind: 'committed_date', workId, committedDate })
          : { ok: false, message: 'There is nothing here I can apply.' };

      setOutcome(result.message);
      setConfirming(false);
      if (result.ok) {
        onApplied(result.message);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card card--wait" style={{ marginTop: 12 }}>
      <div className="eyebrow">Waiting on you</div>
      <p style={{ marginTop: 6, fontWeight: 600 }}>{proposal.label}</p>
      <p className="small muted" style={{ marginTop: 4 }}>{proposal.reason}</p>

      {isPriority && priority !== null && (
        <p className="small" style={{ marginTop: 8 }}>
          This would set the priority to {PRIORITY_LABELS[priority]}.
        </p>
      )}
      {isDate && committedDate !== null && (
        <p className="small" style={{ marginTop: 8 }}>
          This would commit the work to <span className="num">{shortDate(committedDate)}</span>.
        </p>
      )}

      {outcome && <p className="small" style={{ marginTop: 8 }}>{outcome}</p>}

      {!outcome && applicable && (
        <div style={{ marginTop: 10 }}>
          {confirming && commitment ? (
            <div className="card card--over">
              <p className="small">
                This misses the <span className="num">{dayMonth(commitment.committedDate)}</span> date
                you committed to{' '}
                {commitment.clientName
                  ? <ClientName name={commitment.clientName} colorIndex={clientColors[commitment.clientName] ?? null} />
                  : 'this client'}. Apply anyway?
              </p>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn--danger btn--sm" onClick={apply} disabled={pending}>
                  {pending ? 'Applying…' : 'Yes, and I’ll tell them'}
                </button>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirming(false)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={pending}
              onClick={() => {
                // A promise a client is holding you to is confirmed twice,
                // and the second time it is named.
                if (isDate && commitment) setConfirming(true);
                else void apply();
              }}
            >
              {pending ? 'Applying…' : 'Apply'}
            </button>
          )}
        </div>
      )}

      {!outcome && !applicable && (
        <div style={{ marginTop: 10 }}>
          <p className="small">
            {isPriority || isDate
              ? 'This came back without a value I can read, so it is safer to set it on the work item yourself.'
              : 'I have not built this one into the chat, so it is done on its own screen where the full context is in front of you.'}
          </p>
          <a className="btn btn--sm" style={{ marginTop: 8 }} href={screenFor(proposal.tool, args).href}>
            {screenFor(proposal.tool, args).label}
          </a>
        </div>
      )}
    </section>
  );
}

/* ── suggested actions ────────────────────────────────────────────────── */

const SCREEN_NAMES: Record<string, string> = {
  '/': 'Today',
  '/work': 'All work',
  '/week': 'The week',
  '/clients': 'Clients',
  '/requests': 'Requests',
  '/updates': 'Updates',
  '/inbox': 'Inbox',
  '/activity': 'Activity',
  '/settings': 'Settings',
  '/availability': 'Availability',
  '/capture': 'Capture',
};

const TITLE_KEYS = ['moved', 'completed', 'blocked', 'unblocked', 'started', 'title'];

function suggestions(turn: TurnResult): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];

  if (turn.navigate) {
    const path = turn.navigate;
    links.push({ href: path, label: `Open ${SCREEN_NAMES[path] ?? path}` });
  }

  const seen = new Set<string>();
  for (const step of turn.steps) {
    if (!step.result.ok) continue;
    const id = readId(rec(step.args), ['work_id']);
    if (!id || seen.has(id)) continue;

    const data = rec(step.result.data);
    const title = TITLE_KEYS.map((key) => str(data[key])).find(Boolean);
    if (!title) continue;

    seen.add(id);
    links.push({ href: `/work/${id}`, label: `Open “${title}”` });
  }

  return links;
}

/* ── one turn ─────────────────────────────────────────────────────────── */

function TurnView({ turn, onApplied }: { turn: TurnResult; onApplied: (message: string) => void }) {
  // The second confirmation only appears when the engine actually found a
  // commitment this would miss — never because the prose mentioned one.
  const commitments = turn.diffs.flatMap((diff) => diff.commitments);
  const commitment: Commitment | null = commitments.length > 0
    ? { clientName: commitments[0].clientName, committedDate: commitments[0].committedDate }
    : null;

  const links = suggestions(turn);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <Facts steps={turn.steps} />

      {turn.answer && (
        <div className="card">
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{turn.answer}</p>
        </div>
      )}

      {turn.diffs.map((diff, index) => (
        <DiffPanel key={`diff-${index}`} diff={diff} clientColors={turn.clientColors} />
      ))}

      {turn.proposals.map((proposal, index) => (
        <ProposalPanel
          key={`proposal-${index}`}
          proposal={proposal}
          commitment={commitment}
          clientColors={turn.clientColors}
          onApplied={onApplied}
        />
      ))}

      {links.length > 0 && (
        <div>
          <div className="section-label" style={{ marginTop: 8 }}><span>Suggested actions</span></div>
          <div className="row" style={{ gap: 8 }}>
            {links.map((link) => (
              <a key={link.href} className="btn btn--sm" href={link.href}>{link.label}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MicButton({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const start = async () => {
    setProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

        setPending(true);
        try {
          const form = new FormData();
          form.set('audio', blob, 'recording.webm');
          const response = await fetch('/api/transcribe', { method: 'POST', body: form });
          if (!response.ok) {
            setProblem('I could not turn that recording into text. Type it instead.');
            return;
          }
          const body = await response.json() as { text?: string };
          if (body.text) onText(body.text);
          else setProblem('There was nothing audible in that recording.');
        } catch {
          setProblem('I could not reach the transcription service. Type it instead.');
        } finally {
          setPending(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setProblem('I could not reach the microphone. Check this site’s permission in the browser.');
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn--sm${recording ? ' btn--danger' : ''}`}
        onClick={() => (recording ? stop() : void start())}
        disabled={pending}
        aria-label={recording ? 'Stop recording and transcribe' : 'Dictate a message'}
      >
        {pending ? 'Transcribing…' : recording ? 'Stop' : '🎙'}
      </button>
      {problem && <p className="tiny risk-text" style={{ width: '100%' }}>{problem}</p>}
    </>
  );
}

/* ── the surface itself ───────────────────────────────────────────────── */

export function Chat({
  transcription = false,
  compact = false,
  autoFocus = false,
}: {
  transcription?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [undoOffer, setUndoOffer] = useState<{ payloads: UndoPayload[]; count: number } | null>(null);
  const [undoPending, setUndoPending] = useState(false);

  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [entries]);

  // The offer expires rather than sitting there: after half a minute the
  // change is history, and history is undone from the activity log.
  useEffect(() => {
    if (!undoOffer) return;
    const timer = setTimeout(() => setUndoOffer(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undoOffer]);

  const addNote = useCallback((note: string) => {
    setEntries((prev) => [...prev, { id: nextId.current++, kind: 'note', text: note }]);
  }, []);

  const send = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || pending) return;

    setText('');
    setEntries((prev) => [...prev, { id: nextId.current++, kind: 'operator', text: trimmed }]);
    setPending(true);

    try {
      const turn = await sendMessageAction({ history, message: trimmed });
      setHistory(turn.transcript);
      setEntries((prev) => [...prev, { id: nextId.current++, kind: 'assistant', turn }]);
      if (turn.undo.length > 0) {
        setUndoOffer({ payloads: turn.undo, count: turn.undo.length });
        router.refresh();
      }
    } catch {
      addNote('Something went wrong sending that. Nothing was changed.');
    } finally {
      setPending(false);
    }
  }, [addNote, history, pending, router]);

  const runUndo = async () => {
    if (!undoOffer) return;
    setUndoPending(true);
    try {
      const result = await undoTurnAction(undoOffer.payloads);
      addNote(result.message);
      setUndoOffer(null);
      router.refresh();
    } finally {
      setUndoPending(false);
    }
  };

  const conversation = entries.map((entry) => {
    if (entry.kind === 'operator') {
      return (
        <div key={entry.id}>
          <div className="eyebrow">You asked</div>
          <p style={{ marginTop: 4 }}>{entry.text}</p>
        </div>
      );
    }
    if (entry.kind === 'note') {
      return <p key={entry.id} className="small dim">{entry.text}</p>;
    }
    return <TurnView key={entry.id} turn={entry.turn} onApplied={addNote} />;
  });

  return (
    <div className="stack">
      <div
        className="stack"
        style={compact ? { maxHeight: '52vh', overflowY: 'auto', paddingRight: 2 } : undefined}
      >
        {entries.length === 0 && (
          <div className="chips">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                className="choice"
                disabled={pending}
                onClick={() => void send(starter)}
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        {conversation}

        {pending && <p className="small dim">Working it out…</p>}
        <div ref={bottom} />
      </div>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label className="sr-only" htmlFor="assistant-message">Ask the assistant</label>
        <textarea
          id="assistant-message"
          className="input"
          rows={compact ? 2 : 3}
          value={text}
          autoFocus={autoFocus}
          placeholder="Move the ibBan creatives to Thursday and tell me what that costs."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
        />
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="submit" className="btn btn--primary btn--sm" disabled={pending || !text.trim()}>
            {pending ? 'Working it out…' : 'Send'}
          </button>
          {transcription && <MicButton onText={(spoken) => setText((prev) => (prev ? `${prev} ${spoken}` : spoken))} />}
          <span className="tiny dim">Enter sends. Shift and Enter starts a new line.</span>
        </div>
      </form>

      {undoOffer && (
        <div className="toast" role="status">
          <span>
            {undoOffer.count === 1 ? 'One change was made.' : `${undoOffer.count} changes were made.`}
          </span>
          <button type="button" onClick={() => void runUndo()} disabled={undoPending}>
            {undoPending ? 'Putting it back…' : 'Undo'}
          </button>
        </div>
      )}
    </div>
  );
}
