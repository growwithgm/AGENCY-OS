// Delivery. Approval is the gate: this module refuses anything not approved.
// Channels: portal (automatic — approved reports become visible via RLS),
// email, and WhatsApp summary via Wasify (spec §12).

import { db } from '@/lib/db';
import { env } from '@/lib/env';

export async function approveReport(reportId: string): Promise<void> {
  const { error } = await db()
    .from('reports')
    .update({ status: 'approved' })
    .eq('id', reportId)
    .eq('status', 'draft');
  if (error) throw new Error(`approve failed: ${error.message}`);
  // approved ⇒ live on the portal immediately (RLS lets clients read approved/sent)
}

export async function deliverReport(reportId: string, via: 'email' | 'whatsapp'): Promise<void> {
  const { data: report } = await db()
    .from('reports')
    .select('*, clients(name, contact_email, contact_wa, brand_slug)')
    .eq('id', reportId)
    .single();
  if (!report) throw new Error('report not found');
  if (report.status !== 'approved' && report.status !== 'sent') {
    throw new Error('report is not approved — refusing to deliver a draft (invariant 3)');
  }

  const client = report.clients as { name: string; contact_email: string | null; contact_wa: string | null };
  const { data: tokenRow } = await db()
    .from('client_portal_tokens')
    .select('token')
    .eq('client_id', report.client_id)
    .eq('revoked', false)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const portalLink = tokenRow ? `${env.APP_BASE_URL}/c/${tokenRow.token}` : null;

  if (via === 'email') {
    if (!client.contact_email) throw new Error('client has no contact_email');
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'GROW NEST <reports@grownest.agency>',
        to: client.contact_email,
        subject: `${client.name} — ${report.kind === 'weekly' ? 'Weekly' : 'Monthly'} update ${report.period_start} → ${report.period_end}`,
        text: report.narrative_md + (portalLink ? `\n\nPortal: ${portalLink}` : ''),
      }),
    });
    if (!res.ok) throw new Error(`email delivery failed: ${res.status} ${await res.text()}`);
  }

  if (via === 'whatsapp') {
    if (!client.contact_wa) throw new Error('client has no contact_wa');
    if (!env.WASIFY_API_KEY) throw new Error('WASIFY_API_KEY not configured');
    // short summary + portal link — not the whole report (spec §12)
    const firstLine = (report.narrative_md as string).split('\n').find((l: string) => l.trim()) ?? 'Update ready';
    const res = await fetch('https://api.wasify.io/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WASIFY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: client.contact_wa,
        text: `${firstLine}${portalLink ? `\n\nFull report: ${portalLink}` : ''}`,
      }),
    });
    if (!res.ok) throw new Error(`wasify delivery failed: ${res.status} ${await res.text()}`);
  }

  await db().from('reports').update({
    status: 'sent',
    sent_at: new Date().toISOString(),
    sent_via: via,
  }).eq('id', reportId);
}
