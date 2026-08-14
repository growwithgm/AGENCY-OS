/**
 * The activity log — every operation, including the assistant's.
 *
 * The instruction that caused a change is kept next to the change itself,
 * which is what makes "why is this on Thursday?" answerable a week later.
 */

import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import {
  isRevertible,
  listActivity,
  REVERT_WINDOW_HOURS,
  type ActivityEntry,
  type Actor,
} from '@/data/activity';
import { listWork } from '@/data/work';
import { aiUsage, type AIUsage } from '@/data/aiUsage';
import { PRIORITY_LABELS, STATUS_LABELS, type WorkStatus } from '@/data/types';
import { clockTime, hm, relativePhrase, shortDate } from '@/lib/format';
import { revertAction } from './actions';

export const dynamic = 'force-dynamic';

const FILTERS: { label: string; actor?: Actor }[] = [
  { label: 'All' },
  { label: 'Operator', actor: 'operator' },
  { label: 'Assistant', actor: 'assistant' },
  { label: 'System', actor: 'system' },
];

const ACTOR_LABELS: Record<Actor, string> = {
  operator: 'You',
  assistant: 'Assistant',
  system: 'System',
};

/** Plain sentences for the actions the product writes. */
const PHRASES: Record<string, string> = {
  work_created: 'Added a work item',
  work_updated: 'Changed a work item',
  work_rescheduled: 'Moved a work item to another day',
  work_pushed: 'Pushed a work item to the next free slot',
  work_completed: 'Marked a work item done',
  work_blocked: 'Marked a work item blocked',
  priority_changed: 'Changed a priority',
  estimate_revised: 'Revised an estimate',
  commitment_set: 'Promised a date to the client',
  commitment_changed: 'Changed a date already promised to the client',
  request_converted: 'Turned a client request into work',
  request_declined: 'Declined a client request',
  update_published: 'Published a client update',
  update_corrected: 'Published a correction to a client update',
  replan: 'Re-planned the week',
  revert: 'Reverted an earlier change',
};

const ENTITY_LABELS: Record<string, string> = {
  tasks: 'work item',
  clients: 'client',
  client_requests: 'client request',
  client_updates: 'client update',
  capture_drafts: 'capture',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'internal title',
  client_title: 'client-facing title',
  est_minutes: 'estimate',
  safe_minutes: 'safe estimate',
  internal_target: 'internal target',
  committed_date: 'promised to the client',
  client_requested_date: 'they asked for',
  client_visible: 'shown on their portal',
  blocked_reason: 'blocked because',
  status: 'state',
  priority: 'priority',
};

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<{ actor?: string }>;
}) {
  const { supabase } = await requireOperator();
  const { actor: requested } = await searchParams;

  const actor = FILTERS.find((f) => f.actor === requested)?.actor;
  const [entries, work, usage] = await Promise.all([
    listActivity(supabase, { actor, limit: 100 }),
    listWork(supabase, { limit: 200 }),
    aiUsage(supabase, 7),
  ]);

  const titleById = new Map(work.map((w) => [w.id, w.title]));

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Every change, and what caused it</div>
          <h1 className="page-title">Activity</h1>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        {FILTERS.map((filter) => {
          const active = filter.actor === actor;
          return (
            <Link
              key={filter.label}
              href={filter.actor ? `/activity?actor=${filter.actor}` : '/activity'}
              className={`choice${active ? ' choice--on' : ''}`}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                textDecoration: 'none',
                color: active ? 'var(--paper-100)' : 'var(--ink-900)',
              }}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {entries.length > 0 && (
        <p className="small muted" style={{ marginBottom: 14 }}>
          The last <span className="num">{entries.length}</span>{' '}
          {entries.length === 1 ? 'thing that happened' : 'things that happened'}, newest first.
          Anything from the past <span className="num">{REVERT_WINDOW_HOURS} hours</span> can be
          put back the way it was — after that it is history rather than a mistake still being
          corrected.
        </p>
      )}

      {entries.length === 0 && (
        <div className="card card--dashed">
          <p className="muted">
            {actor ? 'Nothing from this one yet.' : 'Nothing has changed yet.'}
          </p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Ask the assistant to move something and it lands here with the instruction that
            caused it, so &ldquo;why is this on Thursday?&rdquo; always has an answer.
          </p>
        </div>
      )}

      <div className="stack">
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} titleById={titleById} />
        ))}
      </div>

      <AIUsagePanel usage={usage} />
    </main>
  );
}

/**
 * The week's AI spend, from the same ledger every model call writes to.
 * Costs are estimates from src/ai/rates.ts — edit rates there, not here.
 */
function AIUsagePanel({ usage }: { usage: AIUsage }) {
  const money = (v: number) => (v < 0.005 && v > 0 ? '<$0.01' : `$${v.toFixed(2)}`);

  return (
    <section style={{ marginTop: 26 }}>
      <div className="section-label"><span>AI, the last {usage.days} days</span></div>
      <div className="card">
        {usage.rows.length === 0 ? (
          <p className="muted">No AI calls in the last {usage.days} days.</p>
        ) : (
          <>
            <div className="spread small" style={{ marginBottom: 10 }}>
              <span>
                <span className="num">{usage.totals.calls}</span> calls
                {usage.totals.errors > 0 && (
                  <span className="risk-text"> · {usage.totals.errors} failed</span>
                )}
              </span>
              <span className="num">≈{money(usage.totals.estCostUSD)}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="tiny dim" style={{ textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>Job</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>Model</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Calls</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Errors</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Tokens in</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Tokens out</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Avg ms</th>
                    <th style={{ padding: '4px 0 4px 8px', fontWeight: 500, textAlign: 'right' }}>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.rows.map((row) => (
                    <tr key={`${row.kind}-${row.model}`} style={{ borderTop: '1px solid var(--hairline)' }}>
                      <td style={{ padding: '5px 8px 5px 0' }}>{row.kind.replace(/_/g, ' ')}</td>
                      <td className="dim" style={{ padding: '5px 8px' }}>{row.model}</td>
                      <td className="num" style={{ padding: '5px 8px', textAlign: 'right' }}>{row.calls}</td>
                      <td className={row.errors ? 'num risk-text' : 'num dim'} style={{ padding: '5px 8px', textAlign: 'right' }}>{row.errors}</td>
                      <td className="num dim" style={{ padding: '5px 8px', textAlign: 'right' }}>{row.inputTokens.toLocaleString('en-GB')}</td>
                      <td className="num dim" style={{ padding: '5px 8px', textAlign: 'right' }}>{row.outputTokens.toLocaleString('en-GB')}</td>
                      <td className="num dim" style={{ padding: '5px 8px', textAlign: 'right' }}>{row.avgLatencyMs.toLocaleString('en-GB')}</td>
                      <td className="num" style={{ padding: '5px 0 5px 8px', textAlign: 'right' }}>{money(row.estCostUSD)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny dim" style={{ marginTop: 8 }}>
              Costs are estimates from the rate table in <span className="num">src/ai/rates.ts</span>;
              reasoning tokens are billed as output tokens and counted as returned. Transcription is
              billed per audio minute, so its cost is not estimated here.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Entry({ entry, titleById }: { entry: ActivityEntry; titleById: Map<string, string> }) {
  const assistant = entry.actor === 'assistant';
  const day = entry.created_at.slice(0, 10);
  const entity = entityLine(entry, titleById);

  return (
    <article className={`card ${assistant ? 'card--wait' : ''}`}>
      <div className="spread">
        <span style={{ fontWeight: 600, fontSize: 14, flex: '1 1 220px' }}>{describe(entry)}</span>
        <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
          <span className={`chip ${assistant ? 'chip--pending' : 'chip--done'}`}>
            {ACTOR_LABELS[entry.actor] ?? entry.actor}
          </span>
          <span className="tiny dim">
            {relativePhrase(day)} at <span className="num">{clockTime(entry.created_at)}</span>
          </span>
        </span>
      </div>

      {entity && <div className="small" style={{ marginTop: 6 }}>{entity}</div>}

      {entry.instruction && (
        <p className="small" style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--ink-600)' }}>
          &ldquo;{entry.instruction}&rdquo;
        </p>
      )}

      <Changes entry={entry} />

      {isRevertible(entry) && (
        <form action={revertAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="entry_id" value={entry.id} />
          <button type="submit" className="btn btn--sm">Revert this</button>
        </form>
      )}

      {entry.reverted_at && (
        <p className="small risk-text" style={{ marginTop: 8 }}>
          Reverted {relativePhrase(entry.reverted_at.slice(0, 10))} at{' '}
          <span className="num">{clockTime(entry.reverted_at)}</span> — this went back to what
          it was before.
        </p>
      )}
    </article>
  );
}

function Changes({ entry }: { entry: ActivityEntry }) {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

  if (keys.length === 0) return null;

  return (
    <div className="rows" style={{ marginTop: 8 }}>
      {keys.map((key) => (
        <div key={key} className="rows__row" style={{ padding: '6px 0' }}>
          <span className="tiny dim">{FIELD_LABELS[key] ?? key.replace(/_/g, ' ')}</span>
          <span className="tiny num">
            {readable(key, before[key])} → {readable(key, after[key])}
          </span>
        </div>
      ))}
    </div>
  );
}

function entityLine(entry: ActivityEntry, titleById: Map<string, string>) {
  if (!entry.entity_type || !entry.entity_id) return null;

  if (entry.entity_type === 'tasks') {
    const title = titleById.get(entry.entity_id);
    return <Link href={`/work/${entry.entity_id}`}>{title ?? 'Open the work item'}</Link>;
  }

  const label = ENTITY_LABELS[entry.entity_type] ?? entry.entity_type.replace(/_/g, ' ');
  return <span className="dim">on a {label}</span>;
}

function describe(entry: ActivityEntry): string {
  const phrase = PHRASES[entry.action];
  if (phrase) return phrase;
  const words = entry.action.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Values as a person reads them: durations as `1h 30m`, dates as dates. */
function readable(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';

  const normalised = key.replace(/_/g, '').toLowerCase();
  if (normalised === 'estminutes' || normalised === 'safeminutes' || normalised === 'minutes') {
    return hm(Number(value));
  }
  // States and priorities read as the words used everywhere else in the product.
  if (normalised === 'status') return STATUS_LABELS[value as WorkStatus] ?? String(value);
  if (normalised === 'priority') return PRIORITY_LABELS[Number(value)] ?? String(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return shortDate(value.slice(0, 10));
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
