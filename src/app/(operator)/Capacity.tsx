import { hm } from '@/lib/format';

/**
 * The capacity bar — the primary visual element of Today, and the product's
 * whole argument in one component.
 *
 * When work fits, it states the buffer rather than implying it. When it does
 * not, the overflow is drawn as hatching and the shortfall is said plainly:
 * "6h 30m planned of 5h — 1h 30m won't fit".
 */
export function Capacity({
  plannedMinutes,
  availableMinutes,
  itemCount,
  willNotFitCount,
  children,
}: {
  plannedMinutes: number;
  availableMinutes: number;
  itemCount: number;
  willNotFitCount?: number;
  children?: React.ReactNode;
}) {
  const over = plannedMinutes > availableMinutes;
  const shortfall = plannedMinutes - availableMinutes;
  const buffer = availableMinutes - plannedMinutes;

  const denominator = Math.max(plannedMinutes, availableMinutes, 1);
  const fitPct = Math.min(plannedMinutes, availableMinutes) / denominator * 100;
  const overPct = over ? (shortfall / denominator) * 100 : 0;

  return (
    <section className={`capacity${over ? ' capacity--over' : ''}`} aria-label="Capacity today">
      <div className="spread">
        <span className="small" style={{ color: over ? 'var(--risk)' : 'var(--text-2)' }}>
          Capacity today
        </span>
        <span className="small num" style={{ color: over ? 'var(--risk)' : 'var(--ok)' }}>
          {over ? `${hm(shortfall)} over` : 'Fits'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span className="capacity__figure">{hm(plannedMinutes)}</span>
        <span className="small muted">planned of {hm(availableMinutes)}</span>
      </div>

      <div className="bar">
        <div className="bar__fill" style={{ width: `${fitPct}%` }} />
        {over && <div className="bar__over" style={{ width: `${overPct}%` }} />}
      </div>

      <div className="spread small" style={{ color: over ? 'var(--risk)' : 'var(--text-2)' }}>
        <span className="num">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
        <span className="num">
          {over
            ? `${willNotFitCount ?? 0} will not fit`
            : `${hm(Math.max(0, buffer))} buffer left`}
        </span>
      </div>

      {children && <div className="row" style={{ marginTop: 12 }}>{children}</div>}
    </section>
  );
}
