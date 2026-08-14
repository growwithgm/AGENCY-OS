import { requireOperator } from '@/lib/auth';
import { listClients } from '@/data/clients';
import { openDrafts, getDraft } from '@/data/capture';
import { referenceClassFor } from '@/data/work';
import { relativePhrase } from '@/lib/format';
import { CaptureFlow } from './CaptureFlow';
import { discardDraftAction } from './actions';
import type { CaptureState } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Capture — one large input, then a parsed draft to review.
 *
 * A capture that has been read but not yet added is parked in the inbox
 * below, so a half-finished thought survives a reload instead of being
 * lost. Nothing there is work: it becomes work only when it is added.
 */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { supabase } = await requireOperator();
  const { draft: resumeId } = await searchParams;

  const [clients, drafts] = await Promise.all([
    listClients(supabase),
    openDrafts(supabase),
  ]);

  const clientList = clients.map((c) => ({ id: c.id, name: c.name, colorIndex: c.color_index }));

  // Resuming a parked capture: rebuild the review state it was saved in,
  // references and all, so it opens exactly where it was left.
  let initial: CaptureState | undefined;
  if (resumeId) {
    const draft = await getDraft(supabase, resumeId);
    if (draft && draft.state === 'open') {
      const references = await Promise.all(
        draft.items.map((item) => referenceClassFor(supabase, item.title, item.mode ?? 'operational')),
      );
      initial = {
        stage: 'review',
        draftId: draft.id,
        items: draft.items,
        parsedBy: draft.parsed_by,
        rawInput: draft.raw_input,
        references,
      };
    }
  }

  const parked = drafts.filter((d) => d.id !== resumeId);

  return (
    <main className="screen" style={{ maxWidth: 980 }}>
      <div className="head-row">
        <div>
          <div className="eyebrow">New work</div>
          <h1 className="page-title">Capture</h1>
        </div>
        <a href="/" className="btn btn--sm">Cancel</a>
      </div>

      <CaptureFlow clients={clientList} initial={initial} />

      {parked.length > 0 && !initial && (
        <>
          <div className="section-label">
            <span>Your inbox</span>
            <span className="num muted">{parked.length}</span>
          </div>
          <p className="tiny dim" style={{ marginBottom: 10 }}>
            Saved here, not scheduled — nothing becomes work until you open it and add it.
          </p>
          <div className="rows">
            {parked.map((draft) => (
              <div key={draft.id} className="rows__row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="small" style={{ flex: 1, minWidth: 0 }}>
                  <span className="clamp-2" style={{ display: 'block' }}>{draft.raw_input}</span>
                  <span className="tiny dim" style={{ display: 'block', marginTop: 2 }}>
                    {draft.items.length === 1 ? '1 item' : `${draft.items.length} items`}
                    {' · '}{relativePhrase(draft.created_at.slice(0, 10))}
                  </span>
                </span>
                <a href={`/capture?draft=${draft.id}`} className="btn btn--sm">Open</a>
                <form action={discardDraftAction}>
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button type="submit" className="btn btn--sm btn--quiet">Discard</button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
