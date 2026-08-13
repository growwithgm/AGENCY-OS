/**
 * Work — everything open, in one list you can filter, group and act on.
 *
 * Filtering happens in the URL so the list stays a server render: what is
 * on screen came from the database on this request, not from state a
 * browser has been holding since breakfast.
 */

import { requireOperator } from '@/lib/auth';
import { listWork } from '@/data/work';
import { getClient, listClients } from '@/data/clients';
import { hm, shortDate } from '@/lib/format';
import { ClientName, ModeChip, PriorityMark, StatusChip } from '@/components/marks';
import type { ClientRow, WorkMode, WorkRow, WorkStatus } from '@/data/types';
import { MODE_LABELS } from '@/data/types';
import { BulkBar, WorkFilters } from './WorkFilters';

export const dynamic = 'force-dynamic';

type Search = { status?: string; client?: string; mode?: string; group?: string };

/** The states worth filtering by. `review` is left out: nothing sets it yet,
 *  and a filter that always returns nothing is a lie about the data. */
const STATUS_FILTERS: WorkStatus[] = [
  'in_progress', 'scheduled', 'blocked', 'waiting_on_client', 'backlog', 'done',
];

export default async function WorkPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase } = await requireOperator();
  const params = await searchParams;

  const status = STATUS_FILTERS.includes(params.status as WorkStatus)
    ? (params.status as WorkStatus)
    : undefined;
  const mode = params.mode && params.mode in MODE_LABELS
    ? (params.mode as WorkMode)
    : undefined;
  const grouped = params.group === 'client';

  const clients = await listClients(supabase);
  const clientId = clients.some((c) => c.id === params.client) ? params.client : undefined;

  const all = await listWork(supabase, { clientId, status, limit: 300 });
  // Mode is not a column the query filters on, so it is applied here rather
  // than by adding a second read path.
  const items = mode ? all.filter((w) => w.mode === mode) : all;
  const rows = [...items].sort(byPlanOrder);

  // listClients only returns active clients, and work outlives a client's
  // active status. Anything left over is fetched by id so an archived
  // client keeps its own name and its own colour instead of borrowing
  // someone else's.
  const active = new Set(clients.map((c) => c.id));
  const strays = [...new Set(rows.map((w) => w.client_id))].filter((cid) => !active.has(cid));
  const archived = (await Promise.all(strays.map((cid) => getClient(supabase, cid))))
    .filter((c): c is ClientRow => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  const everyClient = [...clients, ...archived];
  const byId = new Map(everyClient.map((c) => [c.id, c]));
  const totalEstimate = rows.reduce((sum, w) => sum + (w.est_minutes ?? 0), 0);
  const filtered = Boolean(status || clientId || mode);

  const groups = grouped ? groupByClient(rows, everyClient) : null;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Everything on the books</div>
          <h1 className="page-title">Work</h1>
        </div>
        <span className="num muted">
          {rows.length} item{rows.length === 1 ? '' : 's'} · {hm(totalEstimate)} estimated
        </span>
      </div>

      <WorkFilters
        clients={clients.map((c) => ({ id: c.id, name: c.name, color_index: c.color_index }))}
        statuses={STATUS_FILTERS}
        status={status ?? ''}
        clientId={clientId ?? ''}
        mode={mode ?? ''}
        grouped={grouped}
      />

      {rows.length === 0 && (
        <div className="card">
          {filtered ? (
            <>
              <p className="muted">Nothing here matches the filters you have set.</p>
              <p className="tiny dim" style={{ marginTop: 6 }}>
                Widen one of them, or <a href={grouped ? '/work?group=client' : '/work'}>clear them all</a>.
              </p>
            </>
          ) : (
            <>
              <p className="muted">There is no work on the books yet.</p>
              <p className="tiny dim" style={{ marginTop: 6 }}>
                Anything you capture, and every client request you approve, lands here.
              </p>
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <form>
          {groups
            ? groups.map((group) => (
              <section key={group.client.id}>
                <div className="section-label">
                  <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12.5 }}>
                    <ClientName name={group.client.name} colorIndex={group.client.color_index} />
                  </span>
                  <span className="num">
                    {group.rows.length} item{group.rows.length === 1 ? '' : 's'} ·{' '}
                    {hm(group.rows.reduce((sum, w) => sum + (w.est_minutes ?? 0), 0))}
                  </span>
                </div>
                <div className="card" style={{ padding: '2px 14px' }}>
                  <div className="rows">
                    {group.rows.map((work) => (
                      <Row key={work.id} work={work} client={byId.get(work.client_id) ?? null} />
                    ))}
                  </div>
                </div>
              </section>
            ))
            : (
              <div className="card" style={{ padding: '2px 14px' }}>
                <div className="rows">
                  {rows.map((work) => (
                    <Row key={work.id} work={work} client={byId.get(work.client_id) ?? null} />
                  ))}
                </div>
              </div>
            )}

          <BulkBar />
        </form>
      )}
    </main>
  );
}

function Row({ work, client }: { work: WorkRow; client: ClientRow | null }) {
  return (
    <div className="rows__row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <input
        type="checkbox"
        name="work_id"
        value={work.id}
        aria-label={`Select ${work.title}`}
        style={{ width: 16, height: 16, flex: '0 0 16px', marginTop: 4 }}
      />

      <a
        href={`/work/${work.id}`}
        style={{ flex: '1 1 240px', minWidth: 0, color: 'inherit', textDecoration: 'none' }}
      >
        <div className="small muted">
          <ClientName name={client?.name ?? work.clients?.name ?? null} colorIndex={client?.color_index} />
        </div>
        <div style={{ fontWeight: 500, marginTop: 2, textWrap: 'pretty' }}>{work.title}</div>
        <div className="row" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
          <ModeChip mode={work.mode} />
          <StatusChip status={work.status} />
          <PriorityMark priority={work.priority} />
          {work.committed_date && (
            <span className="tag">Committed <span className="num">{shortDate(work.committed_date)}</span></span>
          )}
          {work.internal_target && (
            <span className="tag tag--info">Target <span className="num">{shortDate(work.internal_target)}</span></span>
          )}
        </div>
      </a>

      <span className="num num--right muted" style={{ flex: '0 0 66px' }}>
        {hm(work.est_minutes ?? 0)}
      </span>
    </div>
  );
}

function groupByClient(rows: WorkRow[], clients: ClientRow[]) {
  return clients
    .map((client) => ({ client, rows: rows.filter((w) => w.client_id === client.id) }))
    .filter((group) => group.rows.length > 0);
}

/**
 * Finished work sinks, then the nearest date, then priority. A row with no
 * date sorts after one that has a date rather than being given a made-up one.
 */
function byPlanOrder(a: WorkRow, b: WorkRow): number {
  if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;

  const dateA = a.committed_date ?? a.internal_target ?? '';
  const dateB = b.committed_date ?? b.internal_target ?? '';
  if (dateA !== dateB) {
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA < dateB ? -1 : 1;
  }

  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.created_at < b.created_at ? 1 : -1;
}
