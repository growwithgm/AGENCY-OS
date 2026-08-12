import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** Save (or refresh) a browser's push subscription. Endpoint is the identity. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  }

  const { error } = await db().from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    active: true,
    failure_count: 0,
  }, { onConflict: 'endpoint' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
