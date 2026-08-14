/**
 * ask_advice — narration over facts the application computed.
 *
 * The model receives the numbers and explains them; it never computes new
 * ones (the prompt forbids it, and every figure is returned alongside the
 * prose so the caller can show the arithmetic next to the opinion).
 * Without a provider there is no prose — the facts stand on their own.
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { ASK_ADVICE_SYSTEM } from '../prompts';
import { aiConfigured } from '@/lib/env';

export async function askAdvice(
  question: string,
  facts: Record<string, unknown>,
): Promise<string | null> {
  if (!aiConfigured()) return null;

  const cfg = jobConfig('ask_advice');
  try {
    const { result } = await runAI<string>({
      kind: 'ask_advice',
      model: cfg.model,
      effort: cfg.effort,
      system: ASK_ADVICE_SYSTEM,
      messages: [{
        role: 'user',
        content:
          `The operator asks: ${question.slice(0, 500)}\n\n`
          + `The computed facts:\n${JSON.stringify(facts, null, 2).slice(0, 6000)}`,
      }],
      maxTokens: cfg.maxTokens,
    });
    const text = (result ?? '').trim();
    return text || null;
  } catch {
    return null;
  }
}
