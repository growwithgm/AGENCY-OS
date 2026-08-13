'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MODE_LABELS, STATUS_LABELS } from '@/data/types';
import type { WorkMode, WorkStatus } from '@/data/types';
import { bulkCompleteAction, bulkPushAction } from './[id]/actions';

/**
 * Filters navigate, they do not fetch. The list itself stays a server
 * render, so what is on screen is always what the database says.
 */

export type FilterClient = { id: string; name: string; color_index: number | null };

export function WorkFilters({
  clients, statuses, status, clientId, mode, grouped,
}: {
  clients: FilterClient[];
  statuses: WorkStatus[];
  status: string;
  clientId: string;
  mode: string;
  grouped: boolean;
}) {
  const router = useRouter();

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams({
      ...(status ? { status } : {}),
      ...(clientId ? { client: clientId } : {}),
      ...(mode ? { mode } : {}),
      ...(grouped ? { group: 'client' } : {}),
      ...patch,
    });
    for (const [key, val] of Array.from(next.entries())) {
      if (!val) next.delete(key);
    }
    const query = next.toString();
    router.push(query ? `/work?${query}` : '/work');
  };

  const anyFilter = Boolean(status || clientId || mode);
  const selectStyle = { minHeight: 36, fontSize: 13, padding: '4px 8px', width: 'auto' } as const;

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 14 }}>
      <label className="sr-only" htmlFor="filter-status">Status</label>
      <select
        id="filter-status"
        className="input"
        style={selectStyle}
        value={status}
        onChange={(e) => go({ status: e.target.value })}
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="filter-client">Client</label>
      <select
        id="filter-client"
        className="input"
        style={selectStyle}
        value={clientId}
        onChange={(e) => go({ client: e.target.value })}
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="filter-mode">Kind of work</label>
      <select
        id="filter-mode"
        className="input"
        style={selectStyle}
        value={mode}
        onChange={(e) => go({ mode: e.target.value })}
      >
        <option value="">Any kind of work</option>
        {(Object.keys(MODE_LABELS) as WorkMode[]).map((m) => (
          <option key={m} value={m}>{MODE_LABELS[m]}</option>
        ))}
      </select>

      <button
        type="button"
        className="choice"
        aria-pressed={grouped}
        onClick={() => go({ group: grouped ? '' : 'client' })}
      >
        Group by client
      </button>

      {anyFilter && (
        <button
          type="button"
          className="btn btn--sm btn--quiet"
          onClick={() => router.push(grouped ? '/work?group=client' : '/work')}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * Appears only once something is ticked. It reads the checkboxes of the
 * form it sits in, so the server keeps rendering the rows.
 */
export function BulkBar() {
  const anchor = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const recount = () => {
      setCount(form.querySelectorAll('input[name="work_id"]:checked').length);
    };
    form.addEventListener('change', recount);
    recount();
    return () => form.removeEventListener('change', recount);
  }, []);

  return (
    <div ref={anchor}>
      {count > 0 && (
        <div
          className="flag flag--info"
          style={{
            position: 'sticky', bottom: 14, zIndex: 30, marginTop: 12,
            alignItems: 'center', flexWrap: 'wrap', gap: 10,
            boxShadow: '0 6px 18px -12px rgba(16, 24, 32, .6)',
          }}
        >
          <span>
            <span className="num">{count}</span> selected
          </span>
          <button type="submit" formAction={bulkPushAction} className="btn btn--sm">
            Push to tomorrow
          </button>
          <button type="submit" formAction={bulkCompleteAction} className="btn btn--sm">
            Mark done
          </button>
          <span className="tiny dim" style={{ flexBasis: '100%' }}>
            Pushing moves your plan to tomorrow and leaves every committed date alone.
            Marking done here records no actual time, because this form never asked for any.
          </span>
        </div>
      )}
    </div>
  );
}
