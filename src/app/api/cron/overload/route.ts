import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { overloadAlert } from '@/push/triggers';

export const maxDuration = 120;

/** Roz 08:35 PKT — sirf jab overflow ya at-risk ho. Wahi masla dobara ho to khamosh. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await overloadAlert();
  return NextResponse.json({ ok: true, ...result });
}
