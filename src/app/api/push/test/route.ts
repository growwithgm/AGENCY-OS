import { NextResponse } from 'next/server';
import { operatorOrNull } from '@/lib/auth';
import { sendPush } from '@/push/send';

/** Test notification. Operator only, and it ignores the per-kind toggles. */
export async function POST() {
  const session = await operatorOrNull();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await sendPush('test', {
    title: 'Agency OS',
    body: 'Notifications are working on this device.',
    url: '/settings',
    tag: 'ledger-test',
  }, { ignoreSettings: true });

  return NextResponse.json(result);
}
