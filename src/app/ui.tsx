// Shared inline styles. Deliberately minimal — this app is a working
// surface for one operator, not a design system.

import type { CSSProperties } from 'react';

export const card: CSSProperties = {
  background: '#171a21', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
};

export const input: CSSProperties = {
  background: '#0f1115', color: '#e6e8ee', border: '1px solid #2a2f3a',
  borderRadius: 8, padding: '8px 10px', fontSize: 14, width: '100%',
};

export const button: CSSProperties = {
  background: '#2b4c7e', color: 'white', border: 'none',
  borderRadius: 8, padding: '8px 16px', fontSize: 14, cursor: 'pointer',
};

export const buttonGreen: CSSProperties = { ...button, background: '#2e7d32' };
export const buttonSubtle: CSSProperties = { ...button, background: '#2a2f3a' };

export const label: CSSProperties = { display: 'block', fontSize: 12, color: '#9aa3b2', marginBottom: 4 };
export const link: CSSProperties = { color: '#7aa2f7' };
export const muted: CSSProperties = { color: '#9aa3b2' };

export function Nav() {
  return (
    <nav style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 14 }}>
      <a href="/" style={link}>Dashboard</a>
      <a href="/tasks" style={link}>Tasks</a>
      <a href="/reports" style={link}>Reports</a>
      <a href="/settings" style={link}>Settings</a>
    </nav>
  );
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}
