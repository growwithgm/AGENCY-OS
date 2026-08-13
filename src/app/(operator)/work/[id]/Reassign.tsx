'use client';

import { useState } from 'react';
import { ClientName } from '@/components/marks';
import { reassignClientAction } from './actions';

/**
 * Reassigning is a two-step action on purpose: if the work is visible, it
 * vanishes from one client's portal and appears in another's, and that is
 * the kind of change that should never happen on a stray click.
 */
export function Reassign({ workId, currentClientId, currentClientName, clientVisible, clients }: {
  workId: string;
  currentClientId: string;
  currentClientName: string | null;
  clientVisible: boolean;
  clients: { id: string; name: string; colorIndex: number | null }[];
}) {
  const [choice, setChoice] = useState<string>('');

  const target = clients.find((c) => c.id === choice) ?? null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="label">Belongs to</div>
      <div className="small" style={{ margin: '6px 0 10px' }}>
        <ClientName name={currentClientName} colorIndex={null} />
      </div>

      <select
        className="input"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        aria-label="Move to another client"
      >
        <option value="">Move to another client…</option>
        {clients.filter((c) => c.id !== currentClientId).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {target && (
        <form action={reassignClientAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="work_id" value={workId} />
          <input type="hidden" name="client_id" value={target.id} />
          <input type="hidden" name="confirm" value="yes" />
          <p className="small">
            {clientVisible
              ? `This is currently visible to ${currentClientName}. It will disappear from their portal and appear in ${target.name}'s.`
              : `This is not visible to any client, so nothing changes on either portal. It will be counted as ${target.name}'s work from now on.`}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn--sm btn--danger">
              Move to {target.name}
            </button>
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => setChoice('')}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
