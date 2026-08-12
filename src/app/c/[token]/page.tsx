// Client portal (spec §5): token link → scoped JWT → every query through RLS.
// Never shows: operator calendar, other clients, internal tasks,
// est/actual minutes, draft reports, or the operator's private notes.

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
  },
  en: {
    panel: 'client panel', upcoming: 'In progress / Upcoming', nothing: 'Nothing pending right now.',
    doneRecently: 'Recently completed', reports: 'Reports', noReports: 'No reports yet.',
    waiting: 'waiting', weekly: 'Weekly', monthly: 'Monthly', neu: 'New',
    requests: 'Your requests', request: 'Request work',
    pending: 'Under review', approved: 'Accepted', declined: 'Not accepted',
  },
};

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await resolvePortalToken(token);

  if (!session) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Enlace no válido</h1>
        <p>Este enlace ha caducado o ha sido revocado. Pide uno nuevo a tu contacto en GROW NEST.</p>
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

  const card: React.CSSProperties = {
    background: '#171a21', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
  };

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 0 }}>{client?.name}</h1>
          <p style={{ color: '#9aa3b2', marginTop: 4 }}>GROW NEST — {t.panel}</p>
        </div>
        <a href={`/c/${token}/request`} style={{
          background: '#2b4c7e', color: 'white', borderRadius: 8,
          padding: '10px 16px', fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap',
        }}>
          + {t.request}
        </a>
      </div>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>{t.upcoming}</h2>
        {upcoming.length === 0 && <p>{t.nothing}</p>}
        <ul>
          {upcoming.map((x, i) => (
            <li key={i}>
              {title(x)}
              {isNew(x) && <span style={{
                background: '#2b4c7e', borderRadius: 6, fontSize: 11,
                padding: '1px 6px', marginLeft: 8,
              }}>{t.neu}</span>}
              {x.status === 'blocked' && <em style={{ color: '#c98a3d' }}> — {t.waiting}</em>}
              {x.due_at && <span style={{ color: '#9aa3b2' }}> · {x.due_at.slice(0, 10)}</span>}
            </li>
          ))}
        </ul>
      </section>

      {visibleRequests.length > 0 && (
        <section style={card}>
          <h2 style={{ fontSize: 17 }}>{t.requests}</h2>
          <ul>
            {visibleRequests.map((r) => (
              <li key={r.id}>
                {r.title}
                <span style={{ color: '#9aa3b2' }}> · {stateLabel[r.state] ?? r.state}</span>
                {r.note && <div style={{ color: '#9aa3b2', fontSize: 13 }}>{r.note}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>{t.doneRecently}</h2>
        {done.length === 0 && <p>—</p>}
        <ul>
          {done.map((x, i) => (
            <li key={i}>{title(x)} <span style={{ color: '#9aa3b2' }}>· {x.completed_at?.slice(0, 10)}</span></li>
          ))}
        </ul>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>{t.reports}</h2>
        {(reports ?? []).length === 0 && <p>{t.noReports}</p>}
        {(reports ?? []).map((r) => (
          <details key={r.id} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer' }}>
              {r.kind === 'weekly' ? t.weekly : t.monthly} · {r.period_start} → {r.period_end}
            </summary>
            <article style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, paddingTop: 8 }}>
              {r.narrative_md}
            </article>
          </details>
        ))}
      </section>
    </main>
  );
}
