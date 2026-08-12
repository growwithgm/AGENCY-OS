import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { morningBriefing } from '@/push/triggers';

export const maxDuration = 120;

/** Roz 08:30 PKT — aaj ka plan. Halka din ho to kuch nahi jata. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await morningBriefing();
  return NextResponse.json({ ok: true, ...result });
}
