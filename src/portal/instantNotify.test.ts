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
