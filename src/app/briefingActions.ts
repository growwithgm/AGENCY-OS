'use server';

import { revalidatePath } from 'next/cache';
import { invalidate, dayKey } from '@/ai/cache';

/** Manual refresh — drops today's cached AI output so the next load regenerates. */
export async function refreshBriefingAction() {
  const key = dayKey();
  await Promise.all([
    invalidate('daily_briefing', key),
    invalidate('overload_advice', key),
  ]);
  revalidatePath('/');
}
