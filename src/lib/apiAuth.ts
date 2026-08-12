import { NextRequest } from 'next/server';
import { env } from './env';

/**
 * Cron header authentication (spec §13). Accepts x-cron-secret directly,
 * or Vercel Cron's `Authorization: Bearer <CRON_SECRET>` form.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret');
  if (secret && secret === env.CRON_SECRET) return true;
  const auth = req.headers.get('authorization');
  return !!auth && auth === `Bearer ${env.CRON_SECRET}`;
}
