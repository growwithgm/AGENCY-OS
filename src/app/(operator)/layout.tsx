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
  const { supabase } = await requireOperator();

  // The inbox badge is the one number carried across every screen: unseen
  // work waiting on a decision.
  const [drafts, requests] = await Promise.all([
    openDrafts(supabase),
    pendingRequests(supabase),
  ]);
  const inboxCount = drafts.length + requests.length;

  return (
    <div className="app">
      <Nav inboxCount={inboxCount} />
      {children}
    </div>
  );
}
