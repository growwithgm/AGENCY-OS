/**
 * Assistant — today's brief, then a question box.
 *
 * Every answer is grounded in facts the application computed first, and
 * every answer leads with the numbers. Nothing here applies itself.
 */

import { requireOperator } from '@/lib/auth';
import { openSignals } from '@/data/attention';
import { todayView } from '@/data/planning';
import { pendingRequests } from '@/data/requests';
import { pendingUpdates } from '@/data/updates';
import { effortSamples } from '@/data/work';
import { allSuggestions } from '@/engines/estimates/learn';
import { dailyBrief } from '@/ai/jobs/brief';
import { hm } from '@/lib/format';
import { AskBox } from './AskBox';

export const dynamic = 'force-dynamic';

const SAMPLE_QUESTIONS = [
  'What should I cut this week?',
  'Which client am I neglecting?',
  'What slipped this month?',
];

export default async function AssistantPage() {
  const { supabase } = await requireOperator();
  const now = new Date();

  const [view, signals, requests, updates, samples] = await Promise.all([
    todayView(supabase, now),
    openSignals(supabase),
    pendingRequests(supabase),
    pendingUpdates(supabase),
    effortSamples(supabase),
  ]);

  const brief = await dailyBrief({
    date: view.date,
    availableMinutes: view.availableMinutes,
    plannedMinutes: view.plannedMinutes,
    items: view.items.map((i) => ({
      title: i.task.title,
      client: i.clientName,
      minutes: i.minutes,
      committed_date: i.task.committed_date,
    })),
    willNotFit: [],
    signals: signals.map((s) => ({ headline: s.headline, severity: s.severity })),
    pendingRequests: requests.length,
    draftUpdates: updates.filter((u) => u.status === 'draft').length,
  });

  const insight = allSuggestions(samples)[0] ?? null;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Advisory only</div>
          <h1 className="page-title">Assistant</h1>
        </div>
      </div>

      <section className="card">
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="work__client">Today&rsquo;s brief</span>
          {brief.source === 'fallback' && <span className="tag tag--info">written without AI</span>}
        </div>
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{brief.text}</p>

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <span className="tag">{hm(view.plannedMinutes)} planned</span>
          <span className="tag">{hm(view.availableMinutes)} available</span>
          {requests.length > 0 && <span className="tag tag--wait">{requests.length} requests</span>}
          {updates.filter((u) => u.status === 'draft').length > 0 && (
            <span className="tag tag--wait">
              {updates.filter((u) => u.status === 'draft').length} drafts to approve
            </span>
          )}
        </div>
      </section>

      <AskBox samples={SAMPLE_QUESTIONS} />

      {insight && (
        <>
          <div className="section-label"><span>Estimate accuracy</span></div>
          <div className="card">
            <p className="small">{insight.sentence}</p>
            <p className="tiny dim" style={{ marginTop: 6 }}>
              A suggestion, not a change. Estimates are only ever revised by you.
            </p>
          </div>
        </>
      )}

      {signals.length > 0 && (
        <>
          <div className="section-label">
            <span>Open conditions</span>
            <span className="num muted">{signals.length}</span>
          </div>
          <div className="rows">
            {signals.map((signal) => (
              <div key={signal.id} className="rows__row" style={{ display: 'block' }}>
                <div>{signal.headline}</div>
                <div className="tiny dim">{signal.signal_type.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
