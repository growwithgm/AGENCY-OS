import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Route protection.
 *
 * Middleware is the first gate, never the only one — every server action and
 * route handler re-checks the session (INV-9). Its real job is to redirect
 * humans somewhere sensible and to refresh the auth cookie.
 */

// Reachable without a session. Machine endpoints authenticate themselves
// with a shared secret; the portal has its own login.
const PUBLIC_PREFIXES = [
  '/login',
  '/portal/login',
  '/auth/callback',
  '/api/cron',
  '/api/mcp',
];

const PORTAL_PREFIX = '/portal';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const { response, role } = await updateSession(request);

  // API callers get a status, not a redirect: sending a fetch() an HTML
  // login page turns an auth failure into a confusing parse error.
  if (pathname.startsWith('/api/')) {
    if (role !== 'owner') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return response;
  }

  const isPortalRoute = pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`);

  if (isPortalRoute) {
    if (role !== 'client') {
      return NextResponse.redirect(new URL('/portal/login', request.url));
    }
    return response;
  }

  // Everything else is operator surface.
  if (role !== 'owner') {
    // A client landing on an operator URL goes to their own home, not to a
    // login screen they can never satisfy.
    const target = role === 'client' ? '/portal' : '/login';
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)',
  ],
};
