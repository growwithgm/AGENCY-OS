import { NextResponse } from 'next/server';
import { configStatus } from '@/lib/env';

/**
 * Deployment check.
 *
 * Answers "why is this not working?" without a login, because when
 * configuration is wrong nobody can log in. It reports variable NAMES
 * only — never a value, never a fragment of one — so it is safe to leave
 * reachable.
 */
export async function GET() {
  const config = configStatus();

  return NextResponse.json({
    ok: config.ok,
    missing_required: config.missing,
    features_off: config.degraded,
    operator_signin: 'supabase_password',
    note: config.ok
      ? 'Configured. The operator password is the Supabase Auth user’s password, managed in the Supabase dashboard.'
      : 'Add the missing variables in your host, then redeploy — values added after a build do not reach a running app.',
  }, { status: config.ok ? 200 : 503 });
}
