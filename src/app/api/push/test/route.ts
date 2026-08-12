import { NextResponse } from 'next/server';
import { sendPush } from '@/push/send';

/** Test notification — bypasses the per-type toggles on purpose. */
export async function POST() {
  const result = await sendPush('test', {
    title: 'Agency OS test',
    body: 'Notifications kaam kar rahi hain ✅',
    url: '/settings',
    tag: 'agency-os-test',
  }, { ignoreSettings: true });

  return NextResponse.json(result);
}
