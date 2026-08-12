import { NextResponse, type NextRequest } from 'next/server';
import { operatorOrNull } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Register a device for operator notifications.
 *
 * Requires an operator session: without it, anyone who found this URL could
 * subscribe and receive every attention signal the system produces.
 */
export async function POST(request: NextRequest) {
  const session = await operatorOrNull();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sub = body?.subscription;

  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    user_id: session.user.id,
    active: true,
    failure_count: 0,
  }, { onConflict: 'endpoint' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
