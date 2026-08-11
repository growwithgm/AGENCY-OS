// Report draft review + approve (operator only — this app sits behind the
// operator's auth layer / private deployment; the client portal is /c/<token>).

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { approveReport } from '@/reporting/deliver';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: report } = await db()
    .from('reports')
    .select('*, clients(name)')
    .eq('id', id)
    .single();

  if (!report) return <main style={{ padding: 24 }}>Report nahi mila.</main>;
  const client = report.clients as unknown as { name: string } | null;

  async function approve() {
    'use server';
    await approveReport(id);
    revalidatePath(`/reports/${id}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <a href="/" style={{ color: '#7aa2f7' }}>← Dashboard</a>
      <h1 style={{ fontSize: 20 }}>
        {client?.name} — {report.kind} {report.period_start} → {report.period_end}
      </h1>
      <p>Status: <strong>{report.status}</strong></p>

      <article style={{
        background: '#171a21', borderRadius: 12, padding: 20, whiteSpace: 'pre-wrap', lineHeight: 1.6,
      }}>
        {report.narrative_md}
      </article>

      {report.status === 'draft' && (
        <form action={approve} style={{ marginTop: 16 }}>
          <button type="submit" style={{
            background: '#2e7d32', color: 'white', border: 'none',
            borderRadius: 8, padding: '10px 20px', fontSize: 15, cursor: 'pointer',
          }}>
            Approve — client tak jaye
          </button>
        </form>
      )}
    </main>
  );
}
