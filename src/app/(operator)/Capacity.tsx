import { hm } from '@/lib/format';
import { CapacityRail, railState, railInk } from '@/components/CapacityRail';

/**
 * The capacity panel — the product's whole argument in one component.
 *
 * The headline is the number that matters: when work does not fit, it is
 * the amount with nowhere to go; when it does, it is the room left. Today
 * and tomorrow share one scale, so a shorter day renders narrower instead
 * of stretching to full width and lying about it.
 */
export function Capacity({
  dateLabel,
  plannedMinutes,
  availableMinutes,
  overflowMinutes,
  itemCount,
  tomorrow,
  children,
}: {
  dateLabel: string;
  plannedMinutes: number;
  availableMinutes: number;
  overflowMinutes: number;
  itemCount: number;
  tomorrow?: { label: string; availableMinutes: number; plannedMinutes: number; overflowMinutes: number };
  children?: React.ReactNode;
}) {
  const state = railState(availableMinutes, plannedMinutes, overflowMinutes);
  const over = state === 'over';

  const scale = Math.max(
    availableMinutes + overflowMinutes,
    tomorrow ? tomorrow.availableMinutes + tomorrow.overflowMinutes : 0,
    1,
  );

  const mark = over ? '▲' : state === 'tight' ? '●' : '○';
  const word = over ? 'over capacity' : state === 'tight' ? 'tight' : 'fits';

  return (
    <section className={`capacity${over ? ' capacity--over' : ''}`} aria-label="Capacity">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <h1 className="eyebrow" style={{ margin: 0 }}>Today</h1>
        <span className="small dim">{dateLabel}</span>
        <span className="chip" style={{ marginLeft: 'auto', color: railInk(state), background: 'transparent' }}>
          {mark} {word}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 12 }}>
        <span className="capacity__figure" style={{ color: railInk(state) }}>
          {hm(over ? overflowMinutes : Math.max(0, availableMinutes - plannedMinutes))}
        </span>
        <span className="small dim" style={{ paddingBottom: 3 }}>
          {over ? 'of planned work has no zone to go in' : 'unplanned'}
        </span>
      </div>

      <div style={{ marginTop: 14 }}>
        <CapacityRail
          availableMin={availableMinutes}
          plannedMin={plannedMinutes}
          overflowMin={overflowMinutes}
          scaleMinutes={scale}
        />
      </div>

      <div className="spread small dim" style={{ marginTop: 8 }}>
        <span><span className="num">{itemCount}</span> item{itemCount === 1 ? '' : 's'}</span>
        <span className="num">{hm(plannedMinutes)} planned of {hm(availableMinutes)}</span>
      </div>

      {tomorrow && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
          <div className="spread small dim">
            <span>{tomorrow.label}</span>
            <span className="num">
              {tomorrow.overflowMinutes > 0
                ? `${hm(tomorrow.overflowMinutes)} over`
                : `${hm(Math.max(0, tomorrow.availableMinutes - tomorrow.plannedMinutes))} spare`}
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <CapacityRail
              availableMin={tomorrow.availableMinutes}
              plannedMin={tomorrow.plannedMinutes}
              overflowMin={tomorrow.overflowMinutes}
              scaleMinutes={scale}
              small
            />
          </div>
        </div>
      )}

      {children && <div className="row" style={{ marginTop: 12, gap: 8 }}>{children}</div>}
    </section>
  );
}
