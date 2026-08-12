// Approval + delivery. Delivery channel is the portal only: an approved
// report becomes readable to the client through RLS the moment it flips
// status. There is no outbound push — no email, no WhatsApp.
//
// Approval is a human gate (invariant 3) and lives on the web app only —
// it is deliberately not exposed over MCP.

import { db } from '@/lib/db';

export async function approveReport(reportId: string): Promise<void> {
  const { data, error } = await db()
    .from('reports')
    .update({ status: 'approved', sent_at: new Date().toISOString(), sent_via: 'portal' })
    .eq('id', reportId)
    .eq('status', 'draft')
    .select('id');
  if (error) throw new Error(`approve failed: ${error.message}`);
  if (!data?.length) throw new Error('report not found, or not in draft state');
  // approved ⇒ live on the portal immediately (RLS lets clients read approved/sent)
}
