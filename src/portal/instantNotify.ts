/**
 * The 'every new item' notify mode.
 *
 * A client set to 'every' gets one plain email the moment something they
 * can actually see happens: a visible piece of work finishing, or an
 * update being published. Same transport rules as the digest — email
 * carries only what the portal already shows, and without RESEND_API_KEY
 * nothing is sent and the client screen says so. The system never pretends
 * to have notified anyone.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailConfigured } from './digest';

export type InstantEvent =
  | { kind: 'work_finished'; title: string }
  | { kind: 'update_published'; body: string };

export type InstantResult =
  | 'sent' | 'skipped_mode' | 'skipped_no_recipients' | 'skipped_not_configured' | 'failed';

export function renderInstant(clientName: string, event: InstantEvent, portalUrl: string): {
  subject: string; body: string;
} {
  if (event.kind === 'work_finished') {
    return {
      subject: 'Just finished for you',
      body: [`We've just finished: ${event.title}`, '', `See it here: ${portalUrl}`].join('\n'),
    };
  }
  return {
    subject: 'An update from us',
    body: [event.body.trim(), '', portalUrl].join('\n'),
  };
}

/**
 * Send at once if — and only if — this client asked for 'every'.
 * Never throws: notifying is a side effect of finishing work, and a mail
 * problem must not turn completing a task into an error.
 */
export async function notifyClientNow(
  db: SupabaseClient,
  clientId: string,
  event: InstantEvent,
  portalUrl: string,
): Promise<InstantResult> {
  try {
    const { data: client } = await db.from('clients')
      .select('name, status, notify_mode')
      .eq('id', clientId).maybeSingle();
    if (!client || client.status !== 'active' || client.notify_mode !== 'every') {
      return 'skipped_mode';
    }
    if (!emailConfigured()) return 'skipped_not_configured';

    const { data: contacts } = await db.from('client_contacts')
      .select('email').eq('client_id', clientId).eq('active', true);
    const recipients = (contacts ?? []).map((c) => c.email).filter(Boolean);
    if (recipients.length === 0) return 'skipped_no_recipients';

    const { subject, body } = renderInstant(client.name, event, portalUrl);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: recipients,
        subject,
        text: body,
      }),
    });
    if (!response.ok) return 'failed';

    await supabaseAdmin().from('notification_log').insert({
      kind: 'client_instant',
      title: subject,
      body: `${client.name} · ${event.kind} · ${recipients.length} recipients`,
      sent_count: recipients.length,
    });

    return 'sent';
  } catch {
    return 'failed';
  }
}
