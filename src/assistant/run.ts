/**
 * The assistant loop.
 *
 * The model proposes; this file executes — but only through the registry's
 * fence, and only tools that exist. Every round is logged. Six rounds is
 * the ceiling: past that it is looping rather than working, and the
 * operator gets what was done so far rather than an unbounded bill.
 *
 * The assistant may never state a number a tool did not return. The system
 * prompt says so; the UI enforces it by rendering facts and diffs from the
 * tool output directly rather than from the prose.
 */

import type { ChatMessage } from '@/ai/runAI';
import { runAITools } from '@/ai/runAI';
import { jobConfig } from '@/ai/jobs.config';
import { ASSISTANT_SYSTEM } from '@/ai/prompts';
import { aiConfigured } from '@/lib/env';
import { logActivity } from '@/data/activity';
import { runTool, toolDefinitions, type ToolContext, type ToolResult } from './tools';
import { isConfirm, CONFIRM_LABELS, CONFIRM_REASONS, type ConfirmTool } from './registry';
import type { Diff } from './diff';

const MAX_ROUNDS = 6;

export type Step = {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
};

export type Proposal = {
  tool: ConfirmTool;
  label: string;
  reason: string;
  args: Record<string, unknown>;
};

export type AssistantTurn = {
  /** The prose. Never the source of a number. */
  answer: string;
  steps: Step[];
  diffs: Diff[];
  /** CONFIRM actions the model asked for. Rendered as panels, never run. */
  proposals: Proposal[];
  /** Where to send the operator, if a tool said so. */
  navigate: string | null;
  /** Undo payloads for what actually changed. */
  undo: { taskId: string; before: Record<string, unknown> }[];
  transcript: ChatMessage[];
  degraded: boolean;
};

/**
 * When a model asks for a fenced action, it is turned into a panel rather
 * than refused outright — the operator still wanted the thing, they just
 * have to be the one who does it.
 */
function proposalFor(name: string, args: Record<string, unknown>): Proposal | null {
  if (!isConfirm(name)) return null;
  return {
    tool: name,
    label: CONFIRM_LABELS[name],
    reason: CONFIRM_REASONS[name],
    args,
  };
}

export async function runAssistant(
  history: ChatMessage[],
  instruction: string,
  ctx: ToolContext,
): Promise<AssistantTurn> {
  const steps: Step[] = [];
  const diffs: Diff[] = [];
  const proposals: Proposal[] = [];
  const undo: AssistantTurn['undo'] = [];
  let navigate: string | null = null;

  const messages: ChatMessage[] = [...history, { role: 'user', content: instruction }];

  if (!aiConfigured()) {
    return {
      answer: 'The assistant is offline. Every action it can take is also in the normal screens.',
      steps: [], diffs: [], proposals: [], navigate: null, undo: [],
      transcript: messages,
      degraded: true,
    };
  }

  const cfg = jobConfig('assistant');

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let turn;
    try {
      turn = await runAITools({
        kind: 'assistant',
        model: cfg.model,
        effort: cfg.effort,
        system: ASSISTANT_SYSTEM,
        // The whole assistant message goes back unmodified: Kimi needs it
        // intact on multi-turn, reasoning included.
        messages,
        maxTokens: cfg.maxTokens,
        tools: toolDefinitions(),
      });
    } catch {
      return {
        answer: steps.length
          ? 'I lost the connection partway. What is listed above did happen; nothing after it was attempted.'
          : 'I could not reach the assistant. Everything it does is also in the normal screens.',
        steps, diffs, proposals, navigate, undo,
        transcript: messages,
        degraded: true,
      };
    }

    messages.push(turn.message as ChatMessage);

    if (turn.toolCalls.length === 0) {
      return {
        answer: (turn.message.content ?? '').trim(),
        steps, diffs, proposals, navigate, undo,
        transcript: messages,
        degraded: false,
      };
    }

    for (const call of turn.toolCalls) {
      // A fenced action becomes a panel and stops the run there: the rest
      // of a multi-step instruction is not done silently behind it.
      const proposal = proposalFor(call.name, call.args);
      if (proposal) {
        proposals.push(proposal);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            refused: true,
            reason: proposal.reason,
            note: 'This has been shown to the operator as a panel to confirm. Do not attempt it again; report what you did up to here and that this step is waiting on them.',
          }),
        });
        continue;
      }

      const result = await runTool(call.name, call.args, ctx);
      steps.push({ tool: call.name, args: call.args, result });

      if (result.ok) {
        if (result.diff) diffs.push(result.diff);
        if (result.undo) undo.push(result.undo);
        const data = result.data as { navigate?: string };
        if (data?.navigate) navigate = data.navigate;

        // Only writes are logged; a read is not an operation.
        if (result.undo) {
          await logActivity({
            actor: 'assistant',
            action: `assistant.${call.name}`,
            entityType: 'tasks',
            entityId: result.undo.taskId,
            before: result.undo.before,
            after: result.data,
            instruction,
          });
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    answer: 'I stopped after six rounds rather than keep going. What is listed above is what actually happened.',
    steps, diffs, proposals, navigate, undo,
    transcript: messages,
    degraded: false,
  };
}
