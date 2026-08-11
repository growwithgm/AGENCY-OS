import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { db } from '@/lib/db';
import { enqueue, drainJobs } from '@/jobs/worker';
import { notifyOperator } from '@/lib/notify';

export const maxDuration = 300;

/** Friday 17:00 PKT: weekly draft per active client + operator notification. Idempotent. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: clients } = await db().from('clients').select('id, name').eq('status', 'active');

  // skip clients that already have a draft for this period (idempotency)
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

  if (queued) {
    await notifyOperator(
      `📝 ${queued} weekly draft(s) ban gaye. Review: \`/report <slug>\` ya web app → approve.`,
    );
  }
  return NextResponse.json({ ok: true, queued, ...result });
}
