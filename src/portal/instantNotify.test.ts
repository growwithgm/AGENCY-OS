import { describe, expect, it } from 'vitest';
import { renderInstant } from './instantNotify';

describe('instant notify emails', () => {
  it('a finished visible item becomes one plain line and the portal link', () => {
    const { subject, body } = renderInstant(
      'ibBan',
      { kind: 'work_finished', title: 'Meta creative refresh — 6 new statics' },
      'https://app.example/portal',
    );
    expect(subject).toBe('Just finished for you');
    expect(body).toContain('Meta creative refresh — 6 new statics');
    expect(body).toContain('https://app.example/portal');
  });

  it('a published update ships its approved text verbatim', () => {
    const { subject, body } = renderInstant(
      'Don Cabello',
      { kind: 'update_published', body: 'This week we finished the pricing page.\n' },
      'https://app.example/portal',
    );
    expect(subject).toBe('An update from us');
    expect(body.startsWith('This week we finished the pricing page.')).toBe(true);
    expect(body).toContain('https://app.example/portal');
  });
});

describe('money formatting for charges', () => {
  it('renders whole amounts without cents and fractional ones with them', async () => {
    const { money } = await import('@/lib/format');
    expect(money(150, 'USD')).toBe('$150');
    expect(money(99.5, 'EUR')).toBe('€99.50');
  });

  it('never throws on an unknown or malformed currency', async () => {
    const { money } = await import('@/lib/format');
    // A well-formed but unknown code renders through Intl (NBSP separator).
    expect(money(1200, 'XYZ').replace(/ /g, ' ')).toBe('XYZ 1,200');
    // A malformed code would make Intl throw — the fallback catches it.
    expect(money(50, '??')).toBe('50 ??');
  });
});
