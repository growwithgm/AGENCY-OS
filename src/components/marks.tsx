import { clientColor, MODE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '@/data/types';
import type { WorkMode, WorkStatus } from '@/data/types';

/**
 * The small identity marks, in one place so a client, a mode, a status and
 * a priority read identically on every screen they appear on.
 */

/** A client is never a bare title anywhere in the product (§7.4). */
export function ClientName({ name, colorIndex }: { name: string | null; colorIndex?: number | null }) {
  if (!name) return <span className="dim">Internal</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="client-mark" style={{ background: clientColor(colorIndex) }} aria-hidden />
      {name}
    </span>
  );
}

const MODE_CLASS: Record<WorkMode, React.CSSProperties> = {
  creative: { background: '#f5efe4', color: '#6a4d16', borderColor: '#e3d8bc' },
  technical: { background: '#eaf0f6', color: '#274b73', borderColor: '#c9d8e8' },
  analytical: { background: '#eef2f5', color: '#3c4854', borderColor: '#d5dce2' },
  operational: { background: '#eff3f0', color: '#2f513d', borderColor: '#cfdcd4' },
};

export function ModeChip({ mode }: { mode: WorkMode | null | undefined }) {
  const key = (mode ?? 'operational') as WorkMode;
  return <span className="chip" style={MODE_CLASS[key]}>{MODE_LABELS[key]}</span>;
}

const STATUS_CLASS: Record<WorkStatus, string> = {
  backlog: 'chip--scheduled',
  scheduled: 'chip--scheduled',
  in_progress: 'chip--progress',
  blocked: 'chip--blocked',
  waiting_on_client: 'chip--waiting',
  review: 'chip--pending',
  done: 'chip--done',
};

export function StatusChip({ status }: { status: WorkStatus }) {
  return <span className={`chip ${STATUS_CLASS[status]}`}>{STATUS_LABELS[status]}</span>;
}

const PRIORITY_CLASS: Record<number, string> = {
  1: 'prio--critical', 2: 'prio--high', 3: 'prio--normal', 4: 'prio--low',
};

/** Priority is colour on text, never a filled badge — it ranks, it does not shout. */
export function PriorityMark({ priority }: { priority: number }) {
  return (
    <span className={`prio ${PRIORITY_CLASS[priority] ?? 'prio--normal'}`}>
      {PRIORITY_LABELS[priority] ?? 'Normal'}
    </span>
  );
}
