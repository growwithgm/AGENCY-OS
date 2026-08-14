import { describe, it, expect } from 'vitest';
import { COPY, t } from './copy';

/**
 * One language, by decision. These pin the request-flow strings the page
 * depends on, and that t() — kept for old call sites — always answers with
 * the same dictionary no matter what it is passed.
 */
describe('portal copy', () => {
  it('answers every caller with the same English dictionary', () => {
    expect(t()).toBe(COPY);
    expect(t('es')).toBe(COPY);
    expect(t('anything')).toBe(COPY);
  });

  it('keeps every request-flow string present and non-empty', () => {
    for (const [key, value] of Object.entries(COPY.request)) {
      if (key === 'stepOf') continue;
      expect(typeof value, key).toBe('string');
      expect((value as string).length, key).toBeGreaterThan(0);
    }
    expect(COPY.request.stepOf(1, 3)).toBe('1 of 3');
  });

  it('never mentions scheduling in the receipt — a request is not a commitment', () => {
    expect(COPY.request.receivedBody.toLowerCase()).not.toMatch(/scheduled for/);
  });
});
