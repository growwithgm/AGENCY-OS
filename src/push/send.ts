// Web Push delivery. Every send is logged; dead subscriptions are pruned
// automatically so a lost device never blocks future notifications.

import webpush from 'web-push';
import { db } from '@/lib/db';
import { subscriptionOutcome } from './policy';

export type NotificationKind =
  | 'morning_briefing' | 'overload_alert' | 'evening_check'
  | 'report_drafts' | 'stale_tasks' | 'client_request' | 'test';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;      // same tag replaces the older notification instead of stacking
};

let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

/** Missing row = enabled. The master switch turns everything off at once. */
export async function notificationsEnabled(kind: NotificationKind): Promise<boolean> {
  const { data } = await db()
    .from('notification_settings')
    .select('kind, enabled')
    .in('kind', ['master', kind]);

  const master = (data ?? []).find((r) => r.kind === 'master');
  if (master && master.enabled === false) return false;
  const own = (data ?? []).find((r) => r.kind === kind);
  return own ? own.enabled !== false : true;
}

export type SendResult = { sent: number; failed: number; skipped?: string };

export async function sendPush(
  kind: NotificationKind,
  payload: PushPayload,
  opts: { dedupeKey?: string; ignoreSettings?: boolean } = {},
): Promise<SendResult> {
  const log = async (r: SendResult) => {
    await db().from('notification_log').insert({
      kind,
      title: payload.title,
      body: payload.body,
      dedupe_key: opts.dedupeKey ?? null,
      sent_count: r.sent,
      failed_count: r.failed,
      skipped: r.skipped ?? null,
    });
    return r;
  };

  if (!configure()) return log({ sent: 0, failed: 0, skipped: 'VAPID keys not configured' });
  if (!opts.ignoreSettings && !(await notificationsEnabled(kind))) {
    return log({ sent: 0, failed: 0, skipped: 'disabled in settings' });
  }

  // same situation as the last send of this kind → stay quiet
  if (opts.dedupeKey) {
    const { data: prev } = await db()
      .from('notification_log')
      .select('dedupe_key')
      .eq('kind', kind)
      .gt('sent_count', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev?.dedupe_key === opts.dedupeKey) {
      return log({ sent: 0, failed: 0, skipped: 'duplicate of last notification' });
    }
  }

  const { data: subs } = await db()
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('active', true);

  if (!subs?.length) return log({ sent: 0, failed: 0, skipped: 'no active subscriptions' });

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? kind,
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 60 * 60 },
      );
      sent++;
      await db().from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', sub.id);
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number }).statusCode;
      const outcome = subscriptionOutcome(status, sub.failure_count ?? 0);
      if (outcome === 'delete') {
        await db().from('push_subscriptions').delete().eq('id', sub.id);
      } else if (outcome === 'deactivate') {
        await db().from('push_subscriptions')
          .update({ active: false, failure_count: (sub.failure_count ?? 0) + 1 })
          .eq('id', sub.id);
      } else {
        await db().from('push_subscriptions')
          .update({ failure_count: (sub.failure_count ?? 0) + 1 })
          .eq('id', sub.id);
      }
    }
  }

  return log({ sent, failed });
}
