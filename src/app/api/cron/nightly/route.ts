import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorised } from '@/lib/machineAuth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { replan } from '@/data/planning';
import { refreshSignals } from '@/data/attention';
import { generateDueOccurrences } from '@/data/recurrence';
import { pruneRateLimitEvents } from '@/lib/rateLimit';

export const maxDuration = 300;

/**
 * Nightly: generate recurring work, re-plan, refresh attention signals,
 * housekeeping. Idempotent — running it twice changes nothing.
 *
 * Cron has no session, so it is the one legitimate service-role caller.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();

  const generated = await generateDueOccurrences(db);
  const planResult = await replan(db);
  const signals = await refreshSignals(db);
  const pruned = await pruneRateLimitEvents();

  return NextResponse.json({
    ok: true,
    recurringGenerated: generated,
    blocks: planResult.blocks.length,
    atRisk: planResult.atRisk.length,
    signals: signals.length,
    rateLimitRowsPruned: pruned,
  });
}
