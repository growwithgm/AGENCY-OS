import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/apiAuth';
import { staleTasksAlert } from '@/push/triggers';

export const maxDuration = 120;

/** Mon 09:00 PKT — jo tasks 3+ baar shift ho chuke hain. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await staleTasksAlert();
  return NextResponse.json({ ok: true, ...result });
}
