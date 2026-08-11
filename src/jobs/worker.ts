// Minimal job queue worker (spec §7.6): report generation runs here,
// not at request time — K3 always reasons, and long calls outlive
// serverless request timeouts. Cron endpoints call drainJobs().

import { db } from '@/lib/db';
import { generateMonthlyDraft, generateWeeklyDraft } from '@/reporting/generate';

const MAX_ATTEMPTS = 3;

export async function enqueue(kind: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await db().from('jobs').insert({ kind, payload });
  if (error) throw new Error(`enqueue failed: ${error.message}`);
}

export async function drainJobs(limit = 10): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;

  for (let i = 0; i < limit; i++) {
    const { data: job } = await db()
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('run_after', new Date().toISOString())
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (!job) break;

    // claim: only proceed if we flipped it from pending ourselves
    const { data: claimed } = await db()
      .from('jobs')
      .update({ status: 'running', attempts: job.attempts + 1 })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue;

    try {
      await runJob(job.kind, job.payload);
      await db().from('jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', job.id);
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const terminal = job.attempts + 1 >= MAX_ATTEMPTS;
      await db().from('jobs').update({
        status: terminal ? 'failed' : 'pending',
        last_error: msg,
        run_after: new Date(Date.now() + 5 * 60000).toISOString(),
        ...(terminal ? { finished_at: new Date().toISOString() } : {}),
      }).eq('id', job.id);
      failed++;
    }
  }

  return { done, failed };
}

async function runJob(kind: string, payload: Record<string, unknown>): Promise<void> {
  switch (kind) {
    case 'weekly_report':
      await generateWeeklyDraft(payload.client_id as string);
      break;
    case 'monthly_report':
      await generateMonthlyDraft(payload.client_id as string);
      break;
    default:
      throw new Error(`unknown job kind: ${kind}`);
  }
}
