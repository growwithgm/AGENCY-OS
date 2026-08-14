/**
 * Shown the instant a navigation starts, while the server renders the
 * screen. The shapes echo the real layout — a title, stats, cards — so the
 * page appears to be arriving rather than the app appearing to hang.
 */
export default function OperatorLoading() {
  return (
    <main className="screen" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 14, width: 140, marginTop: 4 }} />
      <div className="skeleton" style={{ height: 32, width: 260, margin: '10px 0 22px' }} />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 74 }} />)}
      </div>
      <div className="skeleton" style={{ height: 180, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 180, width: '72%' }} />
    </main>
  );
}
