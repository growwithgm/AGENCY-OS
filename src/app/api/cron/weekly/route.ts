import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { db } from '@/lib/db';
import { enqueue, drainJobs } from '@/jobs/worker';
import { cachedEstimateInsight } from '@/ai/judgement';

export const maxDuration = 300;

/**
 * Friday 17:00 PKT: weekly draft per active client, plus the weekly
 * estimate-accuracy insight. Idempotent.
 * Drafts wait on the web app for review + approval (invariant 3).
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: clients } = await db().from('clients').select('id').eq('status', 'active');
  const periodEnd = new Date().toISOString().slice(0, 10);

  let queued = 0;
  for (const client of clients ?? []) {
    const { data: existing } = await db()
      .from('reports')
      .select('id')
      .eq('client_id', client.id)
      .eq('kind', 'weekly')
      .eq('period_end', periodEnd)
      .maybeSingle();
    if (existing) continue;
    await enqueue('weekly_report', { client_id: client.id });
    queued++;
  }

  const result = await drainJobs(queued + 5);

  // estimate insight is advisory only — it never rewrites estimates
  let estimateInsight = false;
  try {
    await cachedEstimateInsight();
    estimateInsight = true;
  } catch {
    // best-effort: a failed insight must not fail the report run
  }

  return NextResponse.json({ ok: true, queued, estimateInsight, ...result });
}
