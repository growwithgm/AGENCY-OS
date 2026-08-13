import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorised } from '@/lib/machineAuth';
import { flushQueue } from '@/push/queue';

/**
 * Deliver whatever has been waiting for a window that has now opened.
 *
 * Safe to call at any interval: it acts only on rows whose time has come,
 * and re-checks the peak blackout before sending, so a notification held
 * at 09:00 does not land in a peak that has since been moved.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await flushQueue();
  return NextResponse.json({ ok: true, ...result });
}
