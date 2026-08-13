import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Recovery-link landing (the "Forgot password?" email). Exchanges the code
 * for a session, then continues to the change-password form. Sign-in itself
 * never passes through here any more — that is a plain password check.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/account/password';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  // Only ever continue to our own change-password form.
  const safeNext = next.startsWith('/account') ? next : '/account/password';
  return NextResponse.redirect(`${origin}${safeNext}`);
}
