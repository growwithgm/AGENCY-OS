/**
 * clarify_client_request — the portal's intake questions.
 *
 * This is the only job that reads text written by someone outside the
 * agency. That text is always data, never instruction: it is wrapped in
 * delimiters, the system prompt says so explicitly, and forged delimiters
 * are stripped before the call.
 *
 * The fallback is a fixed questionnaire, so a client can still file a
 * request with the provider down (INV-11).
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { CLARIFY_CLIENT_REQUEST_SYSTEM, wrapClientText } from '../prompts';
import { aiConfigured } from '@/lib/env';

export const MAX_QUESTIONS = 3;

/** The fixed questionnaire — also the shape the AI is asked to follow. */
export const FIXED_QUESTIONS = [
  { field: 'outcome', question: 'What would make this finished?', hint: 'So we know when to stop, and you know what you are getting.' },
  { field: 'context', question: 'Which store, campaign or page is this about?', hint: 'A link is perfect if you have one.' },
  { field: 'timing', question: 'Is there a date this needs to be ready by?', hint: 'A real one, if there is one. It is fine if there is not.' },
];

export type IntakeQuestion = {
  field: string;
  question: string;
  hint?: string;
  done: boolean;
  source: 'ai' | 'fallback';
};

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'question', 'done'],
  properties: {
    field: { type: 'string' },
    question: { type: 'string' },
    done: { type: 'boolean' },
  },
} as const;

export function fallbackQuestion(askedCount: number): IntakeQuestion {
  if (askedCount >= MAX_QUESTIONS || askedCount >= FIXED_QUESTIONS.length) {
    return { field: '', question: '', done: true, source: 'fallback' };
  }
  const next = FIXED_QUESTIONS[askedCount];
  return { ...next, done: false, source: 'fallback' };
}

export async function nextIntakeQuestion(input: {
  rawInput: string;
  answers: { role: 'assistant' | 'user'; content: string }[];
  askedCount: number;
  locale: string;
}): Promise<IntakeQuestion> {
  // The question budget is enforced in code — the model cannot talk past it.
  if (input.askedCount >= MAX_QUESTIONS) {
    return { field: '', question: '', done: true, source: 'fallback' };
  }
  if (!aiConfigured()) return fallbackQuestion(input.askedCount);

  const cfg = jobConfig('clarify_client_request');
  try {
    const { result } = await runAI<{ field: string; question: string; done: boolean }>({
      kind: 'clarify_client_request',
      model: cfg.model,
      effort: cfg.effort,
      system: CLARIFY_CLIENT_REQUEST_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Reply in this language code: ${input.locale}.\n`
            + `Questions asked so far: ${input.askedCount} of ${MAX_QUESTIONS}.\n\n`
            + `The client's original request:\n${wrapClientText(input.rawInput)}`,
        },
        ...input.answers.map((entry) => ({
          role: entry.role,
          content: entry.role === 'user' ? wrapClientText(entry.content) : entry.content,
        })),
      ],
      maxTokens: cfg.maxTokens,
      schema,
    });

    if (result.done || !result.question?.trim()) {
      return { field: result.field ?? '', question: '', done: true, source: 'ai' };
    }
    return { field: result.field, question: result.question, done: false, source: 'ai' };
  } catch {
    return fallbackQuestion(input.askedCount);
  }
}
