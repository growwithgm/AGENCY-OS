/**
 * The notification queue.
 *
 * Everything the system wants to say goes through here, and the window
 * rules decide when it is actually said. What is held accumulates and
 * arrives as one message, so a quiet morning does not become eleven
 * separate interruptions at 13:00.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendPush, type NotificationKind, type PushPayload } from './send';
import { decide, combine, type Urgency, type Zone } from './windows';

async function zones(): Promise<Zone[]> {
  const { data } = await supabaseAdmin()
    .from('day_zones')
    .select('weekday, name, start_time, end_time');

  return (data ?? []).map((z) => ({
    weekday: z.weekday,
    name: z.name,
    start_time: String(z.start_time).slice(0, 5),
    end_time: String(z.end_time).slice(0, 5),
  }));
}

/** Default on: peak is the only stretch where deep work is possible. */
async function peakBlackoutEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('notification_settings')
    .select('enabled')
    .eq('kind', 'peak_blackout')
    .maybeSingle();

  return data?.enabled !== false;
}

export type QueueInput = {
  kind: NotificationKind;
  urgency: Urgency;
  payload: PushPayload;
  dedupeKey?: string;
};

/**
 * Send now if the rules allow it, otherwise hold it for the next window.
 *
 * The answer is honest: 'sent' only when a device actually received the
 * push. No devices, keys missing, disabled in settings, or every send
 * failing all come back as 'skipped' — so a caller stamping "the operator
 * has been told" never stamps a message nobody got.
 */
export async function notify(input: QueueInput, at = new Date()): Promise<'sent' | 'held' | 'skipped'> {
  const decision = decide(at, input.urgency, await zones(), {
    peakBlackout: await peakBlackoutEnabled(),
  });

  if (decision.deliver) {
    const result = await sendPush(input.kind, input.payload, { dedupeKey: input.dedupeKey });
    if (result.sent > 0) return 'sent';
    // 'already notified' means an earlier send genuinely went out — for the
    // caller that is the same fact as 'sent': the operator has been told.
    if (result.skipped === 'already notified') return 'sent';
    return 'skipped';
  }

  await supabaseAdmin().from('notification_queue').insert({
    kind: input.kind,
    title: input.payload.title,
    body: input.payload.body ?? null,
    url: input.payload.url ?? null,
    tag: input.payload.tag ?? null,
    urgent: input.urgency === 'urgent',
    deliver_after: decision.deliverAfter.toISOString(),
  });

  return 'held';
}

/**
 * Deliver whatever is now due, as one message. Called by the cron routes;
 * safe to call at any interval — it only acts on rows whose time has come.
 */
export async function flushQueue(at = new Date()): Promise<{ delivered: number; messages: number }> {
  const db = supabaseAdmin();

  const { data: due } = await db.from('notification_queue')
    .select('id, kind, title, body, url, tag, urgent')
    .is('delivered_at', null)
    .lte('deliver_after', at.toISOString())
    .order('created_at');

  if (!due || due.length === 0) return { delivered: 0, messages: 0 };

  // Re-check: something held for 09:00 must not land in a peak that has
  // since been moved, and the operator may have turned the rules on since.
  const decision = decide(at, 'routine', await zones(), {
    peakBlackout: await peakBlackoutEnabled(),
  });
  if (!decision.deliver && decision.reason === 'peak_blackout') {
    await db.from('notification_queue')
      .update({ deliver_after: decision.deliverAfter.toISOString() })
      .in('id', due.map((r) => r.id));
    return { delivered: 0, messages: 0 };
  }

  // One message per kind, so an attention signal and a client request stay
  // distinguishable at a glance.
  const byKind = new Map<string, typeof due>();
  for (const row of due) {
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  }

  let messages = 0;
  for (const [kind, rows] of byKind) {
    const merged = combine(rows.map((r) => ({ title: r.title, body: r.body })));
    await sendPush(kind as NotificationKind, {
      title: merged.title,
      body: merged.body,
      url: rows.length === 1 ? rows[0].url ?? undefined : '/',
      tag: rows.length === 1 ? rows[0].tag ?? undefined : `held-${kind}`,
    });
    messages++;
  }

  await db.from('notification_queue')
    .update({ delivered_at: at.toISOString() })
    .in('id', due.map((r) => r.id));

  return { delivered: due.length, messages };
}
