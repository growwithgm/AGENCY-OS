// Settings: notifications (enrolment, per-type toggles, devices),
// capacity rules, and blackouts.

import { db } from '@/lib/db';
import { PushControls } from './PushControls';
import {
  addBlackoutAction, removeBlackoutAction, removeDeviceAction,
  saveCapacityAction, saveNotificationSettingsAction,
} from './actions';
import { button, buttonGreen, buttonSubtle, card, input, label, muted, Nav } from '../ui';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NOTIFICATION_KINDS = [
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
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Settings</h1>
      <Nav />

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Notifications</h2>
        <PushControls vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Kya kya bheji jayen</h2>
        <form action={saveNotificationSettingsAction}>
          <div style={{ borderBottom: '1px solid #2a2f3a', paddingBottom: 10, marginBottom: 10 }}>
            <label style={{ fontSize: 15 }}>
              <input type="checkbox" name="master" defaultChecked={enabled('master')} />
              {' '}<strong>Sab notifications</strong> — off karein to neeche wali sab band
            </label>
          </div>
          {NOTIFICATION_KINDS.map((n) => (
            <div key={n.kind} style={{ padding: '6px 0' }}>
              <label>
                <input type="checkbox" name={n.kind} defaultChecked={enabled(n.kind)} /> {n.title}
              </label>
              <div style={{ ...muted, fontSize: 12, paddingLeft: 22 }}>{n.when}</div>
            </div>
          ))}
          <button type="submit" style={{ ...buttonGreen, marginTop: 10 }}>Save</button>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Registered devices ({(devices ?? []).length})</h2>
        {(devices ?? []).length === 0 && <p style={muted}>Abhi koi device register nahi.</p>}
        {(devices ?? []).map((d) => (
          <div key={d.id} style={{
            borderTop: '1px solid #2a2f3a', padding: '8px 0',
            display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
          }}>
            <div style={{ fontSize: 13 }}>
              {d.user_agent ?? 'Unknown device'}
              <div style={muted}>
                {d.last_success_at ? `Aakhri baar ${new Date(d.last_success_at).toLocaleString('en-GB')}` : 'Abhi tak koi notification nahi gayi'}
                {!d.active && ' · deactivated'}
                {d.failure_count > 0 && ` · ${d.failure_count} fail`}
              </div>
            </div>
            <form action={removeDeviceAction}>
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" style={buttonSubtle}>Remove</button>
            </form>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Working hours</h2>
        <p style={{ ...muted, fontSize: 13, marginTop: 0 }}>
          Daily cap wo waqt hai jo aap waqai kaam mein de sakte hain — window se kam rakhna
          normal hai. Scheduler isi ko sach maanta hai.
        </p>
        <form action={saveCapacityAction}>
          {WEEKDAYS.map((name, weekday) => {
            const r = ruleFor(weekday);
            return (
              <div key={weekday} style={{
                display: 'grid', gridTemplateColumns: '130px 1fr 1fr 1fr',
                gap: 8, alignItems: 'center', padding: '4px 0',
              }}>
                <label style={{ fontSize: 14 }}>
                  <input type="checkbox" name={`enabled_${weekday}`} defaultChecked={!!r} /> {name}
                </label>
                <input name={`start_${weekday}`} type="time" defaultValue={r?.start_time?.slice(0, 5) ?? '09:00'} style={input} />
                <input name={`end_${weekday}`} type="time" defaultValue={r?.end_time?.slice(0, 5) ?? '17:00'} style={input} />
                <input name={`cap_${weekday}`} type="number" min={30} step={30}
                  defaultValue={r?.max_minutes ?? 360} style={input} title="Daily cap (minutes)" />
              </div>
            );
          })}
          <button type="submit" style={{ ...buttonGreen, marginTop: 10 }}>Save aur replan</button>
        </form>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Blackouts</h2>
        <form action={addBlackoutAction} style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end',
        }}>
          <div>
            <label style={label}>Start</label>
            <input name="starts_at" type="datetime-local" required style={input} />
          </div>
          <div>
            <label style={label}>End</label>
            <input name="ends_at" type="datetime-local" required style={input} />
          </div>
          <div>
            <label style={label}>Wajah</label>
            <input name="reason" placeholder="Chhutti / meeting" style={input} />
          </div>
          <button type="submit" style={button}>Add</button>
        </form>

        {(blackouts ?? []).map((b) => (
          <div key={b.id} style={{
            borderTop: '1px solid #2a2f3a', padding: '8px 0',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 13 }}>
              {new Date(b.starts_at).toLocaleString('en-GB')} → {new Date(b.ends_at).toLocaleString('en-GB')}
              {b.reason && <span style={muted}> · {b.reason}</span>}
            </span>
            <form action={removeBlackoutAction}>
              <input type="hidden" name="id" value={b.id} />
              <button type="submit" style={buttonSubtle}>Remove</button>
            </form>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Pichli notifications</h2>
        {(recent ?? []).length === 0 && <p style={muted}>Abhi tak koi nahi.</p>}
        <ul style={{ fontSize: 13 }}>
          {(recent ?? []).map((n, i) => (
            <li key={i}>
              {new Date(n.created_at).toLocaleString('en-GB')} · {n.kind} ·{' '}
              {n.skipped ? <span style={muted}>skip: {n.skipped}</span> : `${n.sent_count} device(s)`}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
