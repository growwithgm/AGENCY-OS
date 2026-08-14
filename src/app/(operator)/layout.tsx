import type { ReactNode } from 'react';
import { requireOperator } from '@/lib/auth';
import { transcriptionConfigured } from '@/data/aiHealth';
import { Nav } from './Nav';
import { CommandK } from './CommandK';

export const dynamic = 'force-dynamic';

/**
 * Operator shell. Re-checks the session on every render — middleware is the
 * first gate, never the only one (INV-9).
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const { session, supabase } = await requireOperator();

  // Two different queues, two different numbers — and only the numbers.
  // These run on every navigation, so they are head-only counts rather
  // than full row fetches.
  const [draftsRes, requestsRes] = await Promise.all([
    supabase.from('capture_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'open'),
    supabase.from('client_requests')
      .select('id', { count: 'exact', head: true })
      .in('state', ['pending_approval', 'clarifying']),
  ]);
  const draftCount = draftsRes.count ?? 0;
  const requestCount = requestsRes.count ?? 0;

  const dateShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="app">
      <Nav requestCount={requestCount} operatorEmail={session.email} dateShort={dateShort} />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {children}
        <a className="fab" href="/capture" aria-label={`Capture work${draftCount ? ` — ${draftCount} in your inbox` : ''}`}>
          +
          {draftCount > 0 && <span className="fab__count" aria-hidden>{draftCount}</span>}
        </a>
        <CommandK transcription={transcriptionConfigured()} />
      </div>
    </div>
  );
}
