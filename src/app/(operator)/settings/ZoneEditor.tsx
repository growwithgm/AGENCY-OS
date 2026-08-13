'use client';

import { useState } from 'react';
import { hm } from '@/lib/format';
import { MODE_LABELS } from '@/data/types';
import { MODES, type WorkMode } from '@/engines/planner/types';
import { addZoneAction, removeZoneAction, saveZoneAction } from './actions';

export type EditableZone = {
  id: string;
  weekday: number;
  name: string;
  start_time: string;
  end_time: string;
  modes: WorkMode[];
};

type Props = { weekdayNames: string[]; zones: EditableZone[] };

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** End at or before start means the zone runs past midnight. */
const zoneMinutes = (start: string, end: string): number => {
  const a = toMinutes(start);
  const b = toMinutes(end);
  return b > a ? b - a : b + 1440 - a;
};

export function ZoneEditor({ weekdayNames, zones }: Props) {
  return (
    <div>
      {weekdayNames.map((dayName, weekday) => {
        const dayZones = zones
          .filter((z) => z.weekday === weekday)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const total = dayZones.reduce((sum, z) => sum + zoneMinutes(z.start_time, z.end_time), 0);

        return (
          <div key={weekday} className="zone">
            <div className="zone__head">
              <span className="zone__name">{dayName}</span>
              <span className="small dim">
                {dayZones.length === 0
                  ? 'No zones — nothing can be planned on this day.'
                  : `${dayZones.length} zone${dayZones.length === 1 ? '' : 's'}`}
              </span>
              {dayZones.length > 0 && (
                <span className="num small" style={{ marginLeft: 'auto' }}>{hm(total)}</span>
              )}
            </div>

            {dayZones.map((zone) => (
              <ZoneRow
                key={`${zone.id}:${zone.name}:${zone.start_time}:${zone.end_time}:${zone.modes.join(',')}`}
                zone={zone}
                dayName={dayName}
              />
            ))}

            <form action={addZoneAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="weekday" value={weekday} />
              <button type="submit" className="btn btn--sm">Add a zone to {dayName}</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

function ZoneRow({ zone, dayName }: { zone: EditableZone; dayName: string }) {
  const [name, setName] = useState(zone.name);
  const [start, setStart] = useState(zone.start_time);
  const [end, setEnd] = useState(zone.end_time);
  const [modes, setModes] = useState<WorkMode[]>(zone.modes);

  const toggleMode = (mode: WorkMode) =>
    setModes((current) =>
      current.includes(mode) ? current.filter((m) => m !== mode) : MODES.filter((m) => m === mode || current.includes(m)),
    );

  const changed =
    name !== zone.name ||
    start !== zone.start_time ||
    end !== zone.end_time ||
    modes.join(',') !== zone.modes.join(',');

  const crossesMidnight = toMinutes(end) <= toMinutes(start);
  const length = zoneMinutes(start, end);

  return (
    <form action={saveZoneAction} className="stack" style={{ gap: 8, padding: '10px 0 2px' }}>
      <input type="hidden" name="zone_id" value={zone.id} />
      {modes.map((mode) => <input key={mode} type="hidden" name="modes" value={mode} />)}

      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 160px' }}>
          <span className="label">Name</span>
          <input
            className="input" name="name" value={name} required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field" style={{ flex: '1 1 118px' }}>
          <span className="label">Starts</span>
          <input
            className="input num" type="time" name="start_time" value={start} required
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="field" style={{ flex: '1 1 118px' }}>
          <span className="label">Ends</span>
          <input
            className="input num" type="time" name="end_time" value={end} required
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <span className="num small" style={{ paddingBottom: 12 }}>{hm(length)}</span>
      </div>

      <div className="chips">
        {MODES.map((mode) => (
          <button
            key={mode} type="button" className="choice"
            aria-pressed={modes.includes(mode)}
            onClick={() => toggleMode(mode)}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {modes.length === 0 && (
        <p className="tiny risk-text">
          This zone admits nothing at the moment, so nothing can ever be planned in it. Turn on at
          least one kind of work before saving.
        </p>
      )}

      {crossesMidnight && (
        <p className="tiny dim">
          This zone crosses midnight: it opens at <span className="num">{start}</span> on {dayName} and
          closes at <span className="num">{end}</span> the next morning. That is deliberate, not an
          error — the whole window still belongs to {dayName}&rsquo;s plan.
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button
          type="submit" className="btn btn--sm btn--primary"
          disabled={!changed || modes.length === 0}
        >
          {changed ? 'Save this zone' : 'Saved'}
        </button>
        <button
          type="submit" formAction={removeZoneAction} formNoValidate
          className="btn btn--sm btn--quiet" style={{ color: 'var(--red)' }}
        >
          Remove
        </button>
      </div>
    </form>
  );
}
