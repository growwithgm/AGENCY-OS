// Settings: notifications (enrolment, per-type toggles, devices),
// capacity rules, and blackouts.

import { db } from '@/lib/db';
import { PushControls } from './PushControls';
import {
  addBlackoutAction, removeBlackoutAction, removeDeviceAction,
  saveCapacityAction, saveNotificationSettingsAction,
} from './actions';
import { fmtDateTime, Nav } from '../ui';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NOTIFICATION_KINDS = [
  { kind: 'client_request', title: 'Client ki nayi request', when: 'Fauran — jab client kaam maange' },
  { kind: 'morning_briefing', title: 'Aaj ka plan', when: 'Roz 08:30 — halka din ho to nahi jati' },
  { kind: 'overload_alert', title: 'Overload alert', when: 'Roz 08:35 — sirf jab kaam zyada ho' },
  { kind: 'evening_check', title: 'Sham ka check', when: 'Roz 18:00 — sirf jab tasks reh jayen' },
  { kind: 'report_drafts', title: 'Report drafts', when: 'Fri 17:05 — approve ka intezar' },
  { kind: 'stale_tasks', title: 'Bar-bar shift hone wale tasks', when: 'Mon 09:00' },
];

export default async function SettingsPage() {
  const [{ data: settings }, { data: devices }, { data: rules }, { data: blackouts }, { data: recent }] =
    await Promise.all([
      db().from('notification_settings').select('kind, enabled'),
      db().from('push_subscriptions').select('id, user_agent, created_at, last_success_at, failure_count, active')
        .order('created_at', { ascending: false }),
      db().from('capacity_rules').select('weekday, start_time, end_time, max_minutes').order('weekday'),
      db().from('blackouts').select('id, starts_at, ends_at, reason').order('starts_at'),
      db().from('notification_log').select('kind, title, sent_count, skipped, created_at')
        .order('created_at', { ascending: false }).limit(8),
    ]);

  const enabled = (kind: string) => {
    const row = (settings ?? []).find((s) => s.kind === kind);
    return row ? row.enabled !== false : true;
  };
  const ruleFor = (weekday: number) => (rules ?? []).find((r) => r.weekday === weekday);

  return (
    <main className="container container--narrow">
      <h1>Settings</h1>
      <Nav />

      <section className="card">
        <h2>Notifications</h2>
        <PushControls vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      </section>

      <section className="card">
        <h2>Kya kya bheji jayen</h2>
        <form action={saveNotificationSettingsAction}>
          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
            <label className="check">
              <input type="checkbox" name="master" defaultChecked={enabled('master')} />
              <span><strong>Sab notifications</strong> — off karein to neeche wali sab band</span>
            </label>
          </div>
          {NOTIFICATION_KINDS.map((n) => (
            <div key={n.kind}>
              <label className="check">
                <input type="checkbox" name={n.kind} defaultChecked={enabled(n.kind)} />
                <span>{n.title}</span>
              </label>
              <div className="muted tiny" style={{ paddingLeft: 26, marginTop: -8, marginBottom: 4 }}>
                {n.when}
              </div>
            </div>
          ))}
          <button type="submit" className="btn btn--green" style={{ marginTop: 10 }}>Save</button>
        </form>
      </section>

      <section className="card">
        <h2>Registered devices ({(devices ?? []).length})</h2>
        {(devices ?? []).length === 0 && <p className="muted">Abhi koi device register nahi.</p>}
        {(devices ?? []).map((d) => (
          <div key={d.id} className="item">
            <div className="item__main small">
              {d.user_agent ?? 'Unknown device'}
              <div className="item__meta">
                {d.last_success_at ? `Aakhri baar ${fmtDateTime(d.last_success_at)}` : 'Abhi tak koi notification nahi gayi'}
                {!d.active && ' · deactivated'}
                {d.failure_count > 0 && ` · ${d.failure_count} fail`}
              </div>
            </div>
            <form action={removeDeviceAction}>
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" className="btn btn--subtle btn--sm">Remove</button>
            </form>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Working hours</h2>
        <p className="muted small">
          Daily cap wo waqt hai jo aap waqai kaam mein de sakte hain — window se kam rakhna
          normal hai. Scheduler isi ko sach maanta hai.
        </p>
        <form action={saveCapacityAction}>
          {WEEKDAYS.map((name, weekday) => {
            const r = ruleFor(weekday);
            return (
              <div key={weekday} className="cap-row">
                <label className="check cap-row__day">
                  <input type="checkbox" name={`enabled_${weekday}`} defaultChecked={!!r} />
                  <span>{name}</span>
                </label>
                <input name={`start_${weekday}`} type="time" className="input"
                  defaultValue={r?.start_time?.slice(0, 5) ?? '09:00'} aria-label={`${name} start`} />
                <input name={`end_${weekday}`} type="time" className="input"
                  defaultValue={r?.end_time?.slice(0, 5) ?? '17:00'} aria-label={`${name} end`} />
                <div className="cap-row__cap">
                  <span className="label cap-row__hint">Daily cap (minutes)</span>
                  <input name={`cap_${weekday}`} type="number" min={30} step={30} className="input"
                    defaultValue={r?.max_minutes ?? 360} aria-label={`${name} daily cap in minutes`}
                    title="Daily cap (minutes)" />
                </div>
              </div>
            );
          })}
          <button type="submit" className="btn btn--green" style={{ marginTop: 12 }}>Save aur replan</button>
        </form>
      </section>

      <section className="card">
        <h2>Blackouts</h2>
        <form action={addBlackoutAction} className="stack">
          <div className="grid grid--tight">
            <div>
              <label className="label">Start</label>
              <input name="starts_at" type="datetime-local" required className="input" />
            </div>
            <div>
              <label className="label">End</label>
              <input name="ends_at" type="datetime-local" required className="input" />
            </div>
            <div>
              <label className="label">Wajah</label>
              <input name="reason" placeholder="Chhutti / meeting" className="input" />
            </div>
          </div>
          <div><button type="submit" className="btn">Add</button></div>
        </form>

        {(blackouts ?? []).map((b) => (
          <div key={b.id} className="item">
            <div className="item__main small">
              {fmtDateTime(b.starts_at)} → {fmtDateTime(b.ends_at)}
              {b.reason && <div className="item__meta">{b.reason}</div>}
            </div>
            <form action={removeBlackoutAction}>
              <input type="hidden" name="id" value={b.id} />
              <button type="submit" className="btn btn--subtle btn--sm">Remove</button>
            </form>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Pichli notifications</h2>
        {(recent ?? []).length === 0 && <p className="muted">Abhi tak koi nahi.</p>}
        <ul className="list small">
          {(recent ?? []).map((n, i) => (
            <li key={i}>
              {fmtDateTime(n.created_at)} · {n.kind}
              <div className="item__meta">
                {n.skipped ? `skip: ${n.skipped}` : `${n.sent_count} device(s)`}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
