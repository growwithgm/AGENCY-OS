/**
 * The weekly review — Friday's screen.
 *
 * Pure arithmetic. Every figure is counted from what happened, and the
 * page says where each came from. There is no AI summary at the top,
 * because a paragraph above the numbers becomes the thing people read.
 */

import { requireOperator } from '@/lib/auth';
import { weeklyReview, reasonLabel } from '@/data/review';
import { MODE_LABELS } from '@/data/types';
import { hm, pctSigned, shortDate } from '@/lib/format';
import { ClientName } from '@/components/marks';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const { supabase } = await requireOperator();
  const review = await weeklyReview(supabase);

  const totalMinutes = review.hoursByMode.reduce((total, m) => total + m.minutes, 0);
  const bias = review.estimates.estimatedMinutes > 0
    ? review.estimates.actualMinutes / review.estimates.estimatedMinutes - 1
    : 0;
  const peakShare = review.peak.availableMinutes > 0
    ? Math.round((review.peak.usedMinutes / review.peak.availableMinutes) * 100)
    : 0;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">
            <span className="num">{shortDate(review.from)}</span> to <span className="num">{shortDate(review.to)}</span>
          </div>
          <h1 className="page-title">The week</h1>
        </div>
      </div>

      {/* Commitments first: they are the only promises. */}
      <section className={`card${review.commitments.missed > 0 ? ' card--over' : ' card--accent'}`}>
        <div className="section-label" style={{ marginTop: 0 }}><span>Committed and delivered</span></div>
        <div className="row" style={{ gap: 24, alignItems: 'baseline' }}>
          <span>
            <span className="num" style={{ fontSize: 28, fontWeight: 600 }}>{review.commitments.met}</span>
            <span className="small dim" style={{ marginLeft: 6 }}>met</span>
          </span>
          <span>
            <span
              className="num"
              style={{ fontSize: 28, fontWeight: 600, color: review.commitments.missed ? 'var(--red)' : undefined }}
            >
              {review.commitments.missed}
            </span>
            <span className="small dim" style={{ marginLeft: 6 }}>missed</span>
          </span>
        </div>
        {review.commitments.missedItems.length > 0 && (
          <div className="rows" style={{ marginTop: 10 }}>
            {review.commitments.missedItems.map((item, i) => (
              <div key={`${item.title}-${i}`} className="rows__row">
                <span className="small">
                  {item.title}
                  <span className="tiny dim" style={{ display: 'block' }}>
                    <ClientName name={item.client} colorIndex={null} />
                  </span>
                </span>
                <span className="small num risk-text">{shortDate(item.date)}</span>
              </div>
            ))}
          </div>
        )}
        {review.commitments.missed === 0 && review.commitments.met === 0 && (
          <p className="tiny dim" style={{ marginTop: 8 }}>
            Nothing was promised for this week, so nothing could be missed.
          </p>
        )}
      </section>

      <div className="section-label"><span>Where the hours went</span><span className="num">{hm(totalMinutes)}</span></div>
      <div className="card">
        <div className="rows">
          {review.hoursByMode.filter((m) => m.minutes > 0).map((row) => (
            <div key={row.mode} className="rows__row">
              <span className="small">{MODE_LABELS[row.mode]}</span>
              <span className="small num">{hm(row.minutes)}</span>
            </div>
          ))}
          {totalMinutes === 0 && (
            <div className="rows__row"><span className="small dim">No time was booked this week.</span></div>
          )}
        </div>
      </div>

      <div className="section-label"><span>By client</span></div>
      <div className="card">
        <div className="rows">
          {review.hoursByClient.map((row) => (
            <div key={row.client} className="rows__row">
              <span className="small"><ClientName name={row.client} colorIndex={row.colorIndex} /></span>
              <span className="small num">{hm(row.minutes)}</span>
            </div>
          ))}
          {review.hoursByClient.length === 0 && (
            <div className="rows__row"><span className="small dim">Nothing was booked against a client.</span></div>
          )}
        </div>
      </div>

      <div className="section-label"><span>Context switching</span></div>
      <div className="card">
        <div className="rows">
          {review.modeSwitchesByDay.map((row) => (
            <div key={row.day} className="rows__row">
              <span className="small num">{shortDate(row.day)}</span>
              <span
                className="small num"
                style={{ color: row.switches > 3 ? 'var(--red-deep)' : undefined }}
              >
                {row.switches} switch{row.switches === 1 ? '' : 'es'}
              </span>
            </div>
          ))}
          {review.modeSwitchesByDay.length === 0 && (
            <div className="rows__row"><span className="small dim">No days had work booked.</span></div>
          )}
        </div>
        <p className="tiny dim" style={{ marginTop: 8 }}>
          Every switch costs the run-up into the next kind of work again. Four or more in a
          day usually means the plan was assembled by urgency rather than by shape.
        </p>
      </div>

      <div className="section-label"><span>Peak hours</span></div>
      <div className="card">
        <div className="rows">
          <div className="rows__row">
            <span className="small">Used for deep work</span>
            <span className="small num">{hm(review.peak.usedMinutes)}</span>
          </div>
          <div className="rows__row">
            <span className="small">Available</span>
            <span className="small num">{hm(review.peak.availableMinutes)}</span>
          </div>
          <div className="rows__row">
            <span className="small">Share used</span>
            <span
              className="small num"
              style={{ color: peakShare < 40 ? 'var(--amber-deep)' : undefined }}
            >
              {peakShare}%
            </span>
          </div>
        </div>
        <p className="tiny dim" style={{ marginTop: 8 }}>
          Peak is the only stretch of the day where creative and technical work can be
          scheduled. Hours left unused there are the hours you most wanted.
        </p>
      </div>

      <div className="section-label"><span>Estimates</span></div>
      <div className="card">
        {review.estimates.samples === 0 ? (
          <p className="small dim">
            Nothing was completed with a recorded duration this week, so there is nothing to
            compare. That is a gap in the evidence, not a good week.
          </p>
        ) : (
          <div className="rows">
            <div className="rows__row">
              <span className="small">Estimated</span>
              <span className="small num">{hm(review.estimates.estimatedMinutes)}</span>
            </div>
            <div className="rows__row">
              <span className="small">Actually took</span>
              <span className="small num">{hm(review.estimates.actualMinutes)}</span>
            </div>
            <div className="rows__row">
              <span className="small">Difference</span>
              <span className="small num" style={{ color: bias > 0.1 ? 'var(--amber-deep)' : undefined }}>
                {pctSigned(bias)}
              </span>
            </div>
          </div>
        )}

        <div className="section-label" style={{ marginTop: 14 }}><span>Overrun factor by mode</span></div>
        <div className="rows">
          {review.overrunFactorByMode.map((row) => (
            <div key={row.mode} className="rows__row">
              <span className="small">
                {MODE_LABELS[row.mode]}
                <span className="tiny dim" style={{ marginLeft: 6 }}>
                  {row.samples < 5 ? 'floor, not enough evidence yet' : `${row.samples} samples`}
                </span>
              </span>
              <span className="small num">×{row.factor.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="tiny dim" style={{ marginTop: 8 }}>
          This multiplier is what turns an estimate into the safe number a commitment is
          tested against.
        </p>
      </div>

      {review.overrunReasons.length > 0 && (
        <>
          <div className="section-label"><span>Why work ran over</span></div>
          <div className="card">
            <div className="rows">
              {review.overrunReasons.map((row) => (
                <div key={row.reason} className="rows__row">
                  <span className="small">{reasonLabel(row.reason)}</span>
                  <span className="small num">{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="section-label"><span>What each client has seen</span></div>
      <div className="card">
        <div className="rows">
          {review.visibility.map((row) => {
            const starved = row.days === null || row.days >= row.targetDays;
            return (
              <div key={row.client} className="rows__row">
                <span className="small"><ClientName name={row.client} colorIndex={row.colorIndex} /></span>
                <span className="small num" style={{ color: starved ? 'var(--amber-deep)' : undefined }}>
                  {row.days === null
                    ? 'nothing yet'
                    : row.days === 0
                      ? 'today'
                      : `${row.days} day${row.days === 1 ? '' : 's'} ago`}
                </span>
              </div>
            );
          })}
        </div>
        <p className="tiny dim" style={{ marginTop: 8 }}>
          How long since each client last saw something of theirs finish. Past their target,
          their visible work moves up the order — never above a promise or a priority you set.
        </p>
      </div>

      {review.slipped.length > 0 && (
        <>
          <div className="section-label"><span>What keeps moving</span></div>
          <div className="card">
            <div className="rows">
              {review.slipped.map((row) => (
                <div key={row.title} className="rows__row">
                  <span className="small">
                    {row.title}
                    <span className="tiny dim" style={{ display: 'block' }}>
                      <ClientName name={row.client} colorIndex={null} />
                    </span>
                  </span>
                  <span
                    className="small num"
                    style={{ color: row.moves >= 4 ? 'var(--red)' : 'var(--amber-deep)' }}
                  >
                    moved {row.moves}×
                  </span>
                </div>
              ))}
            </div>
            <p className="tiny dim" style={{ marginTop: 8 }}>
              Work that has moved four times or more is usually not scheduled wrong. It is
              either bigger than the estimate says, or it is not actually going to happen.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
