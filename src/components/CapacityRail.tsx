import { hm } from '@/lib/format';

/**
 * The signature element, rebuilt exactly from the prototype.
 *
 * The track is the day's available minutes, ended by a hard 2px limit
 * line. Work inside capacity fills the track; work that cannot fit
 * renders as a striped red segment that visibly extends PAST the limit,
 * taller than the track itself. The two segments share one flex row, so
 * their widths stay proportional to real minutes.
 *
 * `scaleMinutes` lets two rails (today and tomorrow) share one scale:
 * pass the larger day's total so the shorter day renders narrower rather
 * than lying by stretching to full width.
 */
export type RailState = 'fits' | 'tight' | 'over';

export function railState(availableMin: number, plannedMin: number, overflowMin: number): RailState {
  if (overflowMin > 0) return 'over';
  if (availableMin > 0 && plannedMin / availableMin >= 0.85) return 'tight';
  return 'fits';
}

/** Ink colour for headline numbers that sit beside the rail. */
export function railInk(state: RailState): string {
  if (state === 'over') return 'var(--red)';
  if (state === 'tight') return 'var(--amber)';
  return 'var(--ink-600)';
}

export function CapacityRail({
  availableMin,
  plannedMin,
  overflowMin = 0,
  scaleMinutes,
  small = false,
}: {
  availableMin: number;
  plannedMin: number;
  overflowMin?: number;
  scaleMinutes?: number;
  small?: boolean;
}) {
  const avail = Math.max(availableMin, 0);
  const over = Math.max(overflowMin, 0);
  const inside = Math.max(Math.min(plannedMin - over, avail), 0);
  const state = railState(avail, plannedMin, over);

  const total = avail + over;
  const scale = Math.max(scaleMinutes ?? total, total, 1);
  // One tick per hour, drawn onto the track background.
  const tickPct = avail > 0 ? (60 / avail) * 100 : 100;

  return (
    <div
      className="caprail"
      style={{ width: `${(total / scale) * 100}%` }}
      role="img"
      aria-label={
        over > 0
          ? `${hm(plannedMin)} planned against ${hm(avail)} available — ${hm(over)} does not fit`
          : `${hm(plannedMin)} planned against ${hm(avail)} available`
      }
    >
      <div
        className={`caprail__track${small ? ' caprail__track--sm' : ''}`}
        style={{
          flex: `${Math.max(avail, 1)}`,
          backgroundImage: `repeating-linear-gradient(90deg, rgba(16,24,32,.14) 0 1px, transparent 1px ${tickPct}%)`,
        }}
      >
        <div
          className={`caprail__fill${state !== 'fits' ? ' caprail__fill--hot' : ''}`}
          style={{ width: `${avail > 0 ? (inside / avail) * 100 : 0}%` }}
        />
      </div>
      {over > 0 && <div className="caprail__spill" style={{ flex: `${over}` }} />}
    </div>
  );
}
