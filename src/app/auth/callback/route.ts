import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { markContactLogin } from '@/lib/authFlow';

/**
 * Magic-link landing. Exchanges the code for a session cookie, then sends
 * the caller to the surface their role belongs to — never to a page they
 * would only bounce off.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const role = (user?.app_metadata as { role?: string } | undefined)?.role;

  if (role === 'owner') return NextResponse.redirect(`${origin}/`);

  if (role === 'client') {
    if (user?.email) await markContactLogin(user.email);
    return NextResponse.redirect(`${origin}/portal`);
  }

  // A session with no usable role: sign it out rather than leaving a
  // half-authenticated cookie behind.
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/login?error=no_access`);
}
