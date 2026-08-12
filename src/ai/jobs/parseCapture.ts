/**
 * parse_capture — a loose sentence becomes proposed work items.
 *
 * The result is a proposal the operator confirms (INV-4). Priority is never
 * set here (INV-1). If the provider is unavailable the fallback returns the
 * sentence as a single item, so capture never blocks (INV-11).
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { PARSE_CAPTURE_SYSTEM } from '../prompts';
import { aiConfigured } from '@/lib/env';
import { todayKey } from '@/lib/format';
import type { DraftItem } from '@/data/capture';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'client_id', 'client_hint', 'est_minutes', 'internal_target', 'work_type', 'detail'],
        properties: {
          title: { type: 'string' },
          client_id: { type: ['string', 'null'] },
          client_hint: { type: ['string', 'null'] },
          est_minutes: { type: ['integer', 'null'] },
          internal_target: { type: ['string', 'null'] },
          work_type: { type: ['string', 'null'] },
          detail: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

type ParsedItem = {
  title: string;
  client_id: string | null;
  client_hint: string | null;
  est_minutes: number | null;
  internal_target: string | null;
  work_type: string | null;
  detail: string | null;
};

export type ParseResult = {
  items: DraftItem[];
  missingFields: string[];
  source: 'ai' | 'fallback';
};

function missingFor(items: DraftItem[]): string[] {
  const missing = new Set<string>();
  for (const item of items) {
    if (!item.clientId) missing.add('client');
    if (item.estMinutes === null) missing.add('estimate');
    // Priority is always missing by design: the operator supplies it.
    missing.add('priority');
  }
  return [...missing];
}

/** Deterministic fallback: one item, nothing invented. */
export function fallbackParse(rawInput: string, clients: { id: string; name: string }[]): ParseResult {
  const lower = rawInput.toLowerCase();
  const matched = clients.find((c) => lower.includes(c.name.toLowerCase()));

  const items: DraftItem[] = [{
    title: rawInput.length > 80 ? `${rawInput.slice(0, 77)}…` : rawInput,
    clientId: matched?.id ?? null,
    clientHint: matched ? null : null,
    estMinutes: null,
    priority: null,
    internalTarget: null,
    workType: null,
    detail: rawInput,
  }];

  return { items, missingFields: missingFor(items), source: 'fallback' };
}

export async function parseCapture(
  rawInput: string,
  clients: { id: string; name: string }[],
): Promise<ParseResult> {
  if (!aiConfigured()) return fallbackParse(rawInput, clients);

  const cfg = jobConfig('parse_capture');

  try {
    const { result } = await runAI<{ items: ParsedItem[] }>({
      kind: 'parse_capture',
      model: cfg.model,
      effort: cfg.effort,
      system: PARSE_CAPTURE_SYSTEM,
      messages: [{
        role: 'user',
        content:
          `Today is ${todayKey()}.\n`
          + `Known clients (id — name):\n${clients.map((c) => `${c.id} — ${c.name}`).join('\n')}\n\n`
          + `Captured text:\n${rawInput}`,
      }],
      maxTokens: cfg.maxTokens,
      schema,
    });

    const known = new Set(clients.map((c) => c.id));
    const items: DraftItem[] = (result.items ?? []).map((item) => ({
      title: item.title,
      // Never trust an id the model invented.
      clientId: item.client_id && known.has(item.client_id) ? item.client_id : null,
      clientHint: item.client_hint,
      estMinutes: item.est_minutes,
      priority: null,                      // INV-1
      internalTarget: item.internal_target,
      workType: item.work_type,
      detail: item.detail,
    }));

    if (items.length === 0) return fallbackParse(rawInput, clients);
    return { items, missingFields: missingFor(items), source: 'ai' };
  } catch {
    // Provider down or malformed output: the operator still captures.
    return fallbackParse(rawInput, clients);
  }
}
