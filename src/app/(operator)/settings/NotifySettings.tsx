'use client';

import { useOptimistic, useTransition } from 'react';
import { setNotificationAction } from './actions';

export type NotifyKind = { kind: string; enabled: boolean };

/**
 * What each switch actually stops. Kinds come from the database, so an
 * unknown one still renders — with its raw name rather than a guess.
 */
const COPY: Record<string, { label: string; note: string }> = {
  master: {
    label: 'Send notifications at all',
    note: 'Turn this off and nothing leaves the queue — not the windows, not the two things that break through. The work still gets planned; you just have to come and look.',
  },
  attention: {
    label: 'Attention signals',
    note: 'The plan noticed something that needs you: a promise that no longer fits, work that has slipped too often, a client you have not shown anything to in a while.',
  },
  client_request: {
    label: 'Client requests',
    note: 'A client sent something through their portal and it is sitting in your inbox waiting for a decision.',
  },
  test: {
    label: 'Test messages',
    note: 'The one you send yourself when you want to know whether a new device is really receiving anything.',
  },
};

export function NotifySettings({ peakBlackout, kinds }: { peakBlackout: boolean; kinds: NotifyKind[] }) {
  const initial: Record<string, boolean> = { peak_blackout: peakBlackout };
  for (const k of kinds) initial[k.kind] = k.enabled;

  const [state, setState] = useOptimistic(
    initial,
    (current, patch: NotifyKind) => ({ ...current, [patch.kind]: patch.enabled }),
  );
  const [, startTransition] = useTransition();

  const toggle = (kind: string, next: boolean) => {
    startTransition(async () => {
      setState({ kind, enabled: next });
      await setNotificationAction(kind, next);
    });
  };

  return (
    <div className="rows" style={{ marginTop: 4 }}>
      <Row
        label="Silence everything during peak"
        note="Nothing is delivered while a peak zone is running, urgent included. Anything that arrives waits until the zone ends and comes through then. Peak is the only stretch of the day deep work can happen in, so it is the one stretch nothing is allowed to interrupt."
        on={state.peak_blackout}
        onToggle={(next) => toggle('peak_blackout', next)}
      />

      {kinds.map(({ kind }) => {
        const copy = COPY[kind] ?? { label: kind, note: 'Delivery for this kind of message.' };
        return (
          <Row
            key={kind}
            label={copy.label}
            note={copy.note}
            on={state[kind] !== false}
            onToggle={(next) => toggle(kind, next)}
          />
        );
      })}
    </div>
  );
}

function Row({
  label, note, on, onToggle,
}: { label: string; note: string; on: boolean; onToggle: (next: boolean) => void }) {
  return (
    <div className="rows__row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div className="small" style={{ fontWeight: 500 }}>{label}</div>
        <p className="tiny dim" style={{ marginTop: 3, maxWidth: '60ch' }}>{note}</p>
      </div>
      <button
        type="button"
        className="choice"
        aria-pressed={on}
        onClick={() => onToggle(!on)}
      >
        {on ? 'On' : 'Off'}
      </button>
    </div>
  );
}
