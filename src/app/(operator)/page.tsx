/**
 * Today — the home screen, and the argument of the product.
 *
 * Capacity first, in one honest measure. Then the shape of the day, then
 * what is running, then what needs attention, then the plan in order.
 * When the day is over capacity the list splits into what will fit and
 * what will not, because that is a decision to make rather than a warning
 * to read.
 */

import { requireOperator } from '@/lib/auth';
import { plan } from '@/engines/planner/plan';
import { loadPlanInputs, todayView } from '@/data/planning';
import { listClients } from '@/data/clients';
import { openSignals } from '@/data/attention';
import { unexplainedOverruns } from '@/data/work';
import { dayShape } from '@/data/zones';
import { hm, longDate, shortDate } from '@/lib/format';
import { Capacity } from './Capacity';
import { DayShape } from './DayShape';
import { RunningNow } from './RunningNow';
import { Flags } from './Flags';
import { OverrunAsk } from './OverrunAsk';
import { WorkRow, type WorkRowData } from './WorkRow';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const { supabase } = await requireOperator();
  const now = new Date();

  const [view, signals, planInput, shape, overruns, clients] = await Promise.all([
    todayView(supabase, now),
    openSignals(supabase),
    loadPlanInputs(supabase, now),
    dayShape(supabase, now),
    unexplainedOverruns(supabase),
    listClients(supabase),
  ]);

  // Every client, not only those with work planned today — an overflow item
  // belongs to a client whether or not the plan found room for it, and
  // rendering it as "Internal" (the no-client label) is a lie about whose
  // work it is.
  const clientLookup = new Map(clients.map((c) => [c.id, { name: c.name, colorIndex: c.color_index }]));

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
      colorIndex: item.clientColorIndex,
      status: item.task.status,
      priority: item.task.priority,
      mode: item.task.mode ?? 'operational',
      minutes: item.minutes,
      estMinutes: item.task.est_minutes,
      actualMinutes: item.task.actual_minutes,
      committedDate: item.task.committed_date,
      internalTarget: item.task.internal_target,
      slidCount: item.task.slid_count,
      atRisk: Boolean(risk),
      riskNote: risk ? riskSentence(risk) : null,
    };
  });

  // Work the plan could not place anywhere: the honest "will not fit" group.
  const unplaced = planResult.atRisk
    .filter((r) => r.minutes_unplaced > 0)
    .filter((r) => !view.items.some((i) => i.task.id === r.task.id));

  const overflowMinutes = unplaced.reduce((total, r) => total + r.minutes_unplaced, 0);
  const over = overflowMinutes > 0;

  const running = view.items.find((i) => i.task.status === 'in_progress');

  return (
    <main className="screen">
      <Capacity
        dateLabel={longDate(view.date)}
        plannedMinutes={view.plannedMinutes}
        availableMinutes={view.availableMinutes}
        overflowMinutes={overflowMinutes}
        itemCount={items.length}
        tomorrow={{
          label: shortDate(view.tomorrow.date),
          availableMinutes: view.tomorrow.availableMinutes,
          plannedMinutes: view.tomorrow.plannedMinutes,
          overflowMinutes: 0,
        }}
      >
        {over && (
          <>
            <a href="/work" className="btn btn--sm">Move something</a>
            <a href="/assistant" className="btn btn--sm">Ask what to cut</a>
          </>
        )}
      </Capacity>

      {running && (
        <div style={{ marginTop: 16 }}>
          <RunningNow
            item={{
              id: running.task.id,
              title: running.task.title,
              clientName: running.clientName,
              colorIndex: running.clientColorIndex,
              estMinutes: running.task.est_minutes,
              actualMinutes: running.task.actual_minutes,
            }}
          />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DayShape zones={shape.zones} modeSwitches={shape.modeSwitches} />
      </div>

      {overruns.map((item) => (
        <div key={item.id} style={{ marginTop: 12 }}>
          <OverrunAsk taskId={item.id} overrunMinutes={item.overrunMinutes} />
        </div>
      ))}

      <Flags signals={signals} />

      <div className="section-label">
        <span>{over ? 'Will fit today' : 'In planned order'}</span>
        <span className="num muted">{hm(view.plannedMinutes)}</span>
      </div>

      {items.length === 0 && (
        <div className="card">
          <p className="muted">Nothing is planned for today.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Either today has no zones set, or there is no open work to place. Both are
            fixable: zones live in Settings, work starts at Capture.
          </p>
        </div>
      )}

      {items.map((item) => <WorkRow key={item.id} item={item} />)}

      {unplaced.length > 0 && (
        <>
          <div className="section-label" style={{ color: 'var(--red)' }}>
            <span>Will not fit</span>
            <span className="num">{hm(overflowMinutes)}</span>
          </div>

          {unplaced.map((risk) => (
            <WorkRow
              key={risk.task.id}
              item={{
                id: risk.task.id,
                title: risk.task.title,
                clientName: clientLookup.get(risk.task.client_id)?.name ?? null,
                colorIndex: clientLookup.get(risk.task.client_id)?.colorIndex ?? null,
                status: risk.task.status,
                priority: risk.task.priority,
                mode: risk.task.mode ?? 'operational',
                minutes: risk.minutes_unplaced,
                estMinutes: risk.task.est_minutes,
                actualMinutes: risk.task.actual_minutes,
                committedDate: risk.task.committed_date,
                internalTarget: risk.task.internal_target,
                slidCount: risk.task.slid_count,
                atRisk: true,
                riskNote: riskSentence(risk),
              }}
            />
          ))}
        </>
      )}
    </main>
  );
}

/** Say which wall the work hit, in words rather than a code. */
function riskSentence(risk: { reason: string; minutes_unplaced: number; relevant_date: string | null }): string {
  const amount = hm(risk.minutes_unplaced);
  switch (risk.reason) {
    case 'no_zone_accepts_mode':
      return 'No zone in the next two weeks admits this kind of work. Change its mode, or add a zone that does.';
    case 'no_block_large_enough':
      return `This needs one unbroken run and no zone has that much left. ${amount} is unplaced.`;
    case 'commitment_needs_buffer':
      return `This fits only if nothing goes wrong. The safe estimate does not fit before ${risk.relevant_date}.`;
    case 'dependency_at_risk':
      return 'Something this depends on has nowhere to go, so this cannot be placed either.';
    case 'dependency_cycle':
      return 'This is in a dependency loop. Break the loop and it can be planned.';
    case 'no_capacity_before_date':
      return risk.minutes_unplaced > 0
        ? `${amount} of this has nowhere to go before ${risk.relevant_date}.`
        : `This lands after ${risk.relevant_date}.`;
    default:
      return `${amount} does not fit inside the next two weeks.`;
  }
}
