import { hm, pctSigned } from '@/lib/format';
import type { Distribution } from '@/engines/estimates/referenceClass';

/**
 * What work like this has actually taken — shown before the estimate is
 * typed, because the first number a person reaches for is the one they
 * anchor on.
 *
 * Under five samples it says so and shows nothing else. A distribution
 * drawn from three jobs looks like evidence and is not.
 */
export function ReferenceClass({ distribution }: { distribution: Distribution }) {
  if (distribution.status === 'insufficient') {
    return (
      <p className="tiny dim" style={{ marginBottom: 8 }}>
        {distribution.sentence}
      </p>
    );
  }

  const { label, samples, fastest, median, slowest, estimateAverage, estimateBias } = distribution;
  const optimistic = estimateBias > 0.1;

  return (
    <div
      className="card"
      style={{ background: 'var(--paper-100)', border: 'none', marginBottom: 10, padding: '10px 12px' }}
    >
      <div className="small">
        Similar work: <strong>{label}</strong>{' '}
        <span className="num dim">({samples} samples)</span>
      </div>

      <div className="small num" style={{ marginTop: 6 }}>
        Fastest {hm(fastest)} · Median {hm(median)} · Slowest {hm(slowest)}
      </div>

      {optimistic && (
        <div className="tiny" style={{ marginTop: 6, color: 'var(--amber-deep)' }}>
          You estimated <span className="num">{hm(estimateAverage)}</span> on average — actual{' '}
          <span className="num">{pctSigned(estimateBias)}</span>.
        </div>
      )}
    </div>
  );
}

/**
 * The median as a one-tap answer. Choosing below it is allowed, but the
 * caller asks for a reason — an estimate that beats the record needs
 * something specific behind it.
 */
export function suggestedMinutes(distribution: Distribution): number | null {
  return distribution.status === 'ready' ? distribution.median : null;
}
