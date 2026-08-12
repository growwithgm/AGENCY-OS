/**
 * daily_brief and ask_advice.
 *
 * Both receive facts the application already computed — never a bare
 * instruction to "advise the user". If the provider is unavailable, the
 * brief falls back to the attention signals verbatim, which is what the
 * prose would have been describing anyway (INV-11).
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { ASK_ADVICE_SYSTEM, DAILY_BRIEF_SYSTEM } from '../prompts';
import { aiConfigured } from '@/lib/env';
import { hm } from '@/lib/format';

export type BriefFacts = {
  date: string;
  availableMinutes: number;
  plannedMinutes: number;
  items: { title: string; client: string | null; minutes: number; committed_date: string | null }[];
  willNotFit: { title: string; client: string | null; minutes: number; relevant_date: string | null }[];
  signals: { headline: string; severity: string }[];
  pendingRequests: number;
  draftUpdates: number;
};

export type BriefResult = { text: string; source: 'ai' | 'fallback' };

/** Deterministic brief: the facts, stated in order of importance. */
export function fallbackBrief(facts: BriefFacts): string {
  const lines: string[] = [];
  const over = facts.plannedMinutes - facts.availableMinutes;

  lines.push(
    over > 0
      ? `${hm(facts.plannedMinutes)} planned against ${hm(facts.availableMinutes)} available — ${hm(over)} will not fit.`
      : `${hm(facts.plannedMinutes)} planned of ${hm(facts.availableMinutes)} available.`,
  );

  if (facts.items.length > 0) {
    const first = facts.items[0];
    lines.push(`First up: ${first.title}${first.client ? ` for ${first.client}` : ''} (${hm(first.minutes)}).`);
  }

  for (const risk of facts.willNotFit.slice(0, 3)) {
    lines.push(
      `${risk.title}${risk.client ? ` (${risk.client})` : ''} — ${hm(risk.minutes)} unplaced`
      + `${risk.relevant_date ? `, due ${risk.relevant_date}` : ''}.`,
    );
  }

  for (const signal of facts.signals.slice(0, 4)) lines.push(signal.headline);

  if (facts.pendingRequests > 0) {
    lines.push(`${facts.pendingRequests} client request${facts.pendingRequests === 1 ? '' : 's'} waiting for review.`);
  }
  if (facts.draftUpdates > 0) {
    lines.push(`${facts.draftUpdates} client update${facts.draftUpdates === 1 ? '' : 's'} drafted and waiting for approval.`);
  }

  if (lines.length === 1 && facts.items.length === 0) {
    lines.push('Nothing is planned and nothing needs attention.');
  }

  return lines.join('\n');
}

export async function dailyBrief(facts: BriefFacts): Promise<BriefResult> {
  if (!aiConfigured()) return { text: fallbackBrief(facts), source: 'fallback' };

  const cfg = jobConfig('daily_brief');
  try {
    const { result } = await runAI<string>({
      kind: 'daily_brief',
      model: cfg.model,
      effort: cfg.effort,
      system: DAILY_BRIEF_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      maxTokens: cfg.maxTokens,
    });
    return { text: (result ?? '').trim() || fallbackBrief(facts), source: 'ai' };
  } catch {
    return { text: fallbackBrief(facts), source: 'fallback' };
  }
}

export type AdviceFacts = BriefFacts & {
  clients: {
    name: string;
    open_work: number;
    last_completed: string | null;
    last_published_update: string | null;
    minutes_planned_next_14d: number;
  }[];
  byPriority: { priority: number; label: string; minutes: number }[];
  weekAvailableMinutes: number;
  weekPlannedMinutes: number;
};

export function fallbackAdvice(facts: AdviceFacts, question: string): string {
  const lines = [
    `I cannot reach the language model, so here are the figures behind your question ("${question}") without commentary.`,
    '',
    `This week: ${hm(facts.weekPlannedMinutes)} planned against ${hm(facts.weekAvailableMinutes)} available.`,
  ];

  for (const bucket of facts.byPriority) {
    lines.push(`${bucket.label}: ${hm(bucket.minutes)}`);
  }

  if (facts.willNotFit.length) {
    lines.push('', 'Will not fit:');
    for (const risk of facts.willNotFit) {
      lines.push(`· ${risk.title} — ${hm(risk.minutes)}${risk.relevant_date ? `, due ${risk.relevant_date}` : ''}`);
    }
  }

  lines.push('', 'By client:');
  for (const client of facts.clients) {
    lines.push(
      `· ${client.name}: ${client.open_work} open, ${hm(client.minutes_planned_next_14d)} planned, `
      + `last completion ${client.last_completed?.slice(0, 10) ?? 'none on record'}`,
    );
  }

  return lines.join('\n');
}

export async function askAdvice(facts: AdviceFacts, question: string): Promise<BriefResult> {
  if (!aiConfigured()) return { text: fallbackAdvice(facts, question), source: 'fallback' };

  const cfg = jobConfig('ask_advice');
  try {
    const { result } = await runAI<string>({
      kind: 'ask_advice',
      model: cfg.model,
      effort: cfg.effort,
      system: ASK_ADVICE_SYSTEM,
      messages: [{
        role: 'user',
        content: `Facts:\n${JSON.stringify(facts, null, 2)}\n\nQuestion: ${question}`,
      }],
      maxTokens: cfg.maxTokens,
    });
    return { text: (result ?? '').trim() || fallbackAdvice(facts, question), source: 'ai' };
  } catch {
    return { text: fallbackAdvice(facts, question), source: 'fallback' };
  }
}
