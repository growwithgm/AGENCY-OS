/** The portal's between-pages moment: quiet shapes on the sand ground. */
export default function PortalLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading"
      style={{ minHeight: '100vh', padding: 'clamp(18px, 4vw, 48px)', maxWidth: 960, margin: '0 auto' }}
    >
      <div className="skeleton" style={{ height: 30, width: 220, marginBottom: 20 }} />
      <div className="skeleton" style={{ height: 110, marginBottom: 14 }} />
      <div className="skeleton" style={{ height: 110, width: '80%' }} />
    </main>
  );
}
