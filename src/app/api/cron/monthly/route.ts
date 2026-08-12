import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { db } from '@/lib/db';
import { enqueue, drainJobs } from '@/jobs/worker';

export const maxDuration = 300;

/**
 * 1st of month 09:00 PKT: monthly draft per active client. Idempotent.
 * Drafts wait on the web app for review + approval (invariant 3).
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: clients } = await db().from('clients').select('id').eq('status', 'active');
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

  let queued = 0;
  for (const client of clients ?? []) {
    const { data: existing } = await db()
      .from('reports')
      .select('id')
      .eq('client_id', client.id)
      .eq('kind', 'monthly')
      .eq('period_start', periodStart)
      .maybeSingle();
    if (existing) continue;
    await enqueue('monthly_report', { client_id: client.id });
    queued++;
  }

  const result = await drainJobs(queued + 5);
  return NextResponse.json({ ok: true, queued, ...result });
}
