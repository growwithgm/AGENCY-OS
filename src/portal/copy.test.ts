import { describe, it, expect } from 'vitest';
import { t } from './copy';

/**
 * The two dictionaries must stay the same shape: a key present in English
 * and missing in Spanish is a crash on a Spanish portal, found only by the
 * client who hits it.
 */
describe('portal dictionary', () => {
  const en = t('en');
  const es = t('es');

  it('has identical keys in both languages', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(es.request).sort()).toEqual(Object.keys(en.request).sort());
  });

  it('keeps every request-flow string a string in both languages', () => {
    for (const dict of [en.request, es.request]) {
      for (const [key, value] of Object.entries(dict)) {
        if (key === 'stepOf') continue;
        expect(typeof value, key).toBe('string');
        expect((value as string).length, key).toBeGreaterThan(0);
      }
    }
    expect(en.request.stepOf(1, 3)).toBe('1 of 3');
    expect(es.request.stepOf(1, 3)).toBe('1 de 3');
  });

  it('never mentions scheduling in the receipt — a request is not a commitment', () => {
    for (const dict of [en.request, es.request]) {
      expect(dict.receivedBody.toLowerCase()).not.toMatch(/scheduled for|programado para/);
    }
  });
});
