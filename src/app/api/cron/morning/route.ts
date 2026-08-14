import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorised } from '@/lib/machineAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { openSignals, refreshSignals } from '@/data/attention';
import { notify, flushQueue } from '@/push/queue';

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

  // Anything held for a delivery window that has now opened goes first.
  const flushed = await flushQueue();

  const signals = await openSignals(db);
  const unnotified = signals.filter((s) => !s.notified_at && s.severity !== 'info');

  if (unnotified.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'nothing needs intervention', ...flushed });
  }

  // One notification carrying the most severe item, with a count — not one
  // notification per signal.
  const lead = unnotified.find((s) => s.severity === 'risk') ?? unnotified[0];
  const others = unnotified.length - 1;

  // A committed deadline that has become impossible is the one attention
  // signal that cannot wait for a window: the decision it forces expires.
  const impossible = unnotified.some((s) =>
    s.signal_type === 'cannot_fit_before_date' || s.signal_type === 'overdue_commitment');

  const outcome = await notify({
    kind: 'attention',
    urgency: impossible ? 'urgent' : 'routine',
    payload: {
      title: lead.headline,
      body: others > 0
        ? `${others} other thing${others === 1 ? '' : 's'} need${others === 1 ? 's' : ''} your attention.`
        : 'Open Agency OS to deal with it.',
      url: '/',
      tag: 'agency-attention',
    },
    dedupeKey: unnotified.map((s) => s.id).sort().join(','),
  });

  const result = { outcome };

  // Stamp only what was genuinely handled: delivered to a device, or held
  // in the queue that will deliver it at the next window. A skipped send —
  // no devices, keys missing, everything failed — leaves the signals
  // unstamped so tomorrow's run tries again instead of going silent.
  if (outcome === 'sent' || outcome === 'held') {
    await db.from('attention_signals')
      .update({ notified_at: new Date().toISOString() })
      .in('id', unnotified.map((s) => s.id));
  }

  return NextResponse.json({ ok: true, signals: unnotified.length, ...result, ...flushed });
}
