'use client';

/**
 * The soft floor under every operator screen. A thrown error — a bad form
 * value that slipped past validation, a database hiccup — lands here as a
 * plain sentence and a way back, never as a stack trace or a dead page.
 */
export default function OperatorError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="screen">
      <div className="card" style={{ maxWidth: 520, marginTop: 48 }}>
        <div className="eyebrow">Something went wrong</div>
        <h1 className="page-title" style={{ fontSize: 26 }}>That didn&rsquo;t save</h1>
        <p className="small muted" style={{ marginTop: 8 }}>
          The last thing you did hit an error, so nothing was changed. Try it
          again — and if it keeps happening, the problem is on our side, not
          in what you typed.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button type="button" className="btn btn--primary" onClick={() => reset()}>Try again</button>
          <a className="btn" href="/">Back to Today</a>
        </div>
      </div>
    </main>
  );
}
