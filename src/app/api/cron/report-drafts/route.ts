import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { reportDraftsWaiting } from '@/push/triggers';

export const maxDuration = 120;

/** Fri 17:05 PKT — approve ka intezar karti reports. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await reportDraftsWaiting();
  return NextResponse.json({ ok: true, ...result });
}
