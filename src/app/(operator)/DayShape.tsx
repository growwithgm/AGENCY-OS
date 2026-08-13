import { hm } from '@/lib/format';
import { clientColor, MODE_LABELS } from '@/data/types';
import type { ZoneShape } from '@/data/zones';

/**
 * "The shape of today" — the day as the scheduler sees it: named windows,
 * what each admits, and what is actually booked into it.
 *
 * The mode-switch count sits at the top because a scattered day costs real
 * hours that no capacity number shows.
 */
export function DayShape({ zones, modeSwitches }: { zones: ZoneShape[]; modeSwitches: number }) {
  if (zones.length === 0) {
    return (
      <div className="card">
        <h2 className="section-label" style={{ margin: 0 }}><span>The shape of today</span></h2>
        <p className="small dim" style={{ marginTop: 8 }}>
          No zones are set for today, so nothing can be scheduled. Add them in Settings.
        </p>
      </div>
    );
  }

  const busy = modeSwitches > 3;
  const note = modeSwitches === 0
    ? 'one kind of work all day'
    : busy
      ? 'each switch costs you the run-up again'
      : 'a reasonable amount of context switching';

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
        <h2 className="section-label" style={{ margin: 0 }}><span>The shape of today</span></h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 12px' }}>
        <span className="num" style={{ fontSize: 20, fontWeight: 600, color: busy ? 'var(--red-deep)' : 'var(--ink-900)' }}>
          {modeSwitches}
        </span>
        <span className="small">mode switches today</span>
        <span className="tiny dim">— {note}</span>
      </div>

      {zones.map((zone) => {
        const scale = Math.max(zone.availableMinutes, zone.plannedMinutes, 1);
        return (
          <div key={zone.zone} className="zone">
            <div className="zone__head">
              <span className="zone__name">{zone.zone}</span>
              <span className="num tiny">{zone.start}–{zone.end}</span>
              <span className="tiny dim">{zone.modes.map((m) => MODE_LABELS[m]).join(', ')}</span>
              <span className="num tiny dim" style={{ marginLeft: 'auto' }}>
                {hm(zone.plannedMinutes)} of {hm(zone.availableMinutes)}
              </span>
            </div>
            <div className="zone__track">
              {zone.segments.map((segment, i) => (
                <div
                  key={`${segment.taskId}-${i}`}
                  className="zone__seg"
                  style={{
                    width: `${(segment.minutes / scale) * 100}%`,
                    background: clientColor(segment.colorIndex),
                  }}
                  title={`${MODE_LABELS[segment.mode]} · ${hm(segment.minutes)}`}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
