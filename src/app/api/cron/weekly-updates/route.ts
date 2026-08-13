import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorised } from '@/lib/machineAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listWork } from '@/data/work';
import { listUpdates, createDraft } from '@/data/updates';
import { draftClientUpdate } from '@/ai/jobs/clientUpdate';
import { dateKey } from '@/lib/format';

export const maxDuration = 300;

/**
 * Thursday: draft one update per active client, from the work that
 * actually happened.
 *
 * Drafting is not publishing (INV-7). Each draft lands with the work items
 * every sentence was built from attached, and waits for the operator. A
 * client with nothing to report gets no draft — an update saying "no
 * progress this week" is worse than none.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 86_400_000);

  const { data: clients } = await db.from('clients')
    .select('id, name, locale')
    .eq('status', 'active');

  let drafted = 0;
  let skippedQuiet = 0;
  let skippedExisting = 0;

  for (const client of clients ?? []) {
    // Never two drafts for the same week.
    const existing = await listUpdates(db, client.id);
    if (existing.some((u) => u.status === 'draft' && u.period_end === dateKey(now))) {
      skippedExisting++;
      continue;
    }

    const work = (await listWork(db, { clientId: client.id })).filter((w) => w.client_visible);

    const completed = work.filter(
      (w) => w.status === 'done' && w.completed_at && new Date(w.completed_at) >= periodStart,
    );
    const inProgress = work.filter((w) => w.status === 'in_progress' || w.status === 'scheduled');
    const waiting = work.filter((w) => w.status === 'waiting_on_client' || w.status === 'blocked');

    if (completed.length === 0 && inProgress.length === 0 && waiting.length === 0) {
      skippedQuiet++;
      continue;
    }

    const draft = await draftClientUpdate({
      clientName: client.name,
      locale: (client.locale as 'en' | 'es') ?? 'en',
      periodStart: dateKey(periodStart),
      periodEnd: dateKey(now),
      completed: completed.map((w) => ({
        task_id: w.id, title: w.client_title ?? w.title, completed_at: w.completed_at,
      })),
      inProgress: inProgress.map((w) => ({
        task_id: w.id, title: w.client_title ?? w.title, committed_date: w.committed_date,
      })),
      waitingOnClient: waiting.map((w) => ({
        task_id: w.id, title: w.client_title ?? w.title, reason: w.blocked_reason,
      })),
      upcoming: work
        .filter((w) => w.status === 'backlog')
        .map((w) => ({ task_id: w.id, title: w.client_title ?? w.title })),
    });

    await createDraft(db, {
      clientId: client.id,
      periodStart: dateKey(periodStart),
      periodEnd: dateKey(now),
      body: draft.body,
      evidence: draft.evidence,
      generatedBy: draft.source,
    });
    drafted++;
  }

  return NextResponse.json({
    ok: true,
    drafted,
    skipped_nothing_to_report: skippedQuiet,
    skipped_already_drafted: skippedExisting,
  });
}
