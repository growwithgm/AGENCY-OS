/**
 * The Friday digest: one email per client, per week.
 *
 * Email is transport and nothing else — it is never a source of data, and
 * it carries only what the portal already shows. Client-facing titles, no
 * hours, no estimates, no internal dates, and a date only where a
 * commitment was actually made.
 *
 * Without RESEND_API_KEY nothing is sent and Settings says so. The system
 * does not pretend to have notified anyone.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { t, type Locale } from './copy';

export type DigestSection = { label: string; items: { title: string; date?: string | null }[] };

export type Digest = {
  clientId: string;
  clientName: string;
  locale: Locale;
  recipients: string[];
  sections: DigestSection[];
  /** True when there is genuinely nothing to say. Silence beats noise. */
  empty: boolean;
};

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/** Build one client's digest from the week's work. Pure enough to test. */
export function buildDigest(input: {
  clientId: string;
  clientName: string;
  locale: Locale;
  recipients: string[];
  added: { title: string }[];
  inProgress: { title: string; committed_date: string | null }[];
  completed: { title: string }[];
}): Digest {
  const say = t(input.locale);

  const sections: DigestSection[] = [
    { label: say.completed, items: input.completed.map((w) => ({ title: w.title })) },
    {
      label: say.inProgress,
      items: input.inProgress.map((w) => ({ title: w.title, date: w.committed_date })),
    },
    { label: say.upcoming, items: input.added.map((w) => ({ title: w.title })) },
  ].filter((section) => section.items.length > 0);

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    locale: input.locale,
    recipients: input.recipients,
    sections,
    empty: sections.length === 0,
  };
}

/** Plain text. A weekly note from a person, not a marketing email. */
export function renderDigest(digest: Digest, portalUrl: string): { subject: string; body: string } {
  const say = t(digest.locale);
  const lines: string[] = [say.subtitle, ''];

  for (const section of digest.sections) {
    lines.push(section.label.toUpperCase());
    for (const item of section.items) {
      lines.push(item.date ? `· ${item.title} — ${say.by} ${item.date}` : `· ${item.title}`);
    }
    lines.push('');
  }

  lines.push(portalUrl);

  return {
    subject: digest.locale === 'es'
      ? `Tu semana con nosotros`
      : `Your week with us`,
    body: lines.join('\n'),
  };
}

/** Everything a digest needs, for every client that wants one. */
export async function collectDigests(db: SupabaseClient, now = new Date()): Promise<Digest[]> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const { data: clients } = await db.from('clients')
    .select('id, name, locale, notify_mode')
    .eq('status', 'active')
    .eq('notify_mode', 'digest');

  const digests: Digest[] = [];

  for (const client of clients ?? []) {
    const [workRes, contactsRes] = await Promise.all([
      db.from('tasks')
        .select('title, client_title, status, committed_date, created_at, completed_at')
        .eq('client_id', client.id)
        .eq('client_visible', true),
      db.from('client_contacts')
        .select('email').eq('client_id', client.id).eq('active', true),
    ]);

    const work = workRes.data ?? [];
    // The client-facing title is the only title that leaves the building.
    const name = (w: { title: string; client_title: string | null }) => w.client_title ?? w.title;

    digests.push(buildDigest({
      clientId: client.id,
      clientName: client.name,
      locale: (client.locale as Locale) ?? 'en',
      recipients: (contactsRes.data ?? []).map((c) => c.email),
      completed: work
        .filter((w) => w.status === 'done' && w.completed_at && w.completed_at >= weekAgo)
        .map((w) => ({ title: name(w) })),
      inProgress: work
        .filter((w) => w.status === 'in_progress' || w.status === 'scheduled')
        .map((w) => ({ title: name(w), committed_date: w.committed_date })),
      added: work
        .filter((w) => w.status === 'backlog' && w.created_at >= weekAgo)
        .map((w) => ({ title: name(w) })),
    }));
  }

  return digests;
}

/** Send one digest. Returns what happened, honestly. */
export async function sendDigest(
  digest: Digest,
  portalUrl: string,
): Promise<'sent' | 'skipped_empty' | 'skipped_no_recipients' | 'skipped_not_configured' | 'failed'> {
  if (digest.empty) return 'skipped_empty';
  if (digest.recipients.length === 0) return 'skipped_no_recipients';
  if (!emailConfigured()) return 'skipped_not_configured';

  const { subject, body } = renderDigest(digest, portalUrl);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: digest.recipients,
        subject,
        text: body,
      }),
    });
    if (!response.ok) return 'failed';
  } catch {
    return 'failed';
  }

  await supabaseAdmin().from('notification_log').insert({
    kind: 'client_digest',
    title: subject,
    body: `${digest.clientName} · ${digest.recipients.length} recipients`,
    sent_count: digest.recipients.length,
  });

  return 'sent';
}
