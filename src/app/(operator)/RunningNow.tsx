import { hm } from '@/lib/format';
import { ClientName } from '@/components/marks';
import { completeWorkAction, pushWorkAction } from './actions';

/**
 * What is running right now. It sits above the plan because the only
 * thing more useful than knowing what to do next is knowing what you are
 * already doing.
 */
export function RunningNow({ item }: {
  item: {
    id: string;
    title: string;
    clientName: string | null;
    colorIndex: number | null;
    estMinutes: number;
    actualMinutes: number;
  } | null;
}) {
  if (!item) return null;

  const left = Math.max(0, item.estMinutes - item.actualMinutes);

  return (
    <div className="card card--accent">
      <div className="row" style={{ alignItems: 'center', gap: 7 }}>
        <span
          className="flag__dot"
          style={{ background: 'var(--green)', marginTop: 0, animation: 'pulse 2s infinite' }}
          aria-hidden
        />
        <span className="eyebrow">Running now</span>
        <span
          className="num"
          style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 600, letterSpacing: '-.03em' }}
        >
          {hm(item.actualMinutes)}
        </span>
      </div>

      <a href={`/work/${item.id}`} style={{ display: 'block', paddingTop: 6, color: 'inherit', textDecoration: 'none' }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>{item.title}</div>
        <div className="small dim" style={{ marginTop: 2 }}>
          <ClientName name={item.clientName} colorIndex={item.colorIndex} />
          {' · '}
          <span className="num">{hm(left)}</span> left on the estimate
        </div>
      </a>

      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <form action={completeWorkAction} className="row" style={{ gap: 6 }}>
          <input type="hidden" name="work_id" value={item.id} />
          <input
            name="minutes"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="mins"
            aria-label="Actual minutes"
            className="input"
            style={{ width: 84, minHeight: 34, fontSize: 14, padding: '6px 10px' }}
          />
          <button type="submit" className="btn btn--sm btn--primary">Done</button>
        </form>
        <form action={pushWorkAction}>
          <input type="hidden" name="work_id" value={item.id} />
          <button type="submit" className="btn btn--sm">Push to tomorrow</button>
        </form>
      </div>
    </div>
  );
}
