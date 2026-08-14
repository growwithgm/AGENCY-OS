/**
 * Portal home — the client's workspace, shaped like a dashboard.
 *
 * Dark sidebar, topbar, a stat row, active work beside the ask-us form,
 * completed work as a table. Plain factual status throughout: no internal
 * dates, no estimates, no priorities, no progress percentages (INV-8 in
 * the database, and this projection on top of it).
 *
 * Where a piece of work has no committed date, it shows NO date at all —
 * not "soon", not a range, not a progress bar. Silence is correct;
 * anything else is a promise the operator did not make.
 */

import { requireClient } from '@/lib/auth';
import { COPY } from '@/portal/copy';
import { RequestFlow } from './request/RequestFlow';
import { answerFollowUpAction } from './request/actions';

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
  const say = COPY;

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
      .select('id, state, title, note, question, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('client_profile').select('name').maybeSingle(),
  ]);

  const clientName = clientRes.data?.name ?? '';
  const initials = clientName
    .split(/\s+/).map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'C';

  const work = (workRes.data ?? []) as VisibleWork[];
  const waiting = work.filter((w) => w.client_status === 'waiting');
  const inProgress = work.filter((w) => w.client_status === 'in_progress');
  const completed = work.filter((w) => w.client_status === 'done');
  const upcoming = work.filter((w) => w.client_status === 'upcoming');

  const requests = (requestsRes.data ?? []) as {
    id: string; state: string; title: string; note: string | null;
    question: string | null; created_at: string;
  }[];
  const openRequests = requests.filter(
    (r) => r.state === 'pending_approval' || r.state === 'clarifying',
  );

  const latest = (updatesRes.data ?? [])[0] as
    | { id: string; body_md: string; published_at: string }
    | undefined;

  const isNew = (iso: string) => Date.now() - Date.parse(iso) < NEW_FOR_HOURS * 3600_000;

  const day = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  };

  const ago = (iso: string) => {
    const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
    if (days <= 0) return say.today;
    if (days === 1) return say.yesterday;
    if (days < 7) return say.daysAgo(days);
    return day(iso);
  };

  const statusPill = (status: VisibleWork['client_status']) => {
    if (status === 'in_progress') return <span className="cp-pill cp-pill--progress">{say.shell.statusInProgress}</span>;
    if (status === 'waiting') return <span className="cp-pill cp-pill--waiting">{say.shell.statusWaiting}</span>;
    if (status === 'done') return <span className="cp-pill cp-pill--done">{say.shell.done}</span>;
    return <span className="cp-pill cp-pill--upcoming">{say.shell.statusUpcoming}</span>;
  };

  return (
    <>
      <div className="cp-app">
        <aside className="cp-sidebar">
          <div className="cp-brand">
            <span className="cp-brand-mark">A</span>
            Agency OS
          </div>

          <div className="cp-client-box">
            <div className="cp-client-name">{clientName}</div>
            <div className="cp-client-plan">{say.shell.workspace}</div>
          </div>

          <nav className="cp-nav">
            <a className="cp-nav-item cp-nav-item--active" href="#top">{say.shell.navOverview}</a>
            <a className="cp-nav-item" href="#active">{say.shell.navTasks}</a>
            <a className="cp-nav-item" href="#ask">{say.shell.navAsk}</a>
            <a className="cp-nav-item" href="#history">{say.shell.navHistory}</a>
          </nav>

          <div className="cp-sidebar-bottom">
            <a href="/portal/account">{say.account}</a>
            <a href="/portal/signout">{say.signOut}</a>
          </div>
        </aside>

        <div className="cp-main" id="top">
          <header className="cp-topbar">
            <div className="cp-topbar-title">{say.shell.portalTitle}</div>
            <a href="/portal/account" className="cp-avatar" aria-label={say.account}>{initials}</a>
          </header>

          <div className="cp-content">
            <div className="cp-hero">
              <div>
                <h1>{clientName}</h1>
                <p>{say.subtitle}</p>
              </div>
              <a href="#ask" className="cp-cta">+ {say.askUs}</a>
            </div>

            <div className="cp-stats">
              <div className="cp-stat">
                <div className="cp-stat-label">{say.shell.statActive}</div>
                <div className="cp-stat-value">{inProgress.length + upcoming.length}</div>
              </div>
              <div className="cp-stat">
                <div className="cp-stat-label">{say.shell.statWaiting}</div>
                <div className="cp-stat-value" style={waiting.length ? { color: 'var(--amber-deep)' } : undefined}>
                  {waiting.length}
                </div>
              </div>
              <div className="cp-stat">
                <div className="cp-stat-label">{say.shell.statOpenRequests}</div>
                <div className="cp-stat-value">{openRequests.length}</div>
              </div>
              <div className="cp-stat">
                <div className="cp-stat-label">{say.shell.statCompleted}</div>
                <div className="cp-stat-value">{completed.length}</div>
              </div>
            </div>

            {waiting.length > 0 && (
              <div className="portal-callout" style={{ marginBottom: 20 }}>
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

            <div className="cp-grid">
              <section className="cp-card" id="active">
                <div className="cp-card-head">
                  <div>
                    <h2>{say.shell.activeTitle}</h2>
                    <p>{say.shell.activeSub}</p>
                  </div>
                </div>
                <div className="cp-tasks">
                  {[...inProgress, ...upcoming].length === 0 && (
                    <div className="cp-task"><span className="portal-empty">{say.shell.noneActive}</span></div>
                  )}
                  {[...inProgress, ...upcoming].map((item) => (
                    <article key={item.id} className="cp-task">
                      <div style={{ minWidth: 0 }}>
                        <div className="cp-task-top">
                          <span className="cp-task-title">{item.title}</span>
                          {statusPill(item.client_status)}
                          {isNew(item.created_at) && <span className="portal-new">{say.newLabel}</span>}
                        </div>
                      </div>
                      {/* A date appears ONLY when one was committed to. */}
                      {item.committed_date && (
                        <div className="cp-task-right">
                          <div className="cp-due-label">{say.by}</div>
                          <div className="cp-due-date">{day(item.committed_date)}</div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>

              <aside className="cp-card" id="ask">
                <div className="cp-card-head">
                  <div>
                    <h2>{say.shell.askTitle}</h2>
                    <p>{say.shell.askSub}</p>
                  </div>
                </div>
                <div className="cp-form">
                  <RequestFlow />
                </div>
                <div className="cp-notice">{say.shell.help}</div>

                {requests.length > 0 && (
                  <div className="cp-requests">
                    <div className="cp-requests-label">{say.whatYouAsked}</div>
                    {requests.map((request) => (
                      <div key={request.id} className="cp-request-row" style={{ display: 'block' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span className="cp-request-title">{request.title}</span>
                          <span className={
                            request.state === 'pending_approval' || request.state === 'clarifying'
                              ? 'portal-status--pending' : 'portal-status'
                          }>
                            {say.requestState(request.state)}
                          </span>
                        </div>
                        {request.note && (
                          <div className="cp-helper" style={{ fontStyle: 'italic' }}>“{request.note}”</div>
                        )}
                        {/* The operator's question, answered right here. */}
                        {request.state === 'clarifying' && request.question && (
                          <div className="cp-question">
                            <div className="cp-question-label">{say.request.weHaveAQuestion}</div>
                            <div style={{ fontSize: 13.5, marginBottom: 8 }}>{request.question}</div>
                            <form action={answerFollowUpAction}>
                              <input type="hidden" name="request_id" value={request.id} />
                              <label className="sr-only" htmlFor={`answer-${request.id}`}>
                                {say.request.answerLabel}
                              </label>
                              <textarea
                                id={`answer-${request.id}`}
                                name="answer"
                                required
                                rows={2}
                                className="input"
                                style={{ marginBottom: 8 }}
                              />
                              <button type="submit" className="cp-submit">{say.request.send}</button>
                            </form>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>

            <section className="cp-card" style={{ marginTop: 20 }}>
              <div className="cp-card-head">
                <div>
                  <h2>{say.latestUpdate}</h2>
                </div>
              </div>
              <div className="cp-form">
                {latest ? (
                  <>
                    <div className="portal-card__meta" style={{ marginBottom: 10 }}>{day(latest.published_at)}</div>
                    <div className="portal-prose">{latest.body_md}</div>
                  </>
                ) : (
                  <div className="portal-empty">{say.noUpdate}</div>
                )}
              </div>
            </section>

            <section className="cp-card" style={{ marginTop: 20 }} id="history">
              <div className="cp-card-head">
                <div>
                  <h2>{say.shell.historyTitle}</h2>
                  <p>{say.shell.historySub}</p>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>{say.shell.colTask}</th>
                      <th>{say.shell.colCompleted}</th>
                      <th>{say.shell.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completed.length === 0 && (
                      <tr><td colSpan={3}><span className="portal-empty">{say.shell.noneCompleted}</span></td></tr>
                    )}
                    {completed.map((item) => (
                      <tr key={item.id}>
                        <td className="cp-task-title">{item.title}</td>
                        <td className="portal-status">{day(item.completed_at)}</td>
                        <td><span className="cp-pill cp-pill--done">{say.shell.done}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>

      <nav className="cp-mobile-nav">
        <a href="#top">{say.shell.navOverview}</a>
        <a href="#active">{say.shell.navTasks}</a>
        <a href="#ask">{say.shell.navAsk}</a>
        <a href="#history">{say.shell.navHistory}</a>
      </nav>
    </>
  );
}
