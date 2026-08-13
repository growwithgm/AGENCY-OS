import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { configStatus } from '@/lib/env';

/**
 * Route protection.
 *
 * Middleware is the first gate, never the only one — every server action
 * and route handler re-checks the session (INV-9). Its real job is to
 * redirect humans somewhere sensible and to refresh the auth cookie.
 *
 * Nothing in here is allowed to throw. Middleware runs before every
 * request, so an uncaught error takes the entire site down with a
 * platform-level message that says nothing about the cause — which is
 * exactly what a missing environment variable used to do here.
 */

const PUBLIC_PREFIXES = [
  '/login',
  '/portal/login',
  '/auth/callback',
  '/api/cron',
  '/api/mcp',
  '/api/health',
];

const PORTAL_PREFIX = '/portal';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The health check answers "why is this not working?", so it has to be
  // reachable precisely when nothing else is.
  if (pathname.startsWith('/api/health')) return NextResponse.next();

  // Configuration is checked next: without Supabase credentials there is
  // no session to read, and every route would fail in a confusing way.
  const config = configStatus();
  if (!config.ok) {
    return notConfigured(request, config.missing);
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  let role: string | null = null;
  let response: NextResponse;

  try {
    const session = await updateSession(request);
    response = session.response;
    role = session.role;
  } catch (error) {
    // Supabase unreachable, a malformed cookie, a bad URL in the config.
    // Say so plainly rather than crashing the edge function.
    return serverProblem(request, error);
  }

  // API callers get a status, not a redirect: sending a fetch() an HTML
  // login page turns an auth failure into a confusing parse error.
  if (pathname.startsWith('/api/')) {
    if (role !== 'owner') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return response;
  }

  // The change-password form is for whichever role the recovery link
  // signed in — it needs a session, not a particular side.
  if (pathname === '/account/password' || pathname.startsWith('/account/password/')) {
    if (role !== 'owner' && role !== 'client') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  const isPortalRoute = pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`);

  if (isPortalRoute) {
    if (role !== 'client') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  // Everything else is operator surface.
  if (role !== 'owner') {
    // A client landing on an operator URL goes to their own home, not to a
    // login screen they can never satisfy.
    return NextResponse.redirect(new URL(role === 'client' ? '/portal' : '/login', request.url));
  }

  return response;
}

/** A deployment that has not been given its credentials yet. */
function notConfigured(request: NextRequest, missing: string[]) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'not_configured', missing },
      { status: 503 },
    );
  }

  const items = missing.map((name) => `<li><code>${name}</code></li>`).join('');

  return new NextResponse(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agency OS — not configured</title>
<style>
  body{margin:0;background:#F1F1EE;color:#15161A;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}
  main{max-width:560px;margin:0 auto;padding:64px 24px}
  h1{font-size:24px;letter-spacing:-.02em;margin:0 0 12px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#E7E7E2;padding:2px 6px;border-radius:4px}
  ul{margin:12px 0 20px;padding-left:22px}
  li{margin:6px 0}
  p{color:#5C5F66}
  .note{border-left:3px solid #B2400B;padding-left:14px;margin-top:24px}
</style></head>
<body><main>
  <h1>Agency OS is not configured yet</h1>
  <p>The deployment is missing these environment variables:</p>
  <ul>${items}</ul>
  <p>Add them in your hosting provider&rsquo;s environment settings — on Vercel that is
     <strong>Project → Settings → Environment Variables</strong> — then
     <strong>redeploy</strong>. Values added after a build do not reach the
     running app until it is rebuilt.</p>
  <div class="note">
    <p>Where each one comes from is in <code>docs/SETUP.md</code>, and
       <code>.env.example</code> lists them all.</p>
  </div>
</main></body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/** Something genuinely went wrong reading the session. */
function serverProblem(request: NextRequest, error: unknown) {
  const detail = error instanceof Error ? error.message : 'unknown error';

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'session_unavailable', detail }, { status: 503 });
  }

  return new NextResponse(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agency OS — temporarily unavailable</title>
<style>
  body{margin:0;background:#F1F1EE;color:#15161A;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}
  main{max-width:560px;margin:0 auto;padding:64px 24px}
  h1{font-size:24px;letter-spacing:-.02em;margin:0 0 12px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#E7E7E2;padding:2px 6px;border-radius:4px;word-break:break-word}
  p{color:#5C5F66}
</style></head>
<body><main>
  <h1>Could not reach the database</h1>
  <p>The app is configured, but reading your session failed. This is usually a wrong
     Supabase URL or key, or Supabase being briefly unavailable.</p>
  <p><code>${detail.replace(/[<>&]/g, '')}</code></p>
</main></body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)',
  ],
};
