/**
 * Is the assistant actually working right now?
 *
 * Two separate questions are answered here, both from evidence rather than
 * from optimism: whether a model key exists at all, and whether the calls
 * that used it recently succeeded. A key that is set but rejected by the
 * provider looks exactly like a working assistant until someone asks it a
 * question, so the last few runs are read as well.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiConfigured } from '@/lib/env';

export type AiRun = {
  kind: string | null;
  model: string | null;
  ok: boolean | null;
  error: string | null;
  created_at: string;
};

/** Enough runs to see a pattern, few enough to stay a single cheap read. */
const WINDOW = 5;

/** Below this many consecutive failures it is a bad request, not an outage. */
const FAILURES_MEANING_OFFLINE = 3;

export async function recentAiRuns(db: SupabaseClient, limit = WINDOW): Promise<AiRun[]> {
  const { data } = await db.from('ai_runs')
    .select('kind, model, ok, error, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as AiRun[];
}

/**
 * False when there is no key, or when every one of the last three runs
 * failed. Anything less than three runs is not yet a pattern, so the
 * assistant is given the benefit of the doubt.
 */
export async function aiHealthy(db: SupabaseClient): Promise<boolean> {
  if (!aiConfigured()) return false;

  const runs = await recentAiRuns(db, WINDOW);
  if (runs.length < FAILURES_MEANING_OFFLINE) return true;

  return !runs.slice(0, FAILURES_MEANING_OFFLINE).every((run) => run.ok === false);
}

/**
 * Whether the microphone can work at all. It lives beside AI health because
 * it answers the same kind of question — what this screen may offer today —
 * and the answer is only ever read on the server.
 */
export function transcriptionConfigured(): boolean {
  return Boolean(process.env.TRANSCRIPTION_URL && process.env.TRANSCRIPTION_KEY);
}
