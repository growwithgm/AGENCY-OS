// Client portal (spec §5): token link → scoped JWT → every query through RLS.
// Never shows: operator calendar, other clients, internal tasks,
// est/actual minutes, draft reports, or the operator's private notes.
//
// Opened on a phone almost always — layout is mobile-first.

import { resolvePortalToken } from '@/lib/portalAuth';
import { scopedDb } from '@/lib/db';
import { forClient, type RequestRow } from '@/requests/policy';

export const dynamic = 'force-dynamic';

const T = {
  es: {
    panel: 'panel de cliente', upcoming: 'En curso / Próximo', nothing: 'Nada pendiente ahora mismo.',
    doneRecently: 'Completado recientemente', reports: 'Informes', noReports: 'Todavía no hay informes.',
    waiting: 'esperando', weekly: 'Semanal', monthly: 'Mensual', neu: 'Nuevo',
    requests: 'Tus solicitudes', request: 'Solicitar trabajo',
    pending: 'En revisión', approved: 'Aceptada', declined: 'No aceptada',
    invalid: 'Enlace no válido',
    invalidBody: 'Este enlace ha caducado o ha sido revocado. Pide uno nuevo a tu contacto en GROW NEST.',
  },
  en: {
    panel: 'client panel', upcoming: 'In progress / Upcoming', nothing: 'Nothing pending right now.',
    doneRecently: 'Recently completed', reports: 'Reports', noReports: 'No reports yet.',
    waiting: 'waiting', weekly: 'Weekly', monthly: 'Monthly', neu: 'New',
    requests: 'Your requests', request: 'Request work',
    pending: 'Under review', approved: 'Accepted', declined: 'Not accepted',
    invalid: 'Invalid link',
    invalidBody: 'This link has expired or been revoked. Ask your GROW NEST contact for a new one.',
  },
};

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await resolvePortalToken(token);

  if (!session) {
    return (
      <main className="container container--narrow">
        <h1>{T.es.invalid}</h1>
        <p>{T.es.invalidBody}</p>
      </main>
    );
  }

  const s = scopedDb(session.jwt);
  const [{ data: client }, { data: tasks }, { data: reports }, { data: requests }] = await Promise.all([
    s.from('clients').select('name, locale').eq('id', session.clientId).single(),
    // RLS already restricts to client_visible + own client; select only client-safe fields
    s.from('tasks').select('title, client_title, status, due_at, created_at, completed_at')
      .order('created_at', { ascending: false }),
    s.from('reports').select('id, kind, period_start, period_end, narrative_md')
      .order('period_end', { ascending: false }),
    s.from('client_requests')
      .select('id, state, raw_input, draft, operator_note, operator_note_visible, created_at')
      .in('state', ['clarifying', 'pending_approval', 'approved', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const t = (client?.locale ?? 'es').startsWith('en') ? T.en : T.es;
  const title = (x: { title: string; client_title: string | null }) => x.client_title ?? x.title;
  const isNew = (x: { created_at: string }) =>
    new Date(x.created_at) > new Date(Date.now() - 7 * 86400000);

  const upcoming = (tasks ?? []).filter((x) => x.status !== 'done');
  const done = (tasks ?? []).filter((x) => x.status === 'done').slice(0, 10);

  // operator notes are stripped here — the client only ever sees what was marked visible
  const visibleRequests = (requests ?? []).map((r) => forClient(r as RequestRow));
  const stateLabel: Record<string, string> = {
    clarifying: t.pending, pending_approval: t.pending, approved: t.approved, rejected: t.declined,
  };

  return (
    <main className="container container--narrow">
      <div className="page-head">
        <div>
          <h1>{client?.name}</h1>
          <p className="muted small">GROW NEST — {t.panel}</p>
        </div>
        <a href={`/c/${token}/request`} className="btn" style={{ textDecoration: 'none' }}>
          + {t.request}
        </a>
      </div>

      <section className="card">
        <h2>{t.upcoming}</h2>
        {upcoming.length === 0 && <p>{t.nothing}</p>}
        <ul className="list">
          {upcoming.map((x, i) => (
            <li key={i}>
              {title(x)}
              {isNew(x) && <span className="badge">{t.neu}</span>}
              {x.status === 'blocked' && <em style={{ color: '#c98a3d' }}> — {t.waiting}</em>}
              {x.due_at && <div className="item__meta">{x.due_at.slice(0, 10)}</div>}
            </li>
          ))}
        </ul>
      </section>

      {visibleRequests.length > 0 && (
        <section className="card">
          <h2>{t.requests}</h2>
          <ul className="list">
            {visibleRequests.map((r) => (
              <li key={r.id}>
                {r.title}
                <div className="item__meta">
                  {stateLabel[r.state] ?? r.state}
                  {r.note && <> · {r.note}</>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>{t.doneRecently}</h2>
        {done.length === 0 && <p>—</p>}
        <ul className="list">
          {done.map((x, i) => (
            <li key={i}>
              {title(x)}
              <div className="item__meta">{x.completed_at?.slice(0, 10)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{t.reports}</h2>
        {(reports ?? []).length === 0 && <p>{t.noReports}</p>}
        {(reports ?? []).map((r) => (
          <details key={r.id} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', minHeight: 36, display: 'flex', alignItems: 'center' }}>
              {r.kind === 'weekly' ? t.weekly : t.monthly} · {r.period_start} → {r.period_end}
            </summary>
            <article className="prose" style={{ paddingTop: 8 }}>{r.narrative_md}</article>
          </details>
        ))}
      </section>
    </main>
  );
}
