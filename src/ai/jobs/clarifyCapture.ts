/**
 * clarify_capture — one colleague-shaped question about a capture the
 * parser was not sure of.
 *
 * Fired only when an item's confidence is low and a field is genuinely
 * missing. The question replaces a bare form label, never the operator's
 * decision: priority is excluded by the prompt, and a failure returns
 * null so the plain label simply stays.
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { CLARIFY_CAPTURE_SYSTEM } from '../prompts';
import { aiConfigured } from '@/lib/env';

export async function clarifyCaptureQuestion(input: {
  rawInput: string;
  itemTitle: string;
  field: string;      // 'client' | 'estimate' — never 'priority'
}): Promise<string | null> {
  if (!aiConfigured()) return null;
  if (input.field === 'priority') return null;

  const cfg = jobConfig('clarify_capture');
  try {
    const { result } = await runAI<string>({
      kind: 'clarify_capture',
      model: cfg.model,
      effort: cfg.effort,
      system: CLARIFY_CAPTURE_SYSTEM,
      messages: [{
        role: 'user',
        content:
          `The operator captured: "${input.rawInput.slice(0, 500)}"\n`
          + `The item being structured: "${input.itemTitle.slice(0, 120)}"\n`
          + `Ask about this field only: ${input.field}`,
      }],
      maxTokens: cfg.maxTokens,
    });

    const question = (result ?? '').trim().replace(/^["']|["']$/g, '');
    return question ? question.slice(0, 200) : null;
  } catch {
    return null;
  }
}
