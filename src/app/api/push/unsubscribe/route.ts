import { NextResponse, type NextRequest } from 'next/server';
import { operatorOrNull } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Remove a device. Only the operator's own subscriptions can be deleted. */
export async function POST(request: NextRequest) {
  const session = await operatorOrNull();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', session.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
