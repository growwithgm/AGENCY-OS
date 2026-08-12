import { NextResponse } from 'next/server';
import {
  configStatus,
  operatorPasswordConfigured,
  operatorPasswordTooShort,
  MIN_OPERATOR_PASSWORD_LENGTH,
} from '@/lib/env';

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
    operator_signin: operatorPasswordConfigured() ? 'password' : 'email_link',
    warnings: operatorPasswordTooShort()
      ? [`OPERATOR_PASSWORD is shorter than ${MIN_OPERATOR_PASSWORD_LENGTH} characters and is being ignored — sign-in has fallen back to an emailed link.`]
      : [],
    note: config.ok
      ? 'Configured. If sign-in still fails, check the Supabase redirect URL.'
      : 'Add the missing variables in your host, then redeploy — values added after a build do not reach a running app.',
  }, { status: config.ok ? 200 : 503 });
}
