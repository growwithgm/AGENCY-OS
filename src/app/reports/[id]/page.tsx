// Report draft review + approve. This is the human gate (invariant 3) and
// it exists only here — approval is deliberately not exposed over MCP.
// Approved ⇒ the client can read it on the portal; there is no outbound send.

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { approveReport } from '@/reporting/deliver';
import { buttonGreen, card, link, muted, Nav } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: report } = await db()
    .from('reports')
    .select('*, clients(name)')
    .eq('id', id)
    .maybeSingle();

  if (!report) return <main style={{ padding: 24 }}>Report nahi mila.</main>;
  const client = report.clients as unknown as { name: string } | null;

  async function approve() {
    'use server';
    await approveReport(id);
    revalidatePath(`/reports/${id}`);
    revalidatePath('/');
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <Nav />
      <h1 style={{ fontSize: 20 }}>
        {client?.name} — {report.kind} {report.period_start} → {report.period_end}
      </h1>
      <p>
        Status: <strong>{report.status}</strong>
        {report.sent_at && <span style={muted}> · portal par live {report.sent_at.slice(0, 10)}</span>}
      </p>

      <article style={{ ...card, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {report.narrative_md}
      </article>

      {report.status === 'draft' ? (
        <form action={approve}>
          <button type="submit" style={buttonGreen}>Approve — client portal par live karo</button>
          <p style={{ ...muted, fontSize: 13 }}>
            Approve karne se ye report client ke portal par dikhne lagegi. Wapas draft nahi hoti.
          </p>
        </form>
      ) : (
        <p style={muted}>Ye report approve ho chuki hai — client portal par mojood hai.</p>
      )}

      <p style={{ marginTop: 20 }}><a href="/" style={link}>← Dashboard</a></p>
    </main>
  );
}
