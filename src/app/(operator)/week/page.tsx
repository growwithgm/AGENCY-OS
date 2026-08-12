/**
 * The week — seven capacity bars, not a calendar and not a Gantt.
 *
 * Work that cannot fit before its date is lifted out of the days entirely
 * into its own group, because it no longer belongs to any day.
 */

import { requireOperator } from '@/lib/auth';
import { plan, dayCapacities } from '@/engines/planner/plan';
import { loadPlanInputs } from '@/data/planning';
import { listClients } from '@/data/clients';
import { dayLabel, hm, todayKey } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DAYS = 7;

export default async function WeekPage() {
  const { supabase } = await requireOperator();
  const now = new Date();

  const [planInput, clients] = await Promise.all([
    loadPlanInputs(supabase, now),
    listClients(supabase),
  ]);

  const result = plan(planInput);
  const capacities = dayCapacities(now, DAYS, planInput.capacityRules, planInput.blackouts, result.blocks)
    .slice(0, DAYS);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'Unknown';
  const today = todayKey(now);

  // Work grouped by the day it was planned into.
  const byDay = new Map<string, { title: string; client: string; minutes: number }[]>();
  for (const block of result.blocks) {
    const key = `${block.starts_at.getFullYear()}-${String(block.starts_at.getMonth() + 1).padStart(2, '0')}-${String(block.starts_at.getDate()).padStart(2, '0')}`;
    const task = planInput.tasks.find((t) => t.id === block.task_id);
    if (!task) continue;

    const minutes = (block.ends_at.getTime() - block.starts_at.getTime()) / 60000;
    const list = byDay.get(key) ?? [];
    const existing = list.find((e) => e.title === task.title);
    if (existing) existing.minutes += minutes;
    else list.push({ title: task.title, client: clientName(task.client_id), minutes });
    byDay.set(key, list);
  }

  const totalAvailable = capacities.reduce((t, d) => t + d.availableMinutes, 0);
  const totalPlanned = capacities.reduce((t, d) => t + d.plannedMinutes, 0);
  const overall = totalPlanned - totalAvailable;

  // At-risk work is a separate object with its own actions.
  const atRisk = result.atRisk.filter((r) => r.reason !== 'dependency_cycle');

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">
            {capacities[0]?.date} — {capacities[capacities.length - 1]?.date}
          </div>
          <h1 className="page-title">This week</h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`num${overall > 0 ? ' risk-text' : ''}`} style={{ fontSize: 18 }}>
            {overall > 0 ? `+${hm(overall)}` : hm(Math.abs(overall))}
          </div>
          <div className="tiny dim">{overall > 0 ? 'over capacity' : 'spare'}</div>
        </div>
      </div>

      {capacities.map((day) => {
        const items = byDay.get(day.date) ?? [];
        const over = day.plannedMinutes > day.availableMinutes;
        const denominator = Math.max(day.plannedMinutes, day.availableMinutes, 1);
        const fitPct = Math.min(day.plannedMinutes, day.availableMinutes) / denominator * 100;
        const overPct = over ? (day.plannedMinutes - day.availableMinutes) / denominator * 100 : 0;
        const isToday = day.date === today;

        return (
          <section
            key={day.date}
            className={over ? 'card card--risk' : 'card'}
            style={{ marginBottom: 8, ...(items.length === 0 && !over ? { opacity: 0.65 } : {}) }}
          >
            <div className="spread">
              <span style={{ fontWeight: isToday ? 600 : 500 }}>
                {dayLabel(day.date)}{isToday ? ' · today' : ''}
              </span>
              <span className={`small num${over ? ' risk-text' : ' muted'}`}>
                {hm(day.plannedMinutes)} / {hm(day.availableMinutes)}
              </span>
            </div>

            <div className="bar" style={{ margin: '8px 0' }}>
              <div className="bar__fill" style={{ width: `${fitPct}%` }} />
              {over && <div className="bar__over" style={{ width: `${overPct}%` }} />}
            </div>

            {items.map((item, i) => (
              <div key={i} className="spread small" style={{ padding: '2px 0' }}>
                <span><strong>{item.client}</strong> · {item.title}</span>
                <span className="num dim">{hm(item.minutes)}</span>
              </div>
            ))}

            {day.availableMinutes === 0 && <p className="tiny dim">No working hours set.</p>}
            {over && (
              <p className="small risk-text" style={{ marginTop: 6 }}>
                {hm(day.plannedMinutes - day.availableMinutes)} of this day has nowhere to go.
              </p>
            )}
          </section>
        );
      })}

      {atRisk.length > 0 && (
        <>
          <div className="section-label" style={{ color: 'var(--risk)' }}>
            <span>At risk</span>
            <span className="num">{atRisk.length}</span>
          </div>

          {atRisk.map((risk) => (
            <a key={risk.task.id} href={`/work/${risk.task.id}`} className="work work--risk" style={{ display: 'block' }}>
              <div className="spread">
                <span className="work__client">{clientName(risk.task.client_id)}</span>
                <span className="tiny num risk-text">
                  {risk.minutes_unplaced > 0 ? `${hm(risk.minutes_unplaced)} unplaced` : 'lands late'}
                </span>
              </div>
              <div className="work__title">{risk.task.title}</div>
              <div className="work__meta">
                {risk.relevant_date
                  ? `Cannot be finished before ${risk.relevant_date}`
                  : 'Does not fit inside the planning horizon'}
              </div>
            </a>
          ))}
        </>
      )}

      {result.cycles.length > 0 && (
        <div className="card card--risk" style={{ marginTop: 12 }}>
          <strong>Dependency cycle</strong>
          <p className="small" style={{ marginTop: 4 }}>
            These items depend on each other and cannot be ordered. Nothing was scheduled for
            them, and the loop was not broken automatically.
          </p>
        </div>
      )}
    </main>
  );
}
