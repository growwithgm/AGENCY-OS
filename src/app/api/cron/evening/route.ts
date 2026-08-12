import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { eveningCheck } from '@/push/triggers';

export const maxDuration = 120;

/** Roz 18:00 PKT — sirf jab aaj ke tasks adhoore hon. Sab done to khamoshi. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await eveningCheck();
  return NextResponse.json({ ok: true, ...result });
}
