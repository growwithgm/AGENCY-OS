// Client portal (spec §5): token link → scoped JWT → every query through RLS.
// Never shows: operator calendar, other clients, internal tasks,
// est/actual minutes, or draft reports.

import { resolvePortalToken } from '@/lib/portalAuth';
import { scopedDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
  const [{ data: client }, { data: tasks }, { data: reports }] = await Promise.all([
    s.from('clients').select('name, locale').eq('id', session.clientId).single(),
    // RLS already restricts to client_visible + own client; select only client-safe fields
    s.from('tasks').select('title, client_title, status, due_at, created_at, completed_at')
      .order('created_at', { ascending: false }),
    s.from('reports').select('id, kind, period_start, period_end, narrative_md')
      .order('period_end', { ascending: false }),
  ]);

  const title = (t: { title: string; client_title: string | null }) => t.client_title ?? t.title;
  const isNew = (t: { created_at: string }) =>
    new Date(t.created_at) > new Date(Date.now() - 7 * 86400000);

  const upcoming = (tasks ?? []).filter((t) => !['done'].includes(t.status));
  const done = (tasks ?? []).filter((t) => t.status === 'done').slice(0, 10);

  const card: React.CSSProperties = {
    background: '#171a21', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
  };

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>{client?.name}</h1>
      <p style={{ color: '#9aa3b2' }}>GROW NEST — panel de cliente</p>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>En curso / Próximo</h2>
        {upcoming.length === 0 && <p>Nada pendiente ahora mismo.</p>}
        <ul>
          {upcoming.map((t, i) => (
            <li key={i}>
              {title(t)}
              {isNew(t) && <span style={{
                background: '#2b4c7e', borderRadius: 6, fontSize: 11,
                padding: '1px 6px', marginLeft: 8,
              }}>Nuevo</span>}
              {t.status === 'blocked' && <em style={{ color: '#c98a3d' }}> — esperando</em>}
              {t.due_at && <span style={{ color: '#9aa3b2' }}> · {t.due_at.slice(0, 10)}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Completado recientemente</h2>
        {done.length === 0 && <p>—</p>}
        <ul>
          {done.map((t, i) => (
            <li key={i}>{title(t)} <span style={{ color: '#9aa3b2' }}>· {t.completed_at?.slice(0, 10)}</span></li>
          ))}
        </ul>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Informes</h2>
        {(reports ?? []).length === 0 && <p>Todavía no hay informes.</p>}
        {(reports ?? []).map((r) => (
          <details key={r.id} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer' }}>
              {r.kind === 'weekly' ? 'Semanal' : 'Mensual'} · {r.period_start} → {r.period_end}
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
