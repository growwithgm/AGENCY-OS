/**
 * Portal home — the client's own page, in the order they care about.
 *
 * Plain factual status. No internal dates, no estimates, no priorities, no
 * workload numbers, no hours anywhere (INV-8 in the database, and this
 * projection on top of it).
 *
 * Where a piece of work has no committed date, it shows NO date at all —
 * not "soon", not a range. Silence is correct; anything else is a promise
 * the operator did not make.
 */

import { requireClient } from '@/lib/auth';
import { t, type Locale } from '@/portal/copy';

export const dynamic = 'force-dynamic';

type VisibleWork = {
  id: string;
  title: string;
  client_status: 'done' | 'in_progress' | 'waiting' | 'upcoming';
  committed_date: string | null;
  completed_at: string | null;
  created_at: string;
};

/** How long a new item wears its marker. */
const NEW_FOR_HOURS = 48;

export default async function PortalHome() {
  const { supabase } = await requireClient();

  // Every read here goes through a portal projection. A client session has
  // no policy on tasks, client_requests or clients at all, so an internal
  // date cannot be reached even by calling the API directly (INV-8).
  const [workRes, updatesRes, requestsRes, clientRes] = await Promise.all([
    supabase.from('client_visible_work')
      .select('id, title, client_status, committed_date, completed_at, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('client_published_updates')
      .select('id, body_md, published_at, period_start, period_end')
      .order('published_at', { ascending: false })
      .limit(12),
    supabase.from('client_request_status')
      .select('id, state, title, note, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('client_profile').select('name, locale').maybeSingle(),
  ]);

  const locale = ((clientRes.data?.locale as Locale) ?? 'en');
  const say = t(locale);

  const work = (workRes.data ?? []) as VisibleWork[];
  const waiting = work.filter((w) => w.client_status === 'waiting');
  const inProgress = work.filter((w) => w.client_status === 'in_progress');
  const completed = work.filter((w) => w.client_status === 'done').slice(0, 8);
  const upcoming = work.filter((w) => w.client_status === 'upcoming').slice(0, 8);

  const requests = (requestsRes.data ?? []) as {
    id: string; state: string; title: string; note: string | null; created_at: string;
  }[];

  const latest = (updatesRes.data ?? [])[0] as
    | { id: string; body_md: string; published_at: string }
    | undefined;

  const isNew = (iso: string) => Date.now() - Date.parse(iso) < NEW_FOR_HOURS * 3600_000;

  const day = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', {
      day: 'numeric', month: 'long',
    });
  };

  const ago = (iso: string) => {
    const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
    if (days <= 0) return say.today;
    if (days === 1) return say.yesterday;
    if (days < 7) return say.daysAgo(days);
    return day(iso);
  };

  return (
    <main className="portal">
      <header style={{ marginBottom: 40 }}>
        <h1>{clientRes.data?.name ?? ''}</h1>
        <p style={{ marginTop: 10 }}>{say.subtitle}</p>
      </header>

      {waiting.length > 0 && (
        <div className="portal-callout">
          <div className="portal-callout__label">{say.overToYou}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {waiting.map((item) => (
              <div key={item.id}>
                <div className="portal-card__title">{item.title}</div>
                <div className="portal-card__meta" style={{ marginTop: 4 }}>
                  {say.askedFor} {ago(item.created_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <a href="/portal/request" className="btn--wide" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 40, textDecoration: 'none' }}>
        {say.askUs}
      </a>

      <Section
        label={say.inProgress}
        empty={say.nothingInProgress}
        rows={inProgress}
        isNew={isNew}
        day={day}
        say={say}
      />
      <Section
        label={say.upcoming}
        empty={say.nothingUpcoming}
        rows={upcoming}
        isNew={isNew}
        day={day}
        say={say}
      />
      <Section
        label={say.completed}
        empty={say.nothingCompleted}
        rows={completed}
        isNew={() => false}
        day={day}
        say={say}
        completedMeta
      />

      <section className="portal-section">
        <div className="portal-section__label">{say.whatYouAsked}</div>
        {requests.length === 0 && <div className="portal-empty">{say.noRequests}</div>}
        {requests.map((request) => (
          <div key={request.id} style={{ padding: '13px 0', borderBottom: '1px solid var(--portal-line)' }}>
            <div className="row" style={{ gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span className="portal-row__title" style={{ minWidth: 170 }}>{request.title}</span>
              <span className={request.state === 'pending_approval' || request.state === 'clarifying'
                ? 'portal-status--pending' : 'portal-status'}>
                {say.requestState(request.state)}
              </span>
              <span className="portal-status">{ago(request.created_at)}</span>
            </div>
            {request.note && (
              <div style={{ marginTop: 8, fontSize: 14, color: 'var(--portal-soft)', fontStyle: 'italic', lineHeight: 1.6 }}>
                “{request.note}”
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="portal-section">
        <div className="portal-section__label">{say.latestUpdate}</div>
        {latest ? (
          <div className="portal-card">
            <div className="portal-card__meta" style={{ marginBottom: 10 }}>{day(latest.published_at)}</div>
            <div className="portal-prose">{latest.body_md}</div>
          </div>
        ) : (
          <div className="portal-empty">{say.noUpdate}</div>
        )}
      </section>

      <footer style={{ paddingTop: 20, borderTop: '1px solid var(--portal-line)', fontSize: 12, color: 'var(--portal-mut)' }}>
        <a href="/portal/account">{say.account}</a>
        {' · '}
        <a href="/portal/signout">{say.signOut}</a>
      </footer>
    </main>
  );
}

function Section({ label, empty, rows, isNew, day, say, completedMeta = false }: {
  label: string;
  empty: string;
  rows: VisibleWork[];
  isNew: (iso: string) => boolean;
  day: (iso: string | null) => string;
  say: ReturnType<typeof t>;
  completedMeta?: boolean;
}) {
  return (
    <section className="portal-section">
      <div className="portal-section__label">{label}</div>
      {rows.length === 0 && <div className="portal-empty">{empty}</div>}
      {rows.map((item) => (
        <div key={item.id} className="portal-row">
          <span className="portal-row__title">{item.title}</span>
          <span style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            {isNew(item.created_at) && <span className="portal-new">{say.newLabel}</span>}
            <span className="portal-status">
              {completedMeta
                ? day(item.completed_at)
                : item.committed_date
                  ? `${say.by} ${day(item.committed_date)}`
                  : ''}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
