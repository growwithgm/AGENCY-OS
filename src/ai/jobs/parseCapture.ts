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
import type { WorkMode } from '@/data/types';

export const parseCaptureSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // Strict mode forbids any field not listed here, so mode,
        // client_title and confidence must appear — without them the model
        // physically cannot return a mode, and every capture came back
        // 'operational' no matter what the work was.
        required: [
          'title', 'client_id', 'client_hint', 'est_minutes', 'internal_target',
          'work_type', 'detail', 'mode', 'client_title', 'confidence',
        ],
        properties: {
          title: { type: 'string' },
          client_id: { type: ['string', 'null'] },
          client_hint: { type: ['string', 'null'] },
          est_minutes: { type: ['integer', 'null'] },
          internal_target: { type: ['string', 'null'] },
          work_type: { type: ['string', 'null'] },
          detail: { type: ['string', 'null'] },
          mode: { type: 'string', enum: ['creative', 'technical', 'analytical', 'operational'] },
          client_title: { type: ['string', 'null'] },
          confidence: { type: ['number', 'null'] },
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
  mode: WorkMode;
  client_title: string | null;
  confidence: number;
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

  const title = rawInput.length > 80 ? `${rawInput.slice(0, 77)}…` : rawInput;
  const items: DraftItem[] = [{
    title,
    clientId: matched?.id ?? null,
    clientHint: null,
    estMinutes: null,
    priority: null,
    internalTarget: null,
    workType: null,
    detail: rawInput,
    // Without a model there is nothing to judge the mode from, so the
    // cheapest-to-correct answer is the one the operator sees and changes.
    mode: 'operational',
    clientTitle: title,
    clientVisible: true,
    isInternal: false,
    confidence: null,
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
      schema: parseCaptureSchema,
    });

    const known = new Set(clients.map((c) => c.id));
    const MODES = new Set<WorkMode>(['creative', 'technical', 'analytical', 'operational']);
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
      // The schema enum makes this one of the four, but a malformed response
      // should still land somewhere sensible rather than an invalid mode.
      mode: item.mode && MODES.has(item.mode) ? item.mode : 'operational',
      clientTitle: item.client_title ?? item.title,
      clientVisible: true,
      isInternal: false,
      confidence: typeof item.confidence === 'number' ? item.confidence : null,
    }));

    if (items.length === 0) return fallbackParse(rawInput, clients);
    return { items, missingFields: missingFor(items), source: 'ai' };
  } catch {
    // Provider down or malformed output: the operator still captures.
    return fallbackParse(rawInput, clients);
  }
}
