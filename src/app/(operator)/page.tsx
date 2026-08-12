/**
 * Today — the home screen, and the argument of the product.
 *
 * Capacity first, in one honest measure. Then the plan in order. When the
 * day is over capacity the list splits into what will fit and what will
 * not, because that is a decision to make rather than a warning to read.
 */

import { requireOperator } from '@/lib/auth';
import { plan } from '@/engines/planner/plan';
import { loadPlanInputs, todayView } from '@/data/planning';
import { openSignals } from '@/data/attention';
import { hm, longDate, todayKey } from '@/lib/format';
import { Capacity } from './Capacity';
import { Flags } from './Flags';
import { WorkRow, type WorkRowData } from './WorkRow';
import { replanAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { supabase } = await requireOperator();
  const now = new Date();

  const [view, signals, planInput] = await Promise.all([
    todayView(supabase, now),
    openSignals(supabase),
    loadPlanInputs(supabase, now),
  ]);

  // At-risk is recomputed from the same engine the plan came from, so the
  // two can never disagree on screen.
  const planResult = plan(planInput);
  const riskByTask = new Map(planResult.atRisk.map((r) => [r.task.id, r]));

  const items: WorkRowData[] = view.items.map((item) => {
    const risk = riskByTask.get(item.task.id);
    return {
      id: item.task.id,
      title: item.task.title,
      clientName: item.clientName,
      status: item.task.status,
      priority: item.task.priority,
      minutes: item.minutes,
      estMinutes: item.task.est_minutes,
      actualMinutes: item.task.actual_minutes,
      committedDate: item.task.committed_date,
      internalTarget: item.task.internal_target,
      workType: null,
      slidCount: item.task.slid_count,
      atRisk: Boolean(risk),
      riskNote: risk
        ? risk.minutes_unplaced > 0
          ? `${hm(risk.minutes_unplaced)} of this has nowhere to go before ${risk.relevant_date ?? 'the end of the horizon'}.`
          : `This lands after ${risk.relevant_date}.`
        : null,
    };
  });

  // Work due today or already committed that the plan could not place at
  // all: the honest "will not fit" group.
  const unplaced = planResult.atRisk
    .filter((r) => r.minutes_unplaced > 0)
    .filter((r) => !view.items.some((i) => i.task.id === r.task.id));

  const over = view.plannedMinutes > view.availableMinutes;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">{longDate(view.date)}</div>
          <h1 className="page-title">Today</h1>
        </div>
        <a href="/capture" className="btn btn--sm" aria-label="Capture new work">+ Capture</a>
      </div>

      <Capacity
        plannedMinutes={view.plannedMinutes}
        availableMinutes={view.availableMinutes}
        itemCount={items.length}
        willNotFitCount={unplaced.length}
      >
        {over && (
          <>
            <a href="/week" className="btn btn--sm">Move work</a>
            <a href="/inbox" className="btn btn--sm">Cut scope</a>
            <a href="/assistant" className="btn btn--sm">Ask what to cut</a>
          </>
        )}
      </Capacity>

      <Flags signals={signals} />

      <div className="section-label">
        <span>{over ? 'Will fit today' : 'In planned order'}</span>
        <span className="num muted">{hm(view.plannedMinutes)}</span>
      </div>

      {items.length === 0 && (
        <div className="card">
          <p className="muted">Nothing is planned for today.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Either the day has no working hours set, or there is no open work to place.
          </p>
        </div>
      )}

      {items.map((item) => <WorkRow key={item.id} item={item} />)}

      {unplaced.length > 0 && (
        <>
          <div className="section-label" style={{ color: 'var(--risk)' }}>
            <span>Will not fit</span>
            <span className="num">{hm(unplaced.reduce((t, r) => t + r.minutes_unplaced, 0))}</span>
          </div>

          {unplaced.map((risk) => (
            <WorkRow
              key={risk.task.id}
              item={{
                id: risk.task.id,
                title: risk.task.title,
                clientName: null,
                status: risk.task.status,
                priority: risk.task.priority,
                minutes: risk.minutes_unplaced,
                estMinutes: risk.task.est_minutes,
                actualMinutes: risk.task.actual_minutes,
                committedDate: risk.task.committed_date,
                internalTarget: risk.task.internal_target,
                workType: null,
                slidCount: risk.task.slid_count,
                atRisk: true,
                riskNote: risk.relevant_date
                  ? `${hm(risk.minutes_unplaced)} cannot be placed before ${risk.relevant_date}.`
                  : `${hm(risk.minutes_unplaced)} does not fit inside the planning horizon.`,
              }}
            />
          ))}
        </>
      )}

      <form action={replanAction} style={{ marginTop: 24 }}>
        <button type="submit" className="btn btn--sm btn--quiet">Recalculate plan</button>
      </form>

      <a href="/capture" className="fab" aria-label="Capture new work">+</a>
    </main>
  );
}
