import { requireOperator } from '@/lib/auth';
import { listClients } from '@/data/clients';
import { CaptureFlow } from './CaptureFlow';

export const dynamic = 'force-dynamic';

/**
 * Capture — one large input, then a parsed draft to review.
 * Nothing is saved until Confirm (INV-4).
 */
export default async function CapturePage() {
  const { supabase } = await requireOperator();
  const clients = await listClients(supabase);

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">New work</div>
          <h1 className="page-title">Capture</h1>
        </div>
        <a href="/" className="btn btn--sm">Cancel</a>
      </div>

      <CaptureFlow clients={clients.map((c) => ({ id: c.id, name: c.name, colorIndex: c.color_index }))} />
    </main>
  );
}
