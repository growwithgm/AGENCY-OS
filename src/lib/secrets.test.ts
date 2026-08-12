import { describe, expect, it } from 'vitest';
import { extractSecret, secretMatches } from './secrets';

describe('secretMatches', () => {
  it('accepts the right secret', () => {
    expect(secretMatches('correct-horse', 'correct-horse')).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    expect(secretMatches('correct-horse', 'correct-house')).toBe(false);
  });

  it('rejects a prefix, which a short-circuiting compare would leak', () => {
    expect(secretMatches('correct', 'correct-horse')).toBe(false);
  });

  it('rejects missing input without throwing', () => {
    expect(secretMatches(null, 'secret')).toBe(false);
    expect(secretMatches(undefined, 'secret')).toBe(false);
    expect(secretMatches('', 'secret')).toBe(false);
  });
});

describe('extractSecret', () => {
  it('reads the dedicated header first', () => {
    const headers = new Headers({ 'x-cron-secret': 'from-header' });
    expect(extractSecret(headers, 'x-cron-secret')).toBe('from-header');
  });

  it('falls back to a bearer token', () => {
    const headers = new Headers({ authorization: 'Bearer from-bearer' });
    expect(extractSecret(headers, 'x-cron-secret')).toBe('from-bearer');
  });

  it('returns null when neither is present', () => {
    expect(extractSecret(new Headers(), 'x-cron-secret')).toBeNull();
  });
});
