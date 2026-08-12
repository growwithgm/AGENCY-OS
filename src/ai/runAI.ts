import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

// Kimi is OpenAI-compatible — standard SDK, different base URL (spec §8.1).
// This wrapper is the ONLY place the provider appears (invariant 5).
let kimi: OpenAI | null = null;
function client(): OpenAI {
  if (!kimi) {
    kimi = new OpenAI({
      apiKey: env.MOONSHOT_API_KEY,
      baseURL: 'https://api.moonshot.ai/v1',
    });
  }
  return kimi;
}

export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

export type AIModel = 'kimi-k3' | 'kimi-k2.5';
export type AIEffort = 'low' | 'high' | 'max';

async function logRun(row: {
  kind: string;
  model: string;
  usage?: OpenAI.CompletionUsage;
  ms: number;
  ok: boolean;
  error?: string;
}) {
  // Reasoning tokens are billed as output tokens — usage must be logged
  // as returned, or cost estimates will be wrong (spec §8.2, §8.5).
  await supabaseAdmin().from('ai_runs').insert({
    kind: row.kind,
    model: row.model,
    input_tokens: row.usage?.prompt_tokens ?? null,
    output_tokens: row.usage?.completion_tokens ?? null,
    latency_ms: row.ms,
    ok: row.ok,
    error: row.error ?? null,
  });
}

export type RunAIOpts = {
  kind: string;                       // 'parse_task' | 'clarify' | 'weekly_report' | ...
  model: AIModel;
  effort?: AIEffort;                  // k3 only; `max` is never used in this system
  system: string;                     // stable prefix — keep >256 tokens & unchanging for cache hits
  messages: ChatMessage[];            // full session history, assistant messages verbatim
  maxTokens: number;                  // always explicit — provider default is 131,072
  schema?: object;                    // when set → strict JSON via response_format
};

/**
 * Every LLM call in the system goes through here. Direct SDK calls are
 * forbidden (invariant 5). Returns parsed JSON when a schema is given,
 * raw content string otherwise. Only `content` is ever parsed —
 * `reasoning_content` is stored in transcripts but never interpreted.
 */
export async function runAI<T = string>(opts: RunAIOpts): Promise<{ result: T; raw: unknown }> {
  const t0 = Date.now();
  try {
    const res = await client().chat.completions.create({
      model: opts.model,
      ...(opts.model === 'kimi-k3' ? { reasoning_effort: opts.effort ?? 'low' } : {}),
      max_completion_tokens: opts.maxTokens,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      ...(opts.schema && {
        response_format: {
          type: 'json_schema',
          json_schema: { name: opts.kind, strict: true, schema: opts.schema },
        },
      }),
      // temperature / top_p / n / presence_penalty / frequency_penalty are
      // fixed on K3 — sending them is an API error (spec §8.2)
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

    const msg = res.choices[0].message;
    await logRun({ kind: opts.kind, model: opts.model, usage: res.usage, ms: Date.now() - t0, ok: true });

    const result = (opts.schema ? JSON.parse(msg.content ?? '{}') : msg.content) as T;
    // `raw` is the assistant message exactly as returned — multi-turn requires
    // sending it back whole, not a content-only summary (spec §7.6).
    return { result, raw: msg };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await logRun({ kind: opts.kind, model: opts.model, ms: Date.now() - t0, ok: false, error: err });
    throw e;
  }
}
