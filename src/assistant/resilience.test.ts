import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The assistant must never take a page down.
 *
 * The report caught a 500 on an older build. These lock in the two guards
 * that prevent it now: the tool loop degrades to a plain answer when the
 * provider is unreachable, and a single throwing tool becomes a refusal
 * rather than an exception that aborts the whole turn.
 */

const ORIGINAL_KEY = process.env.MOONSHOT_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.MOONSHOT_API_KEY;
  else process.env.MOONSHOT_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('assistant resilience', () => {
  beforeEach(() => vi.resetModules());

  it('degrades to a plain turn when the provider is not configured', async () => {
    delete process.env.MOONSHOT_API_KEY;
    const { runAssistant } = await import('./run');

    const turn = await runAssistant([], 'what should I do first?', {
      db: {} as never,
      actor: 'op@example.com',
      now: new Date('2026-08-17T09:00:00Z'),
    });

    expect(turn.degraded).toBe(true);
    expect(turn.answer).toMatch(/offline/i);
    expect(turn.steps).toHaveLength(0);
    expect(turn.proposals).toHaveLength(0);
  });

  it('turns a throwing tool into a refusal, not an exception', async () => {
    const { runTool } = await import('./tools');

    // canIDoThisNow reads the plan; a db whose query() explodes stands in
    // for a connection lost mid-turn.
    const explodingDb = {
      from() { throw new Error('connection reset'); },
      rpc() { throw new Error('connection reset'); },
    };

    const result = await runTool('can_i_do_this_now', { work_id: 'x' }, {
      db: explodingDb as never,
      actor: 'op@example.com',
      now: new Date('2026-08-17T09:00:00Z'),
    });

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('refused');
  });

  it('still refuses a fenced tool name even when everything else is failing', async () => {
    const { runTool } = await import('./tools');
    const result = await runTool('set_priority', { work_id: 'x', priority: 1 }, {
      db: {} as never,
      actor: 'op@example.com',
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('refused');
  });
});
