// Shared UI bits. Styling lives in globals.css so it can be responsive —
// inline styles can't carry media queries.

export function Nav() {
  return (
    <nav className="nav">
      <a href="/">Dashboard</a>
      <a href="/tasks">Tasks</a>
      <a href="/requests">Requests</a>
      <a href="/reports">Reports</a>
      <a href="/settings">Settings</a>
    </nav>
  );
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
