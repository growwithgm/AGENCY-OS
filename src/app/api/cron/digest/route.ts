import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorised } from '@/lib/machineAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { collectDigests, sendDigest, emailConfigured } from '@/portal/digest';
import { env } from '@/lib/env';

export const maxDuration = 120;

/**
 * Friday: one email per client that asked for a weekly digest.
 *
 * A client with nothing to report gets nothing. Silence is a truthful
 * weekly update; a mail saying "no progress this week" is worse than none.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!emailConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: 'email is not configured, so no digests were sent',
    });
  }

  const digests = await collectDigests(supabaseAdmin());
  const outcomes: Record<string, number> = {};

  for (const digest of digests) {
    const result = await sendDigest(digest, `${env.APP_URL}/portal`);
    outcomes[result] = (outcomes[result] ?? 0) + 1;
  }

  return NextResponse.json({ ok: true, clients: digests.length, ...outcomes });
}
