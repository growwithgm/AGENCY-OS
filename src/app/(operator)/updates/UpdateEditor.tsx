'use client';

import { useActionState, useState } from 'react';
import { correctUpdateAction, saveDraftAction, type SaveState } from './actions';

const PROSE: React.CSSProperties = {
  fontFamily: 'var(--font-serif-stack)',
  fontSize: 16.5,
  lineHeight: 1.7,
  minHeight: 260,
  padding: 12,
};

/**
 * The left column of the split view: the text the client will read.
 *
 * A draft is editable and previewable. A published one is shown as it was
 * sent and cannot be typed into at all — the only way forward is a new
 * version.
 */
export function UpdateEditor({ updateId, body, published }: {
  updateId: string;
  body: string;
  published: boolean;
}) {
  return published
    ? <PublishedBody updateId={updateId} body={body} />
    : <DraftBody updateId={updateId} body={body} />;
}

function DraftBody({ updateId, body }: { updateId: string; body: string }) {
  const [state, submit, saving] = useActionState<SaveState, FormData>(
    saveDraftAction,
    { status: 'idle' },
  );
  const [text, setText] = useState(body);
  const unsaved = text.trim() !== body.trim();

  return (
    <>
      <form action={submit}>
        <input type="hidden" name="update_id" value={updateId} />
        <textarea
          name="body"
          className="input"
          style={PROSE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="What the client will read"
        />

        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button type="submit" className="btn btn--primary" disabled={saving || !unsaved}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          {state.status === 'error' && <span className="small risk-text">{state.message}</span>}
          {state.status === 'saved' && !unsaved && <span className="small dim">{state.message}</span>}
          {unsaved && state.status !== 'error' && (
            <span className="small dim">Not saved yet.</span>
          )}
        </div>
      </form>

      <details style={{ marginTop: 12 }}>
        <summary className="btn btn--sm" style={{ display: 'inline-flex' }}>
          Read it the way they will
        </summary>
        <div className="portal-prose" style={{ marginTop: 10 }}>{text}</div>
      </details>
    </>
  );
}

function PublishedBody({ updateId, body }: { updateId: string; body: string }) {
  const [correcting, setCorrecting] = useState(false);

  return (
    <>
      <div className="portal-prose">{body}</div>

      {!correcting ? (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => setCorrecting(true)}>
            Write a correction
          </button>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            This text has been sent, so it stays exactly as it is. A correction opens a
            new version you can edit and publish; the client keeps both on the record.
          </p>
        </div>
      ) : (
        <form action={correctUpdateAction} className="stack" style={{ marginTop: 14 }}>
          <input type="hidden" name="update_id" value={updateId} />
          <span className="label">The corrected text</span>
          <textarea
            name="body"
            className="input"
            style={PROSE}
            defaultValue={body}
            aria-label="The corrected text"
          />
          <p className="tiny dim">
            Starts a new draft at the next version number. Nothing reaches the client
            until you publish it, and the text above stays on the record either way.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn--primary">Start the correction</button>
            <button type="button" className="btn btn--quiet" onClick={() => setCorrecting(false)}>
              Leave it as it is
            </button>
          </div>
        </form>
      )}
    </>
  );
}
