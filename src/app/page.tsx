// Operator dashboard — AI briefing, overload options, week plan, overflow,
// needs-review, report drafts.
//
// The AI cards are cached per day (src/ai/cache.ts): a page load never
// triggers a K3 call unless today's briefing hasn't been generated yet,
// or the operator hits Refresh.

import { db } from '@/lib/db';
import { buildBriefing } from '@/briefing/data';
import { cachedDailyBriefing, cachedOverloadAdvice } from '@/ai/judgement';
import { scheduleBlocks, totalMinutes } from '@/scheduler/view';
import { refreshBriefingAction } from './briefingActions';
import { buttonSubtle, card, fmtHours, fmtTime, link, muted, Nav } from './ui';

export const dynamic = 'force-dynamic';

function AiCard({
  title, body, generatedAt, accent,
}: { title: string; body: string; generatedAt?: string; accent?: string }) {
  return (
    <section style={{ ...card, ...(accent ? { border: `1px solid ${accent}` } : {}) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>{title}</h2>
        {generatedAt && (
          <span style={{ ...muted, fontSize: 12 }}>
            {new Date(generatedAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
          </span>
        )}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginTop: 8 }}>{body}</div>
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

  const [blocks, { data: drafts }, { data: review }] = await Promise.all([
    scheduleBlocks(now, weekEnd),
    db().from('reports')
      .select('id, kind, period_start, period_end, clients(name)')
      .eq('status', 'draft').order('period_end', { ascending: false }),
    db().from('tasks')
      .select('id, title, due_at, clients(name)')
      .eq('needs_review', true).neq('status', 'done'),
  ]);

  const byDay = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const day = new Date(b.starts_at).toDateString();
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>Agency OS</h1>
        <form action={refreshBriefingAction}>
          <button type="submit" style={buttonSubtle}>↻ Briefing refresh</button>
        </form>
      </div>
      <Nav />

      <AiCard title="Aaj ki briefing" body={briefingCard.content} generatedAt={briefingCard.generated_at} />

      {adviceCard && (
        <AiCard
          title="Options — kaam zyada hai"
          body={adviceCard.content}
          generatedAt={adviceCard.generated_at}
          accent="#a3541e"
        />
      )}

      {briefing.overflow.length > 0 && (
        <section style={{ ...card, border: '1px solid #a3541e' }}>
          <strong>⚠️ {briefing.overflow_hours}h ka kaam horizon mein fit nahi hua</strong>
          <ul>
            {briefing.overflow.map((t) => (
              <li key={t.id}>
                <a href={`/tasks/${t.id}`} style={link}>{t.client ?? '—'} — {t.title}</a>
                {' '}({fmtHours(t.est_minutes)}{t.due_at ? `, due ${t.due_at.slice(0, 10)}` : ''})
              </li>
            ))}
          </ul>
        </section>
      )}

      {briefing.at_risk.length > 0 && (
        <section style={{ ...card, border: '1px solid #8a3d3d' }}>
          <strong>🔴 Deadline khatre mein ({briefing.at_risk.length})</strong>
          <ul>
            {briefing.at_risk.map((t) => (
              <li key={t.id}>
                <a href={`/tasks/${t.id}`} style={link}>{t.client ?? '—'} — {t.title}</a>
                <span style={muted}> · due {t.due_at?.slice(0, 10)} · {t.reason.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(review ?? []).length > 0 && (
        <section style={{ ...card, border: '1px solid #7a6a1e' }}>
          <strong>📝 Review darkar ({review!.length})</strong>
          <ul>
            {review!.map((t) => {
              const c = t.clients as unknown as { name: string } | null;
              return (
                <li key={t.id}>
                  <a href={`/tasks/${t.id}`} style={link}>{c?.name ?? '—'} — {t.title}</a>
                  {t.due_at && <span style={muted}> · due {t.due_at.slice(0, 10)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Is hafte ka plan</h2>
        <p style={{ ...muted, fontSize: 13, marginTop: 0 }}>
          Aaj {fmtHours(briefing.today.planned_minutes)} planned ·
          {' '}agle 14 din mein {fmtHours(briefing.capacity_next_14d.free_minutes)} khali
          {' '}({fmtHours(briefing.capacity_next_14d.total_minutes)} total)
        </p>
        {byDay.size === 0 && <p>Kuch scheduled nahi.</p>}
        {[...byDay.entries()].map(([day, items]) => (
          <div key={day}>
            <h3 style={{ fontSize: 14, ...muted }}>{day}</h3>
            <ul style={{ marginTop: 4 }}>
              {items.map((b, i) => (
                <li key={i}>
                  {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}{' '}
                  {b.client ?? '—'} · <a href={`/tasks/${b.task_id}`} style={link}>{b.title}</a>
                  {b.is_locked ? ' 🔒' : ''}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {briefing.stale.length > 0 && (
        <section style={card}>
          <h2 style={{ fontSize: 17 }}>Purane backlog tasks ({briefing.stale.length})</h2>
          <ul>
            {briefing.stale.slice(0, 10).map((t) => (
              <li key={t.id}>
                <a href={`/tasks/${t.id}`} style={link}>{t.client ?? '—'} — {t.title}</a>
                <span style={muted}> · {t.created_at.slice(0, 10)} se pending</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Report drafts</h2>
        {(drafts ?? []).length === 0 && <p>Koi pending draft nahi.</p>}
        <ul>
          {(drafts ?? []).map((d) => {
            const c = d.clients as unknown as { name: string } | null;
            return (
              <li key={d.id}>
                <a href={`/reports/${d.id}`} style={link}>
                  {c?.name ?? '—'} — {d.kind} {d.period_start} → {d.period_end}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <p style={{ ...muted, fontSize: 12 }}>
        Total overflow {briefing.overflow_hours}h · blocked {briefing.blocked.length} ·
        {' '}AI briefing roz ek dafa banti hai, phir cache se aati hai.
      </p>
    </main>
  );
}
