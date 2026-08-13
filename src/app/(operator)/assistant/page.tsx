/**
 * Assistant — today's figures, then a conversation about them.
 *
 * The chat can read the plan and change the operator's own work directly.
 * Anything that reaches a client, or sets a priority, comes back as a panel
 * to tap rather than something it did. Every number under an answer is
 * rendered from what the tools returned, never from the prose.
 */

import { requireOperator } from '@/lib/auth';
import { openSignals } from '@/data/attention';
import { todayView } from '@/data/planning';
import { pendingRequests } from '@/data/requests';
import { pendingUpdates } from '@/data/updates';
import { effortSamples } from '@/data/work';
import { aiHealthy, transcriptionConfigured } from '@/data/aiHealth';
import { allSuggestions } from '@/engines/estimates/learn';
import { dailyBrief } from '@/ai/jobs/brief';
import { hm } from '@/lib/format';
import { AiHealthBanner } from '@/components/AiHealthBanner';
import { Chat } from './Chat';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const { supabase } = await requireOperator();
  const now = new Date();

  const [view, signals, requests, updates, samples, healthy] = await Promise.all([
    todayView(supabase, now),
    openSignals(supabase),
    pendingRequests(supabase),
    pendingUpdates(supabase),
    effortSamples(supabase),
    aiHealthy(supabase),
  ]);

  const draftCount = updates.filter((u) => u.status === 'draft').length;

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
    draftUpdates: draftCount,
  });

  const insight = allSuggestions(samples)[0] ?? null;

  const runningItem = view.items.find((i) => i.task.status === 'in_progress');
  const running = runningItem ? { id: runningItem.task.id, title: runningItem.task.title } : null;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Reads everything, changes only your own work</div>
          <h1 className="page-title">Assistant</h1>
        </div>
      </div>

      <AiHealthBanner healthy={healthy} />

      <section className="card">
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="eyebrow">Today&rsquo;s brief</span>
          {brief.source === 'fallback' && <span className="tag tag--info">written without AI</span>}
        </div>
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{brief.text}</p>

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <span className="tag"><span className="num">{hm(view.plannedMinutes)}</span> planned</span>
          <span className="tag"><span className="num">{hm(view.availableMinutes)}</span> available</span>
          {requests.length > 0 && (
            <span className="tag tag--wait"><span className="num">{requests.length}</span> requests</span>
          )}
          {draftCount > 0 && (
            <span className="tag tag--wait"><span className="num">{draftCount}</span> drafts to approve</span>
          )}
        </div>
      </section>

      <div className="section-label"><span>Ask, or tell it what changed</span></div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        It can answer questions about the plan, move your own work, start and finish things, and
        show you what a change would cost before you make it. Priorities, committed dates and
        anything a client sees come back as a panel for you to tap. Press ⌘K anywhere to open the
        same thing in a smaller window.
      </p>

      <Chat transcription={transcriptionConfigured()} offline={!healthy} running={running} />

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
