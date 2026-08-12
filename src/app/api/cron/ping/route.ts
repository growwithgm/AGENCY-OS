import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';

export const maxDuration = 10;

/**
 * Does nothing except prove the secret is right. Use it to verify a new
 * cron-job.org job before pointing it at a route that actually does work.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized — x-cron-secret ghalat ya missing hai' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
