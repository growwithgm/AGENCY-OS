import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorised } from '@/lib/machineAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { openSignals, refreshSignals } from '@/data/attention';
import { sendPush } from '@/push/send';

export const maxDuration = 120;

/**
 * Morning: push the attention signals, if there are any worth pushing.
 *
 * A quiet day sends nothing. "You have 8 tasks today" is exactly the
 * notification that teaches someone to ignore the app.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  await refreshSignals(db);

  const signals = await openSignals(db);
  const unnotified = signals.filter((s) => !s.notified_at && s.severity !== 'info');

  if (unnotified.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'nothing needs intervention' });
  }

  // One notification carrying the most severe item, with a count — not one
  // notification per signal.
  const lead = unnotified.find((s) => s.severity === 'risk') ?? unnotified[0];
  const others = unnotified.length - 1;

  const result = await sendPush('attention', {
    title: lead.headline,
    body: others > 0
      ? `${others} other thing${others === 1 ? '' : 's'} need${others === 1 ? 's' : ''} your attention.`
      : 'Open Ledger to deal with it.',
    url: '/',
    tag: 'ledger-attention',
  }, { dedupeKey: unnotified.map((s) => s.id).sort().join(',') });

  if (result.sent > 0) {
    await db.from('attention_signals')
      .update({ notified_at: new Date().toISOString() })
      .in('id', unnotified.map((s) => s.id));
  }

  return NextResponse.json({ ok: true, signals: unnotified.length, ...result });
}
