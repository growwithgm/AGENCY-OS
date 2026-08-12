import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/**
 * Refreshes the auth cookie and reports who the caller is.
 * Runs on every protected request so an expired token is renewed before the
 * page tries to use it.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against the auth server — getSession() would trust
  // whatever the cookie claims.
  const { data: { user } } = await supabase.auth.getUser();
  const meta = (user?.app_metadata ?? {}) as { role?: string; client_id?: string };

  return {
    response,
    role: meta.role ?? null,
    email: user?.email?.toLowerCase() ?? null,
    clientId: meta.client_id ?? null,
  };
}
