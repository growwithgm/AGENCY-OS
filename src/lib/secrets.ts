import { timingSafeEqual } from 'crypto';

/**
 * Constant-time secret comparison.
 *
 * `===` on strings returns as soon as two bytes differ, which leaks the
 * length of the matching prefix to anyone who can time the response. These
 * secrets guard cron and MCP, both reachable from the internet.
 */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws on length mismatch, which would itself be a
  // timing signal — compare a fixed-size digest of each instead.
  if (a.length !== b.length) {
    // Still burn a comparison so the failure path costs the same.
    const pad = Buffer.alloc(Math.max(a.length, b.length));
    const aPad = Buffer.alloc(pad.length);
    const bPad = Buffer.alloc(pad.length);
    a.copy(aPad);
    b.copy(bPad);
    timingSafeEqual(aPad, bPad);
    return false;
  }

  return timingSafeEqual(a, b);
}

/** Bearer token or custom header, whichever the caller used. */
export function extractSecret(headers: Headers, headerName: string): string | null {
  const direct = headers.get(headerName);
  if (direct) return direct;

  const auth = headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);

  return null;
}
