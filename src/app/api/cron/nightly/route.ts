import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { db } from '@/lib/db';
import { syncAllConnectors } from '@/connectors';
import { rebuildSchedule } from '@/scheduler/rebuild';
import { detectAnomalies, explainAnomaly } from '@/reporting/anomaly';
import { expireStaleSessions } from '@/capture/session';
import { drainJobs } from '@/jobs/worker';
import { notifyOperator } from '@/lib/notify';

export const maxDuration = 300;

/** Nightly 02:00 PKT: sync → rebuild → overdue flags → anomalies (spec §13). Idempotent. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const summary: Record<string, unknown> = {};

  // 1. connector sync — failures are loud, not silent
  const failures = await syncAllConnectors();
  summary.syncFailures = failures.length;
  if (failures.length) {
    await notifyOperator(
      `⚠️ Connector failures:\n${failures.map((f) => `· ${f.source}: ${f.error.slice(0, 200)}`).join('\n')}`,
    );
  }

  // 2. scheduler rebuild
  const sched = await rebuildSchedule();
  summary.blocks = sched.blocks.length;
  summary.overflow = sched.overflow.length;

  // 3. overdue flags → operator ping
  const { data: overdue } = await db()
    .from('tasks')
    .select('title, due_at, clients(name)')
    .neq('status', 'done')
    .lt('due_at', new Date().toISOString());
  summary.overdue = overdue?.length ?? 0;
  if (overdue?.length) {
    const lines = overdue.map((t) => {
      const c = t.clients as unknown as { name: string } | null;
      return `· ${c?.name ?? '—'} — ${t.title} (due ${t.due_at?.slice(0, 10)})`;
    });
    await notifyOperator(`⏰ Overdue tasks:\n${lines.join('\n')}`);
  }

  // 4. anomaly detection (deterministic) → AI explanation → operator ping
  const { data: clients } = await db().from('clients').select('id, name').eq('status', 'active');
  let anomalyCount = 0;
  for (const client of clients ?? []) {
    const anomalies = await detectAnomalies(client.id);
    anomalyCount += anomalies.length;
    for (const a of anomalies) {
      try {
        const ex = await explainAnomaly(a, client.name);
        await notifyOperator(
          `📈 **${client.name}** — ${a.source}/${a.metric} ${a.direction} normal ` +
          `(${a.value} vs mean ${a.mean} ± ${a.stddev})\n${ex.explanation}\n` +
          `Suggested task: ${ex.suggestedTask.title} (~${ex.suggestedTask.est_minutes}min)`,
        );
      } catch {
        await notifyOperator(
          `📈 **${client.name}** — anomaly: ${a.source}/${a.metric} = ${a.value} ` +
          `(mean ${a.mean} ± ${a.stddev}) — explanation failed, raw numbers above.`,
        );
      }
    }
  }
  summary.anomalies = anomalyCount;

  // housekeeping: expire idle capture sessions, drain queued jobs
  summary.expiredSessions = await expireStaleSessions();
  summary.jobs = await drainJobs();

  return NextResponse.json({ ok: true, ...summary });
}
