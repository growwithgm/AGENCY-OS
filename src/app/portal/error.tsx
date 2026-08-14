'use client';

/**
 * The soft floor under the client portal. A client must never meet a stack
 * trace: an error is one calm sentence and a way back to their page.
 */
export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="cp-app" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="cp-card" style={{ maxWidth: 480, padding: '28px 26px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, opacity: .75, marginBottom: 16 }}>
          That last step hit an error on our side, so nothing was sent or
          changed. Please try again.
        </p>
        <button type="button" className="cp-cta" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
