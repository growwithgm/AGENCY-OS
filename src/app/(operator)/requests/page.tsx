/**
 * Requests — what clients have asked for, and what became of each one.
 *
 * A request is not work: it sits here, invisible to the planner, taking no
 * capacity at all until it is approved (INV-3).
 */

import { requireOperator } from '@/lib/auth';
import { pendingRequests, requestsForClient, type ClientRequest, type RequestState } from '@/data/requests';
import { listClients } from '@/data/clients';
import { relativePhrase } from '@/lib/format';
import { ClientName } from '@/components/marks';

export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<RequestState, string> = {
  clarifying: 'Clarifying',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Declined',
  expired: 'Expired',
};

const STATE_CHIP: Record<RequestState, string> = {
  clarifying: 'chip--waiting',
  pending_approval: 'chip--pending',
  approved: 'chip--done',
  rejected: 'chip--blocked',
  expired: 'chip--scheduled',
};

/** Their words, shortened for a row. Text only — it is never read as an instruction. */
function summarise(request: ClientRequest): string {
  const drafted = request.draft?.title?.trim();
  if (drafted) return drafted;

  const raw = request.raw_input.replace(/\s+/g, ' ').trim();
  return raw.length > 110 ? `${raw.slice(0, 110)}…` : raw;
}

export default async function RequestsPage() {
  const { supabase } = await requireOperator();

  const [pending, clients] = await Promise.all([
    pendingRequests(supabase),
    listClients(supabase),
  ]);
  const perClient = await Promise.all(clients.map((c) => requestsForClient(supabase, c.id)));

  // The per-client lists only cover active clients; the pending list covers
  // every client there is, so nothing awaiting a decision can hide behind a
  // client whose status changed.
  const byId = new Map<string, ClientRequest>();
  for (const request of [...perClient.flat(), ...pending]) byId.set(request.id, request);

  const all = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const waitingOnYou = all.filter((r) => r.state === 'pending_approval');
  const waitingOnThem = all.filter((r) => r.state === 'clarifying');
  const decided = all.filter((r) => !['pending_approval', 'clarifying'].includes(r.state));

  const clientOf = (request: ClientRequest) => {
    const match = clients.find((c) => c.id === request.client_id);
    return {
      name: match?.name ?? request.clients?.name ?? 'Former client',
      colorIndex: match?.color_index ?? null,
    };
  };

  const Row = ({ request }: { request: ClientRequest }) => {
    const { name, colorIndex } = clientOf(request);
    return (
      <a
        href={`/requests/${request.id}`}
        className="rows__row"
        style={{ color: 'inherit', textDecoration: 'none' }}
      >
        <span className="stack" style={{ gap: 3, flex: '1 1 260px', minWidth: 0 }}>
          <span className="small dim"><ClientName name={name} colorIndex={colorIndex} /></span>
          <span style={{ fontWeight: 500, textWrap: 'pretty' }}>{summarise(request)}</span>
        </span>
        <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <span className="tiny dim">
            asked <span className="num">{relativePhrase(request.created_at.slice(0, 10))}</span>
          </span>
          <span className={`chip ${STATE_CHIP[request.state]}`}>{STATE_LABEL[request.state]}</span>
        </span>
      </a>
    );
  };

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">From your clients</div>
          <h1 className="page-title">Requests</h1>
        </div>
        
      </div>

      <div className="flag flag--info">
        <span className="flag__dot" aria-hidden />
        <span>A request takes none of your capacity until you approve it.</span>
      </div>

      {all.length === 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="muted">Nobody has asked you for anything yet.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            When a client sends something through their portal it arrives here first, and
            waits for you to approve, decline, or ask them more.
          </p>
        </div>
      )}

      {waitingOnYou.length > 0 && (
        <>
          <div className="section-label">
            <span>Waiting on you</span>
            <span className="num muted">{waitingOnYou.length}</span>
          </div>
          <div className="card">
            <div className="rows">
              {waitingOnYou.map((request) => <Row key={request.id} request={request} />)}
            </div>
          </div>
        </>
      )}

      {waitingOnThem.length > 0 && (
        <>
          <div className="section-label">
            <span>Waiting on them</span>
            <span className="num muted">{waitingOnThem.length}</span>
          </div>
          <div className="card">
            <div className="rows">
              {waitingOnThem.map((request) => <Row key={request.id} request={request} />)}
            </div>
          </div>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            You asked these clients a question. They come back here once answered.
          </p>
        </>
      )}

      {decided.length > 0 && (
        <>
          <div className="section-label">
            <span>Decided</span>
            <span className="num muted">{decided.length}</span>
          </div>
          <div className="card">
            <div className="rows">
              {decided.map((request) => <Row key={request.id} request={request} />)}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
