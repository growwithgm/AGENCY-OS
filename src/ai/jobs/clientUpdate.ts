/**
 * draft_client_update and estimate_insight.
 *
 * A drafted update is never published by this code (INV-7): it returns
 * prose plus the evidence each sentence was built from, and the operator
 * approves while looking at both. Without a provider, the fallback is a
 * structured list of what actually happened — factual, publishable, and
 * obviously not written by a machine trying to sound warm (INV-11).
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { DRAFT_CLIENT_UPDATE_SYSTEM, ESTIMATE_INSIGHT_SYSTEM } from '../prompts';
import { aiConfigured } from '@/lib/env';
import { shortDate } from '@/lib/format';
import type { UpdateEvidence } from '@/data/updates';

export type UpdateFacts = {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  completed: { task_id: string; title: string; completed_at: string | null }[];
  inProgress: { task_id: string; title: string; committed_date: string | null }[];
  waitingOnClient: { task_id: string; title: string; reason: string | null }[];
  upcoming: { task_id: string; title: string }[];
};

export type UpdateDraft = {
  body: string;
  evidence: UpdateEvidence[];
  source: 'ai' | 'fallback';
};

function evidenceFrom(facts: UpdateFacts): UpdateEvidence[] {
  return [
    ...facts.completed.map((w) => ({
      task_id: w.task_id, title: w.title, status: 'Done',
      detail: w.completed_at ? `Completed ${shortDate(w.completed_at.slice(0, 10))}` : 'Completed',
    })),
    ...facts.inProgress.map((w) => ({
      task_id: w.task_id, title: w.title, status: 'In progress',
      detail: w.committed_date ? `Committed ${shortDate(w.committed_date)}` : 'In progress',
    })),
    ...facts.waitingOnClient.map((w) => ({
      task_id: w.task_id, title: w.title, status: 'Waiting',
      detail: w.reason ?? 'Waiting on the client',
    })),
  ];
}

/** Deterministic update: exactly what the record says, nothing more. */
export function fallbackUpdate(facts: UpdateFacts): string {
  const parts: string[] = [];

  if (facts.completed.length) {
    parts.push(`Completed this period: ${facts.completed.map((w) => w.title).join('; ')}.`);
  }
  if (facts.inProgress.length) {
    parts.push(`Currently in progress: ${facts.inProgress.map((w) => w.title).join('; ')}.`);
  }
  if (facts.waitingOnClient.length) {
    parts.push(
      `Waiting on you: ${facts.waitingOnClient.map((w) => `${w.title}${w.reason ? ` — ${w.reason}` : ''}`).join('; ')}.`,
    );
  }
  if (!parts.length) {
    parts.push('No work was completed or started in this period.');
  }

  return parts.join('\n\n');
}

export async function draftClientUpdate(facts: UpdateFacts): Promise<UpdateDraft> {
  const evidence = evidenceFrom(facts);

  if (!aiConfigured()) {
    return { body: fallbackUpdate(facts), evidence, source: 'fallback' };
  }

  const cfg = jobConfig('draft_client_update');
  try {
    const { result } = await runAI<string>({
      kind: 'draft_client_update',
      model: cfg.model,
      effort: cfg.effort,
      system: DRAFT_CLIENT_UPDATE_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      maxTokens: cfg.maxTokens,
    });
    const body = (result ?? '').trim();
    return body
      ? { body, evidence, source: 'ai' }
      : { body: fallbackUpdate(facts), evidence, source: 'fallback' };
  } catch {
    return { body: fallbackUpdate(facts), evidence, source: 'fallback' };
  }
}

export type InsightGroup = {
  work_type: string;
  samples: number;
  est_avg_minutes: number;
  actual_avg_minutes: number;
  ratio: number;
  sentence: string;
};

export async function estimateInsight(groups: InsightGroup[]): Promise<{ text: string; source: 'ai' | 'fallback' }> {
  // Nothing to narrate is a fact, not a failure (INV-10).
  if (groups.length === 0) {
    return {
      text: 'Not enough completed work with both an estimate and a recorded actual to say anything yet.',
      source: 'fallback',
    };
  }

  const fallback = groups.map((g) => g.sentence).join(' ');
  if (!aiConfigured()) return { text: fallback, source: 'fallback' };

  const cfg = jobConfig('estimate_insight');
  try {
    const { result } = await runAI<string>({
      kind: 'estimate_insight',
      model: cfg.model,
      effort: cfg.effort,
      system: ESTIMATE_INSIGHT_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(groups, null, 2) }],
      maxTokens: cfg.maxTokens,
    });
    return { text: (result ?? '').trim() || fallback, source: 'ai' };
  } catch {
    return { text: fallback, source: 'fallback' };
  }
}
