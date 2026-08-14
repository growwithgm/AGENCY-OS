import Link from 'next/link';
import { signalAction, signalHref, type OpenSignal } from '@/data/attention';

/**
 * The attention strip: deterministic signals, each with the action it
 * implies. Nothing appears here unless intervention is useful.
 */
export function Flags({ signals, limit = 4 }: { signals: OpenSignal[]; limit?: number }) {
  if (signals.length === 0) return null;

  const shown = signals.slice(0, limit);
  const severityClass = (s: OpenSignal) =>
    s.severity === 'risk' ? 'flag--risk' : s.severity === 'warn' ? 'flag--wait' : 'flag--info';

  return (
    <div className="flags" style={{ marginTop: 12 }}>
      {shown.map((signal) => (
        <Link key={signal.id} href={signalHref(signal)} className={`flag ${severityClass(signal)}`}>
          <span className="flag__dot" />
          <span style={{ flex: 1, color: 'var(--text)' }}>
            {signal.headline}
            <span className="tiny" style={{ display: 'block', color: 'var(--accent)', marginTop: 2 }}>
              {signalAction(signal)}
            </span>
          </span>
        </Link>
      ))}
      {signals.length > shown.length && (
        <Link href="/assistant" className="tiny dim" style={{ padding: '2px 4px' }}>
          {signals.length - shown.length} more
        </Link>
      )}
    </div>
  );
}
