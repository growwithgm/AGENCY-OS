/**
 * Settings — where the working day is defined.
 *
 * The planner obeys everything on this screen and the assistant may not
 * change any of it. If the shape of the day is wrong, this is the only
 * place it gets fixed.
 */

import { requireOperator } from '@/lib/auth';
import { listZones, WEEKDAY_NAMES } from '@/data/zones';
import { listClients } from '@/data/clients';
import { nextDue, type RecurrenceRule } from '@/data/recurrence';
import { hm, dateKey, shortDate, todayKey } from '@/lib/format';
import { PRIORITY_LABELS } from '@/data/types';
import { ModeChip } from '@/components/marks';
import { MODES, MODE_MIN_MINUTES } from '@/engines/planner/types';
import { TIMEZONE } from '@/push/windows';
import { pushConfigured } from '@/lib/env';
import { cronHealth, STALE_AFTER_HOURS } from '@/data/cronHealth';
import { PushDevices } from './PushDevices';
import { ZoneEditor } from './ZoneEditor';
import { DangerZone } from './DangerZone';
import { NotifySettings, type NotifyKind } from './NotifySettings';
import {
  addBlackoutAction, deleteRecurrenceAction, removeBlackoutAction,
  saveWorkingHoursAction, toggleRecurrenceAction,
} from './actions';

export const dynamic = 'force-dynamic';

/** The kinds the product sends today; a kind stored in the database wins over this list. */
const KNOWN_KINDS = ['master', 'attention', 'client_request', 'test'];

const DELIVERY_WINDOWS = ['09:00', '13:00', '18:00'];

function cadence(rule: RecurrenceRule): string {
  if (rule.frequency === 'weekly') {
    return `Every week on ${WEEKDAY_NAMES[rule.weekday ?? 1]}`;
  }
  if (rule.frequency === 'monthly') {
    return `On day ${rule.month_day ?? 1} of every month`;
  }
  const n = Math.max(1, rule.interval_n);
  return n === 1 ? 'Every day' : `Every ${n} days`;
}

function clockRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(startsAt)}–${fmt(endsAt)}`;
}

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { supabase } = await requireOperator();
  const now = new Date();
  const { problem } = await searchParams;

  const [zones, hoursRes, blackoutsRes, rulesRes, clients, notifyRes, heartbeat] = await Promise.all([
    listZones(supabase),
    supabase.from('capacity_rules').select('weekday, start_time, end_time, max_minutes').order('weekday'),
    supabase.from('blackouts').select('id, starts_at, ends_at, reason').order('starts_at'),
    supabase.from('recurrence_rules').select('*').order('title'),
    listClients(supabase),
    supabase.from('notification_settings').select('kind, enabled'),
    cronHealth(supabase, now),
  ]);

  const hoursFor = (weekday: number) => (hoursRes.data ?? []).find((r) => r.weekday === weekday);
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'Unknown client';

  const blackouts = (blackoutsRes.data ?? []).filter((b) => new Date(b.ends_at) >= now);
  const rules = (rulesRes.data ?? []) as RecurrenceRule[];

  const notifyRows = notifyRes.data ?? [];
  const peakBlackout = notifyRows.find((r) => r.kind === 'peak_blackout')?.enabled !== false;
  const kindNames = [
    ...KNOWN_KINDS,
    ...notifyRows.map((r) => r.kind).filter((k) => k !== 'peak_blackout' && !KNOWN_KINDS.includes(k)),
  ];
  const notifyKinds: NotifyKind[] = kindNames.map((kind) => ({
    kind,
    enabled: notifyRows.find((r) => r.kind === kind)?.enabled !== false,
  }));

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">The shape of your working day</div>
          <h1 className="page-title">Settings</h1>
        </div>
      </div>

      <p className="small muted" style={{ maxWidth: '68ch' }}>
        Everything on this screen is an instruction to the scheduler, and it follows all of it
        without argument. The assistant can read these rules and will refuse work that breaks
        them, but it cannot change them — this screen is the only way they change.
      </p>

      {problem && (
        <p role="alert" className="small" style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)',
          background: 'color-mix(in srgb, var(--red) 7%, transparent)',
          color: 'var(--red)', maxWidth: '68ch',
        }}>
          {String(problem).slice(0, 200)} Nothing was changed.
        </p>
      )}

      {/* Five instruction panels, paired on a wide screen. */}
      <div className="grid-2" style={{ marginTop: 18 }}>

      {/* ───────────────────────── zones ───────────────────────── */}

      <section className="card card--accent">
        <div className="section-label" style={{ marginTop: 0 }}><span>Your day — zones</span></div>

        <p className="small muted" style={{ maxWidth: '68ch' }}>
          A zone is a named window with an opinion about what belongs in it. Zones decide what kind
          of work can land where: give the evening to creative and technical work and operational
          work will never be dropped into it, however empty it looks and however overdue something
          else is.
        </p>

        <ZoneEditor weekdayNames={WEEKDAY_NAMES} zones={zones} />

        <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 14, paddingTop: 12 }}>
          <div className="label" style={{ marginBottom: 8 }}>What the scheduler enforces</div>
          <div className="rows">
            {MODES.map((mode) => (
              <div key={mode} className="rows__row">
                <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <ModeChip mode={mode} />
                  <span className="small muted">smallest unbroken block it will accept</span>
                </span>
                <span className="num">{hm(MODE_MIN_MINUTES[mode])}</span>
              </div>
            ))}
          </div>
          <p className="tiny dim" style={{ marginTop: 10, maxWidth: '68ch' }}>
            Anything shorter than that is not scheduled at all: a twenty-minute sliver of creative
            work is a lie about what creative work is. And work is never placed in a zone that does
            not admit its mode — if no zone admits it before the date it is needed, the work is
            flagged as at risk instead of being squeezed in somewhere it does not belong.
          </p>
        </div>
      </section>

      {/* ─────────────────── hours and the daily cap ─────────────────── */}

      <section className="card">
        <div className="section-label" style={{ marginTop: 0 }}><span>Working hours and the daily cap</span></div>

        <p className="small muted" style={{ maxWidth: '68ch' }}>
          The window says when you could be working; the cap says how much you can actually deliver
          inside it once admin, email and switching have taken their share — and the planner never
          plans beyond the cap.
        </p>

        <form action={saveWorkingHoursAction} className="stack" style={{ marginTop: 12 }}>
          <div className="rows">
            {WEEKDAY_NAMES.map((dayName, weekday) => {
              const rule = hoursFor(weekday);
              return (
                <div key={weekday} className="rows__row" style={{ display: 'block' }}>
                  <div className="spread">
                    <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                      <input type="checkbox" name={`works_${weekday}`} defaultChecked={Boolean(rule)} />
                      {dayName}
                    </label>
                    <span className="small">
                      {rule
                        ? <>Cap <span className="num">{hm(rule.max_minutes)}</span></>
                        : <span className="dim">Not a working day</span>}
                    </span>
                  </div>

                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <label className="field" style={{ flex: '1 1 118px' }}>
                      <span className="label">From</span>
                      <input
                        type="time" name={`start_${weekday}`} className="input num"
                        defaultValue={rule?.start_time?.slice(0, 5) ?? '09:00'}
                      />
                    </label>
                    <label className="field" style={{ flex: '1 1 118px' }}>
                      <span className="label">To</span>
                      <input
                        type="time" name={`end_${weekday}`} className="input num"
                        defaultValue={rule?.end_time?.slice(0, 5) ?? '17:00'}
                      />
                    </label>
                    <label className="field" style={{ flex: '1 1 150px' }}>
                      <span className="label">Deliverable minutes</span>
                      <input
                        type="number" name={`cap_${weekday}`} min={15} step={15} className="input num"
                        defaultValue={rule?.max_minutes ?? 390}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <button type="submit" className="btn btn--primary">Save hours and replan</button>
          <p className="tiny dim" style={{ maxWidth: '68ch' }}>
            Unticking a day removes it from the plan entirely. Saving re-plans immediately, so you
            see what the change did rather than being told about it later.
          </p>
        </form>
      </section>

      {/* ───────────────────────── blackouts ───────────────────────── */}

      <section className="card">
        <div className="section-label" style={{ marginTop: 0 }}><span>Exceptions</span></div>

        <p className="small muted" style={{ maxWidth: '68ch' }}>
          A blackout is time that exists in your hours but is not yours — travel, a dentist, a day
          off. It comes off the top of capacity before anything is planned, so the plan shrinks to
          match rather than quietly assuming you will catch up.
        </p>

        <div className="rows" style={{ marginTop: 10 }}>
          {blackouts.length === 0 && (
            <div className="rows__row">
              <span className="small dim">Nothing blacked out ahead. Every working hour is on the table.</span>
            </div>
          )}
          {blackouts.map((blackout) => {
            const minutes = Math.round((Date.parse(blackout.ends_at) - Date.parse(blackout.starts_at)) / 60000);
            return (
              <div key={blackout.id} className="rows__row">
                <span style={{ flex: '1 1 240px' }}>
                  <span className="num small">{shortDate(dateKey(new Date(blackout.starts_at)))}</span>
                  <span className="num small dim" style={{ marginLeft: 8 }}>{clockRange(blackout.starts_at, blackout.ends_at)}</span>
                  <span className="tiny dim" style={{ display: 'block', marginTop: 2 }}>
                    {blackout.reason || 'No reason given'} · <span className="num">{hm(minutes)}</span> off capacity
                  </span>
                </span>
                <form action={removeBlackoutAction}>
                  <input type="hidden" name="id" value={blackout.id} />
                  <button type="submit" className="btn btn--sm btn--quiet">Remove</button>
                </form>
              </div>
            );
          })}
        </div>

        <form action={addBlackoutAction} className="stack" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span className="label">Date</span>
              <input type="date" name="date" required className="input num" defaultValue={todayKey(now)} />
            </label>
            <label className="field" style={{ flex: '1 1 118px' }}>
              <span className="label">From</span>
              <input type="time" name="start_time" required className="input num" defaultValue="09:00" />
            </label>
            <label className="field" style={{ flex: '1 1 118px' }}>
              <span className="label">To</span>
              <input type="time" name="end_time" required className="input num" defaultValue="17:00" />
            </label>
            <label className="field" style={{ flex: '2 1 180px' }}>
              <span className="label">Reason</span>
              <input name="reason" className="input" placeholder="Travel, holiday, a wedding…" />
            </label>
          </div>
          <button type="submit" className="btn">Add this exception</button>
          <p className="tiny dim">
            An end time at or before the start runs into the next morning, the same as a zone does.
          </p>
        </form>
      </section>

      {/* ───────────────────────── recurring work ───────────────────────── */}

      <section className="card">
        <div className="section-label" style={{ marginTop: 0 }}><span>Recurring work</span></div>

        <p className="small muted" style={{ maxWidth: '68ch' }}>
          A rule creates work on a cadence without asking you each time. Approving the rule once
          authorises every occurrence it generates, so what it creates arrives already approved —
          which is exactly why changing or pausing a rule is a decision worth making deliberately.
        </p>

        <div className="rows" style={{ marginTop: 10 }}>
          {rules.length === 0 && (
            <div className="rows__row"><span className="small dim">No recurring work yet.</span></div>
          )}

          {rules.map((rule) => {
            const due = rule.active ? nextDue(rule, now) : null;
            const dueLabel = !rule.active
              ? 'Paused — it creates nothing'
              : due
                ? (due <= now ? 'Due now' : shortDate(dateKey(due)))
                : 'Nothing due yet this cycle';

            return (
              <div key={rule.id} className="rows__row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 260px' }}>
                  <div className="small" style={{ fontWeight: 500 }}>{rule.title}</div>
                  <div className="tiny dim" style={{ marginTop: 2 }}>
                    Creates <span className="num">{hm(rule.est_minutes)}</span> of{' '}
                    {PRIORITY_LABELS[rule.priority]?.toLowerCase() ?? 'normal'} work for {clientName(rule.client_id)}
                    {rule.client_visible ? ', visible on their portal' : ', kept internal'}.
                  </div>
                  <div className="tiny dim" style={{ marginTop: 2 }}>
                    {cadence(rule)} · Next: <span className="num">{dueLabel}</span>
                  </div>
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <form action={toggleRecurrenceAction}>
                    <input type="hidden" name="id" value={rule.id} />
                    <input type="hidden" name="active" value={rule.active ? 'false' : 'true'} />
                    <button type="submit" className="btn btn--sm">{rule.active ? 'Pause' : 'Resume'}</button>
                  </form>
                  <form action={deleteRecurrenceAction}>
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" className="btn btn--sm btn--quiet" style={{ color: 'var(--red)' }}>Delete</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ───────────────────────── notifications ───────────────────────── */}

      <section className="card">
        <div className="section-label" style={{ marginTop: 0 }}><span>Notifications</span></div>

        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <span className="label">Delivery windows</span>
          {DELIVERY_WINDOWS.map((time) => <span key={time} className="chip num">{time}</span>)}
          <span className="tiny dim">{TIMEZONE}</span>
        </div>

        <p className="small muted" style={{ marginTop: 8, maxWidth: '68ch' }}>
          Anything that is not urgent waits for the next of those three times and arrives as a
          single message, so you are interrupted three times a day at most instead of every time
          something happens.
        </p>

        <div style={{ marginTop: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>What breaks through immediately</div>
          <div className="rows">
            <div className="rows__row">
              <span className="small">A deadline you committed to becomes impossible to meet.</span>
            </div>
            <div className="rows__row">
              <span className="small">A client asks for something and names a date inside 48 hours.</span>
            </div>
          </div>
          <p className="tiny dim" style={{ marginTop: 8, maxWidth: '68ch' }}>
            That list is a rule, not a preference: those two are the only things worth taking you
            out of your work for, so they are not switchable.
          </p>
        </div>

        <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 14, paddingTop: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>Scheduler heartbeat</div>
          <p className="small" style={{ color: heartbeat.stale ? 'var(--red)' : undefined }}>
            {heartbeat.lastPlanRun
              ? <>Last plan run <span className="num">{heartbeat.hoursSince}h</span> ago
                  {heartbeat.stale
                    ? <> — more than {STALE_AFTER_HOURS}h, so the nightly cron looks dead. Check your scheduler against the table in docs/SETUP.md §6.</>
                    : '. The nightly job (or a replan) is keeping the plan fresh.'}</>
              : <>No plan has ever been recorded. Set up the cron jobs in docs/SETUP.md §6, or make any change to plan now.</>}
          </p>
        </div>

        <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 14, paddingTop: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>Devices</div>
          <div className="rows">
            <PushDevices vapidPublicKey={pushConfigured() ? process.env.VAPID_PUBLIC_KEY ?? null : null} />
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 14, paddingTop: 4 }}>
          <NotifySettings peakBlackout={peakBlackout} kinds={notifyKinds} />
        </div>
      </section>
      <DangerZone />

      </div>
    </main>
  );
}
