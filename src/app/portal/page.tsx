/**
 * Portal home — the client's own page, in the order they care about.
 *
 * Plain factual status. No internal dates, no estimates, no priorities, no
 * workload numbers, no hours anywhere (INV-8 in the database, and this
 * projection on top of it).
 */

import { requireClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type VisibleWork = {
  id: string;
  title: string;
  client_status: 'done' | 'in_progress' | 'waiting' | 'upcoming';
  completed_at: string | null;
  created_at: string;
};

export default async function PortalHome() {
  const { supabase } = await requireClient();

  // Every read here goes through a portal projection. A client session has
  // no policy on tasks, client_requests or clients at all, so an internal
  // date cannot be reached even by calling the API directly (INV-8).
  const [workRes, updatesRes, requestsRes, clientRes] = await Promise.all([
    supabase.from('client_visible_work')
      .select('id, title, client_status, completed_at, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('client_published_updates')
      .select('id, body_md, published_at, period_start, period_end')
      .order('published_at', { ascending: false })
      .limit(12),
    supabase.from('client_request_status')
      .select('id, state, title, note, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('client_profile').select('name').maybeSingle(),
  ]);

  const work = (workRes.data ?? []) as VisibleWork[];
  const completed = work.filter((w) => w.client_status === 'done').slice(0, 6);
  const inProgress = work.filter((w) => w.client_status === 'in_progress');
  const waiting = work.filter((w) => w.client_status === 'waiting');
  const upcoming = work.filter((w) => w.client_status === 'upcoming').slice(0, 6);

  const requests = (requestsRes.data ?? []) as { id: string; state: string; title: string; note: string | null }[];
  const openRequests = requests.filter((r) => r.state === 'clarifying' || r.state === 'pending_approval');
  const decided = requests.filter((r) => r.state === 'approved' || r.state === 'rejected');

  const relativeDay = (iso: string | null) => {
    if (!iso) return '';
    const days = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  };

  return (
    <main className="portal">
      <div className="eyebrow">{clientRes.data?.name ?? ''}</div>
      <h1 style={{ marginBottom: 24 }}>This week</h1>

      {completed.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Recently completed</div>
          {completed.map((item) => (
            <article key={item.id} className="portal-card">
              <div className="portal-card__title">{item.title}</div>
              <div className="portal-card__meta">{relativeDay(item.completed_at)}</div>
            </article>
          ))}
        </section>
      )}

      {inProgress.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Currently in progress</div>
          {inProgress.map((item) => (
            <article key={item.id} className="portal-card">
              <div className="portal-card__title">{item.title}</div>
            </article>
          ))}
        </section>
      )}

      {waiting.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Waiting on you</div>
          {waiting.map((item) => (
            <article key={item.id} className="portal-card" style={{ background: 'var(--wait-soft)', borderColor: 'var(--wait)' }}>
              <div className="portal-card__title">{item.title}</div>
            </article>
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Approved upcoming work</div>
          {upcoming.map((item) => (
            <article key={item.id} className="portal-card">
              <div className="portal-card__title">{item.title}</div>
            </article>
          ))}
        </section>
      )}

      {work.length === 0 && (
        <p style={{ marginBottom: 26 }}>
          Nothing to show here yet. When work is under way it will appear on this page.
        </p>
      )}

      {(openRequests.length > 0 || decided.length > 0) && (
        <section style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Your requests</div>
          {[...openRequests, ...decided].map((request) => (
            <article key={request.id} className="portal-card">
              <div className="portal-card__title">{request.title}</div>
              <div className="portal-card__meta">
                {request.state === 'approved' ? 'Accepted'
                  : request.state === 'rejected' ? 'Not taken on'
                    : 'Received — being reviewed'}
              </div>
              {request.note && (
                <p style={{ fontSize: 15, marginTop: 6 }}>{request.note}</p>
              )}
            </article>
          ))}
        </section>
      )}

      {(updatesRes.data ?? []).length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Updates</div>
          {(updatesRes.data ?? []).map((update) => (
            <article key={update.id} className="portal-card">
              <div className="portal-card__meta" style={{ marginBottom: 6 }}>
                {relativeDay(update.published_at)}
              </div>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 16, color: 'var(--text)' }}>
                {update.body_md}
              </p>
            </article>
          ))}
        </section>
      )}

      <a href="/portal/request" className="btn btn--primary" style={{ textAlign: 'center' }}>
        Request work
      </a>

      <form action="/portal/signout" method="post" style={{ marginTop: 20, textAlign: 'center' }}>
        <button type="submit" className="btn btn--quiet">Sign out</button>
      </form>
    </main>
  );
}
