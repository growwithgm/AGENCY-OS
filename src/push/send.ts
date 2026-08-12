/**
 * Web push delivery — the operator's own devices only.
 *
 * Notifications carry attention signals, which are detected
 * deterministically. AI may phrase a body; it never decides that something
 * is worth sending.
 */

import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { pushConfigured } from '@/lib/env';
import { subscriptionOutcome } from './policy';

export type NotificationKind =
  | 'attention' | 'client_request' | 'test';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
};

let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
  return true;
}

/** A missing row means enabled; the master switch turns everything off. */
export async function notificationsEnabled(kind: NotificationKind): Promise<boolean> {
  const { data } = await supabaseAdmin()
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
  const db = supabaseAdmin();

  const log = async (result: SendResult): Promise<SendResult> => {
    await db.from('notification_log').insert({
      kind,
      title: payload.title,
      body: payload.body,
      dedupe_key: opts.dedupeKey ?? null,
      sent_count: result.sent,
      failed_count: result.failed,
      skipped: result.skipped ?? null,
    });
    return result;
  };

  if (!configure()) return log({ sent: 0, failed: 0, skipped: 'push keys not configured' });

  if (!opts.ignoreSettings && !(await notificationsEnabled(kind))) {
    return log({ sent: 0, failed: 0, skipped: 'disabled in settings' });
  }

  // The same unresolved condition must not be sent twice.
  if (opts.dedupeKey) {
    const { data: previous } = await db.from('notification_log')
      .select('dedupe_key')
      .eq('kind', kind)
      .gt('sent_count', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previous?.dedupe_key === opts.dedupeKey) {
      return log({ sent: 0, failed: 0, skipped: 'already notified' });
    }
  }

  const { data: subscriptions } = await db.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('active', true);

  if (!subscriptions?.length) return log({ sent: 0, failed: 0, skipped: 'no devices subscribed' });

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? kind,
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 3600 },
      );
      sent++;
      await db.from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', sub.id);
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number }).statusCode;
      const outcome = subscriptionOutcome(status, sub.failure_count ?? 0);

      if (outcome === 'delete') {
        // The browser threw the subscription away; the row is dead weight.
        await db.from('push_subscriptions').delete().eq('id', sub.id);
      } else if (outcome === 'deactivate') {
        await db.from('push_subscriptions')
          .update({ active: false, failure_count: (sub.failure_count ?? 0) + 1 })
          .eq('id', sub.id);
      } else {
        await db.from('push_subscriptions')
          .update({ failure_count: (sub.failure_count ?? 0) + 1 })
          .eq('id', sub.id);
      }
    }
  }

  return log({ sent, failed });
}
