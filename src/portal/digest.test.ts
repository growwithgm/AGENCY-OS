import { describe, it, expect } from 'vitest';
import { buildDigest, renderDigest } from './digest';

/**
 * What leaves the building. The digest is the one place client-facing text
 * is generated without the operator watching, so what it may and may not
 * contain is pinned here.
 */

const week = {
  clientId: 'c1',
  clientName: 'ibBan',
  locale: 'en' as const,
  recipients: ['maria@ibban.com', 'luis@ibban.com'],
  completed: [{ title: 'Ad creatives' }],
  inProgress: [
    { title: 'Pricing page copy', committed_date: '2026-08-21' },
    { title: 'Shipping rates review', committed_date: null },
  ],
  added: [{ title: 'Autumn campaign brief' }],
};

describe('building a digest', () => {
  it('groups the week into completed, in progress and upcoming', () => {
    const digest = buildDigest(week);
    expect(digest.sections.map((s) => s.label)).toEqual(['Completed', 'In progress', 'Approved and coming up']);
    expect(digest.empty).toBe(false);
  });

  it('drops a section that has nothing in it rather than printing an empty heading', () => {
    const digest = buildDigest({ ...week, completed: [], added: [] });
    expect(digest.sections).toHaveLength(1);
    expect(digest.sections[0].label).toBe('In progress');
  });

  it('says plainly when there is nothing to send', () => {
    const digest = buildDigest({ ...week, completed: [], inProgress: [], added: [] });
    expect(digest.empty).toBe(true);
    expect(digest.sections).toHaveLength(0);
  });

  it('labels its sections in plain English', () => {
    const digest = buildDigest(week);
    expect(digest.sections.map((s) => s.label)).toEqual([
      'Completed', 'In progress', 'Approved and coming up',
    ]);
  });
});

describe('rendering a digest', () => {
  it('carries a date only where a commitment was made', () => {
    const { body } = renderDigest(buildDigest(week), 'https://example.com/portal');

    expect(body).toContain('Pricing page copy — By 2026-08-21');
    // No commitment, so no date, no "soon", no range.
    expect(body).toContain('· Shipping rates review');
    expect(body).not.toMatch(/Shipping rates review.*—/);
  });

  it('never leaks an hour, an estimate or an internal date', () => {
    const { body } = renderDigest(buildDigest(week), 'https://example.com/portal');

    expect(body).not.toMatch(/\d+h\b/);
    expect(body).not.toMatch(/\bminutes?\b/i);
    expect(body).not.toMatch(/priority/i);
    expect(body).not.toMatch(/estimate/i);
    expect(body).not.toMatch(/target/i);
    expect(body).not.toMatch(/capacity/i);
  });

  it('ends with the portal link, so the email is never the only record', () => {
    const { body } = renderDigest(buildDigest(week), 'https://example.com/portal');
    expect(body.trim().endsWith('https://example.com/portal')).toBe(true);
  });

  it('keeps a plain English subject', () => {
    expect(renderDigest(buildDigest(week), 'x').subject).toBe('Your week with us');
  });
});

describe('digest idempotency key', () => {
  it('is the same for every day of one ISO week', async () => {
    const { weekKey } = await import('./digest');
    // Mon 2026-08-10 through Sun 2026-08-16 are one ISO week.
    expect(weekKey(new Date('2026-08-10T00:00:00Z'))).toBe(weekKey(new Date('2026-08-16T23:59:59Z')));
  });

  it('changes across the week boundary and the year boundary', async () => {
    const { weekKey } = await import('./digest');
    expect(weekKey(new Date('2026-08-16T23:59:59Z'))).not.toBe(weekKey(new Date('2026-08-17T00:00:00Z')));
    // 2027-01-01 is a Friday: ISO says it belongs to 2026's final week — the
    // key must follow ISO, not the calendar year, or the new-year digest
    // would double-send.
    expect(weekKey(new Date('2027-01-01T12:00:00Z'))).toBe(weekKey(new Date('2026-12-31T12:00:00Z')));
  });
});
