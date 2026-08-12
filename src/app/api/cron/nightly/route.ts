import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { db } from '@/lib/db';
import { rebuildSchedule } from '@/scheduler/rebuild';
import { drainJobs } from '@/jobs/worker';
import { expireStaleRequests } from '@/requests/flow';

export const maxDuration = 300;

/** Nightly 02:00 PKT: full schedule rebuild + overdue flags + job drain. Idempotent. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sched = await rebuildSchedule();

  // overdue open tasks get flagged for the dashboard's review list
  const { data: overdue } = await db()
    .from('tasks')
    .select('id')
    .neq('status', 'done')
    .eq('needs_review', false)
    .lt('due_at', new Date().toISOString());

  if (overdue?.length) {
    await db().from('tasks').update({ needs_review: true }).in('id', overdue.map((t) => t.id));
  }

  const expiredRequests = await expireStaleRequests();
  const jobs = await drainJobs();

  return NextResponse.json({
    ok: true,
    blocks: sched.blocks.length,
    overflow: sched.overflow.length,
    cycles: sched.cycles.length,
    overdueFlagged: overdue?.length ?? 0,
    expiredRequests,
    jobs,
  });
}
