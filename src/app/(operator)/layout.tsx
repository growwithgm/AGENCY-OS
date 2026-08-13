import type { ReactNode } from 'react';
import { requireOperator } from '@/lib/auth';
import { openDrafts } from '@/data/capture';
import { pendingRequests } from '@/data/requests';
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

  // Two different queues, two different numbers. The Requests badge is only
  // client requests waiting on a decision; parked captures are the
  // operator's own unfinished inbox and belong on the capture button, not
  // conflated onto Requests (the report caught them inflating that count).
  const [drafts, requests] = await Promise.all([
    openDrafts(supabase),
    pendingRequests(supabase),
  ]);

  const dateShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="app">
      <Nav requestCount={requests.length} operatorEmail={session.email} dateShort={dateShort} />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {children}
        <a className="fab" href="/capture" aria-label={`Capture work${drafts.length ? ` — ${drafts.length} in your inbox` : ''}`}>
          +
          {drafts.length > 0 && <span className="fab__count" aria-hidden>{drafts.length}</span>}
        </a>
        <CommandK transcription={transcriptionConfigured()} />
      </div>
    </div>
  );
}
