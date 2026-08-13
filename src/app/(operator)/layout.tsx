import type { ReactNode } from 'react';
import { requireOperator } from '@/lib/auth';
import { openDrafts } from '@/data/capture';
import { pendingRequests } from '@/data/requests';
import { Nav } from './Nav';

export const dynamic = 'force-dynamic';

/**
 * Operator shell. Re-checks the session on every render — middleware is the
 * first gate, never the only one (INV-9).
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const { session, supabase } = await requireOperator();

  // The one badge carried across every screen: things waiting on a decision.
  const [drafts, requests] = await Promise.all([
    openDrafts(supabase),
    pendingRequests(supabase),
  ]);
  const badgeCount = drafts.length + requests.length;

  const dateShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="app">
      <Nav badgeCount={badgeCount} operatorEmail={session.email} dateShort={dateShort} />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {children}
        <a className="fab" href="/capture" aria-label="Capture work">+</a>
      </div>
    </div>
  );
}
