// Report draft review + approve. This is the human gate (invariant 3) and
// it exists only here — approval is deliberately not exposed over MCP.
// Approved ⇒ the client can read it on the portal; there is no outbound send.

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { approveReport } from '@/reporting/deliver';
import { Nav } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: report } = await db()
    .from('reports')
    .select('*, clients(name)')
    .eq('id', id)
    .maybeSingle();

  if (!report) return <main className="container">Report nahi mila.</main>;
  const client = report.clients as unknown as { name: string } | null;

  async function approve() {
    'use server';
    await approveReport(id);
    revalidatePath(`/reports/${id}`);
    revalidatePath('/');
  }

  return (
    <main className="container container--narrow">
      <Nav />
      <h1>{client?.name} — {report.kind}</h1>
      <p className="muted small">
        {report.period_start} → {report.period_end} · <strong>{report.status}</strong>
        {report.sent_at && ` · portal par live ${report.sent_at.slice(0, 10)}`}
      </p>

      <article className="card prose">{report.narrative_md}</article>

      {report.status === 'draft' ? (
        <form action={approve}>
          <button type="submit" className="btn btn--green">Approve — client portal par live karo</button>
          <p className="muted small">
            Approve karne se ye report client ke portal par dikhne lagegi. Wapas draft nahi hoti.
          </p>
        </form>
      ) : (
        <p className="muted">Ye report approve ho chuki hai — client portal par mojood hai.</p>
      )}

      <p><a href="/reports">← Reports</a></p>
    </main>
  );
}
