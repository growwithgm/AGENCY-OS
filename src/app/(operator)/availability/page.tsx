/**
 * Availability — working hours, the daily cap, exceptions and recurrence.
 * This is the planner's only input about how much time exists.
 */

import { requireOperator } from '@/lib/auth';
import { listClients } from '@/data/clients';
import { hm, shortDate } from '@/lib/format';
import { PRIORITY_LABELS } from '@/data/types';
import {
  addExceptionAction, removeExceptionAction, saveHoursAction,
  saveRecurrenceAction, toggleRecurrenceAction,
} from './actions';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function AvailabilityPage() {
  const { supabase } = await requireOperator();

  const [rulesRes, blackoutsRes, recurrenceRes, clients] = await Promise.all([
    supabase.from('capacity_rules').select('weekday, start_time, end_time, max_minutes').order('weekday'),
    supabase.from('blackouts').select('id, starts_at, ends_at, reason').order('starts_at'),
    supabase.from('recurrence_rules')
      .select('id, title, interval_n, est_minutes, priority, active, client_id')
      .order('title'),
    listClients(supabase),
  ]);

  const ruleFor = (weekday: number) => (rulesRes.data ?? []).find((r) => r.weekday === weekday);
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'Unknown';
  const upcoming = (blackoutsRes.data ?? []).filter((b) => new Date(b.ends_at) >= new Date());

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">The capacity model</div>
          <h1 className="page-title">Availability</h1>
        </div>
      </div>

      <div className="section-label"><span>Working hours</span></div>
      <form action={saveHoursAction} className="stack">
        <div className="rows">
          {WEEKDAYS.map((name, weekday) => {
            const rule = ruleFor(weekday);
            return (
              <div key={weekday} className="rows__row" style={{ display: 'grid', gap: 8 }}>
                <label className="check">
                  <input type="checkbox" name={`enabled_${weekday}`} defaultChecked={Boolean(rule)} />
                  <span style={{ fontWeight: 500 }}>{name}</span>
                </label>

                <div className="row" style={{ gap: 8 }}>
                  <label className="field" style={{ flex: '1 1 100px' }}>
                    <span className="label">From</span>
                    <input
                      type="time" name={`start_${weekday}`} className="input"
                      defaultValue={rule?.start_time?.slice(0, 5) ?? '09:00'}
                    />
                  </label>
                  <label className="field" style={{ flex: '1 1 100px' }}>
                    <span className="label">To</span>
                    <input
                      type="time" name={`end_${weekday}`} className="input"
                      defaultValue={rule?.end_time?.slice(0, 5) ?? '17:00'}
                    />
                  </label>
                  <label className="field" style={{ flex: '1 1 120px' }}>
                    <span className="label">Daily cap (min)</span>
                    <input
                      type="number" name={`cap_${weekday}`} min={30} step={15} className="input"
                      defaultValue={rule?.max_minutes ?? 390}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <p className="tiny dim">
          The cap is what you can realistically deliver inside those hours. The planner
          never plans beyond it — setting it honestly is the whole point.
        </p>

        <button type="submit" className="btn btn--primary">Save and replan</button>
      </form>

      <div className="section-label"><span>Exceptions</span></div>
      <form action={addExceptionAction} className="stack">
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: '1 1 150px' }}>
            <span className="label">Date</span>
            <input type="date" name="date" required className="input" />
          </label>
          <label className="field" style={{ flex: '1 1 110px' }}>
            <span className="label">Hours available</span>
            <input type="number" name="hours" min={0} max={12} step={0.5} defaultValue={0} className="input" />
          </label>
          <label className="field" style={{ flex: '2 1 160px' }}>
            <span className="label">Reason</span>
            <input name="reason" placeholder="Travel, holiday…" className="input" />
          </label>
        </div>
        <button type="submit" className="btn">Add exception</button>
        <p className="tiny dim">Zero hours means the whole day is unavailable.</p>
      </form>

      {upcoming.length > 0 && (
        <div className="rows" style={{ marginTop: 10 }}>
          {upcoming.map((exception) => (
            <div key={exception.id} className="rows__row">
              <span className="small">
                {shortDate(exception.starts_at.slice(0, 10))}
                {exception.reason ? ` · ${exception.reason}` : ''}
              </span>
              <form action={removeExceptionAction}>
                <input type="hidden" name="id" value={exception.id} />
                <button type="submit" className="btn btn--sm btn--quiet">Remove</button>
              </form>
            </div>
          ))}
        </div>
      )}

      <div className="section-label"><span>Recurrence rules</span></div>
      <p className="tiny dim" style={{ marginBottom: 8 }}>
        Approving a rule once authorises everything it generates. Changing the rule is a
        new decision.
      </p>

      <div className="rows">
        {(recurrenceRes.data ?? []).length === 0 && (
          <div className="rows__row"><span className="small dim">No recurring work.</span></div>
        )}
        {(recurrenceRes.data ?? []).map((rule) => (
          <div key={rule.id} className="rows__row">
            <span>
              <strong>{rule.title}</strong> · {clientName(rule.client_id)}
              <span className="tiny dim num" style={{ display: 'block' }}>
                Every {rule.interval_n} days · {hm(rule.est_minutes)} · {PRIORITY_LABELS[rule.priority]}
              </span>
            </span>
            <form action={toggleRecurrenceAction}>
              <input type="hidden" name="id" value={rule.id} />
              <input type="hidden" name="active" value={rule.active ? 'false' : 'true'} />
              <button type="submit" className="btn btn--sm">{rule.active ? 'Pause' : 'Resume'}</button>
            </form>
          </div>
        ))}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary className="btn btn--sm" style={{ display: 'inline-flex' }}>Add a rule</summary>
        <form action={saveRecurrenceAction} className="stack" style={{ marginTop: 10 }}>
          <label className="field">
            <span className="label">Client</span>
            <select name="client_id" required className="input">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Title</span>
            <input name="title" required placeholder="Search terms review" className="input" />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flex: '1 1 110px' }}>
              <span className="label">Every N days</span>
              <input type="number" name="interval_days" min={1} defaultValue={7} className="input" />
            </label>
            <label className="field" style={{ flex: '1 1 110px' }}>
              <span className="label">Estimate (min)</span>
              <input type="number" name="est_minutes" min={5} defaultValue={40} className="input" />
            </label>
            <label className="field" style={{ flex: '1 1 130px' }}>
              <span className="label">Priority</span>
              <select name="priority" required defaultValue="3" className="input">
                {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" name="client_visible" defaultChecked />
            <span>Show generated work on the client portal</span>
          </label>
          <button type="submit" className="btn">Create rule</button>
        </form>
      </details>

      <div className="section-label"><span>Notifications</span></div>
      <NotificationSettings />

      <div className="section-label"><span>Session</span></div>
      <SessionCard />
    </main>
  );
}

async function SessionCard() {
  const { session } = await requireOperator();

  return (
    <div className="card">
      <p className="small muted">
        Signed in as <strong style={{ color: 'var(--text)' }}>{session.email}</strong> — the
        one address allowed to hold an operator session.
      </p>
      <form action="/signout" method="post" style={{ marginTop: 10 }}>
        <button type="submit" className="btn btn--sm">Sign out</button>
      </form>
    </div>
  );
}

async function NotificationSettings() {
  const { supabase } = await requireOperator();
  const { data } = await supabase.from('notification_settings').select('kind, enabled');
  const enabled = (kind: string) => data?.find((s) => s.kind === kind)?.enabled !== false;

  return (
    <div className="card">
      <p className="small muted">
        Attention signals are pushed to your devices when intervention is useful — never
        a daily digest of everything.
      </p>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <span className={`tag${enabled('master') ? ' tag--ok' : ''}`}>
          {enabled('master') ? 'Notifications on' : 'Notifications off'}
        </span>
      </div>
      <p className="tiny dim" style={{ marginTop: 8 }}>
        Enable them on the device you want them on — each browser subscribes separately.
      </p>
    </div>
  );
}
