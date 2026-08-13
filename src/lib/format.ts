/**
 * Display helpers. Times are always rendered in the mono `.num` class.
 *
 * Duration format everywhere: `1h 30m` — never `1.5h`, never `90 min`.
 * Empty is `—`, never `0h 0m`. Deltas are signed with a real minus sign.
 */

export function hm(minutes: number): string {
  const m0 = Math.round(minutes || 0);
  if (m0 <= 0) return '—';
  const h = Math.floor(m0 / 60);
  const m = m0 % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** For a delta: `+1h 30m` / `−45m` / `—` when nothing changed. */
export function hmSigned(minutes: number): string {
  const m0 = Math.round(minutes || 0);
  if (m0 === 0) return '—';
  return `${m0 > 0 ? '+' : '−'}${hm(Math.abs(m0))}`;
}

/** For a percentage delta: `+60%` / `−12%`. */
export function pctSigned(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct === 0) return '—';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/** Compact form for a chip: 45m, 2h, 2h30. */
export function hmShort(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs === 0) return '—';
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function longDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export function shortDate(key: string | null): string {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function relativeDays(from: string | null, to = todayKey()): number | null {
  if (!from) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** "in 2 days" / "today" / "3 days ago" — used in the why-is-this-here line. */
export function relativePhrase(dateKeyValue: string | null, today = todayKey()): string {
  const days = relativeDays(dateKeyValue, today);
  if (days === null) return 'no date';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days === -1) return 'tomorrow';
  return days > 0 ? `${days} days ago` : `in ${Math.abs(days)} days`;
}
