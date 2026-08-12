// Operator dashboard — AI briefing, overload options, week plan, overflow,
// needs-review, report drafts.
//
// The AI cards are cached per day (src/ai/cache.ts): a page load never
// triggers a K3 call unless today's briefing hasn't been generated yet,
// or the operator hits Refresh.

import { db } from '@/lib/db';
import { buildBriefing } from '@/briefing/data';
import { cachedDailyBriefing, cachedOverloadAdvice } from '@/ai/judgement';
import { scheduleBlocks } from '@/scheduler/view';
import { refreshBriefingAction } from './briefingActions';
import { fmtDateTime, fmtHours, fmtTime, Nav } from './ui';

export const dynamic = 'force-dynamic';

function AiCard({
  title, body, generatedAt, variant,
}: { title: string; body: string; generatedAt?: string; variant?: string }) {
  return (
    <section className={`card${variant ? ` ${variant}` : ''}`}>
      <div className="page-head">
        <h2>{title}</h2>
        {generatedAt && <span className="muted tiny">{fmtDateTime(generatedAt)}</span>}
      </div>
      <div className="prose">{body}</div>
    </section>
  );
}

export default async function Dashboard() {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86400000);

  const briefing = await buildBriefing(now);

  // AI is best-effort: if the provider is down, the deterministic dashboard
  // must still render. A dead LLM never blocks the operator's own data.
  const [briefingCard, adviceCard] = await Promise.all([
    cachedDailyBriefing(briefing, now).catch((e) => ({
      content: `Briefing generate nahi ho saki: ${e instanceof Error ? e.message : e}`,
      generated_at: new Date().toISOString(),
    })),
    cachedOverloadAdvice(briefing, now).catch(() => null),
  ]);

  const [blocks, { data: drafts }, { data: review }, { data: pendingRequests }] = await Promise.all([
    scheduleBlocks(now, weekEnd),
    db().from('reports')
      .select('id, kind, period_start, period_end, clients(name)')
      .eq('status', 'draft').order('period_end', { ascending: false }),
    db().from('tasks')
      .select('id, title, due_at, clients(name)')
      .eq('needs_review', true).neq('status', 'done'),
    db().from('client_requests')
      .select('id, raw_input, draft, clients(name)')
      .eq('state', 'pending_approval').order('created_at'),
  ]);

  const byDay = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const day = new Date(b.starts_at).toDateString();
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }

  return (
    <main className="container">
      <div className="page-head">
        <h1>Agency OS</h1>
        <form action={refreshBriefingAction}>
          <button type="submit" className="btn btn--subtle btn--sm">↻ Briefing refresh</button>
        </form>
      </div>
      <Nav />

      <AiCard title="Aaj ki briefing" body={briefingCard.content} generatedAt={briefingCard.generated_at} />

      {adviceCard && (
        <AiCard
          title="Options — kaam zyada hai"
          body={adviceCard.content}
          generatedAt={adviceCard.generated_at}
          variant="card--warn"
        />
      )}

      {(pendingRequests ?? []).length > 0 && (
        <section className="card card--attention">
          <h2>📥 Client requests ({pendingRequests!.length})</h2>
          <ul className="list">
            {pendingRequests!.map((r) => {
              const c = r.clients as unknown as { name: string } | null;
              const title = ((r.draft as { title?: string } | null)?.title) || r.raw_input.slice(0, 80);
              return (
                <li key={r.id}>
                  <a href={`/requests/${r.id}`}>{c?.name ?? '—'} — {title}</a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {briefing.overflow.length > 0 && (
        <section id="overflow" className="card card--warn">
          <h2>⚠️ {briefing.overflow_hours}h fit nahi hua</h2>
          <ul className="list">
            {briefing.overflow.map((t) => (
              <li key={t.id}>
                <a href={`/tasks/${t.id}`}>{t.client ?? '—'} — {t.title}</a>
                <div className="item__meta">
                  {fmtHours(t.est_minutes)}{t.due_at ? ` · due ${t.due_at.slice(0, 10)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {briefing.at_risk.length > 0 && (
        <section className="card card--danger">
          <h2>🔴 Deadline khatre mein ({briefing.at_risk.length})</h2>
          <ul className="list">
            {briefing.at_risk.map((t) => (
              <li key={t.id}>
                <a href={`/tasks/${t.id}`}>{t.client ?? '—'} — {t.title}</a>
                <div className="item__meta">
                  due {t.due_at?.slice(0, 10)} · {t.reason.replace(/_/g, ' ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(review ?? []).length > 0 && (
        <section className="card card--attention">
          <h2>📝 Review darkar ({review!.length})</h2>
          <ul className="list">
            {review!.map((t) => {
              const c = t.clients as unknown as { name: string } | null;
              return (
                <li key={t.id}>
                  <a href={`/tasks/${t.id}`}>{c?.name ?? '—'} — {t.title}</a>
                  {t.due_at && <div className="item__meta">due {t.due_at.slice(0, 10)}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Is hafte ka plan</h2>
        <p className="muted small">
          Aaj {fmtHours(briefing.today.planned_minutes)} planned ·
          {' '}agle 14 din mein {fmtHours(briefing.capacity_next_14d.free_minutes)} khali
          {' '}({fmtHours(briefing.capacity_next_14d.total_minutes)} total)
        </p>
        {byDay.size === 0 && <p>Kuch scheduled nahi.</p>}
        {[...byDay.entries()].map(([day, items]) => (
          <div key={day}>
            <h3 className="muted">{day}</h3>
            <ul className="list">
              {items.map((b, i) => (
                <li key={i}>
                  <span className="muted">{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</span>{' '}
                  <a href={`/tasks/${b.task_id}`}>{b.title}</a>
                  {b.is_locked ? ' 🔒' : ''}
                  <div className="item__meta">{b.client ?? '—'}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {briefing.stale.length > 0 && (
        <section id="stale" className="card">
          <h2>Purane backlog tasks ({briefing.stale.length})</h2>
          <ul className="list">
            {briefing.stale.slice(0, 10).map((t) => (
              <li key={t.id}>
                <a href={`/tasks/${t.id}`}>{t.client ?? '—'} — {t.title}</a>
                <div className="item__meta">{t.created_at.slice(0, 10)} se pending</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Report drafts</h2>
        {(drafts ?? []).length === 0 && <p>Koi pending draft nahi.</p>}
        <ul className="list">
          {(drafts ?? []).map((d) => {
            const c = d.clients as unknown as { name: string } | null;
            return (
              <li key={d.id}>
                <a href={`/reports/${d.id}`}>
                  {c?.name ?? '—'} — {d.kind} {d.period_start} → {d.period_end}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="muted tiny">
        Total overflow {briefing.overflow_hours}h · blocked {briefing.blocked.length} ·
        {' '}AI briefing roz ek dafa banti hai, phir cache se aati hai.
      </p>
    </main>
  );
}
