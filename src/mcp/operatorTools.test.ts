import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerOperatorTools } from './operatorTools';

/**
 * The operator-decision tools exist ONLY on the MCP endpoint (the caller
 * is the operator's own credential), and even there every decision is
 * gated on an explicit confirm: true. A call without it must refuse
 * before touching anything.
 */

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;

function collect() {
  const handlers = new Map<string, Handler>();
  const fake = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerOperatorTools(fake);
  return handlers;
}

const DECISIONS = [
  'set_priority', 'set_committed_date', 'approve_request', 'decline_request',
  'publish_update', 'archive_client', 'delete_task',
];

describe('the operator MCP surface', () => {
  it('registers every decision tool and the remaining reads', () => {
    const handlers = collect();
    for (const name of [...DECISIONS, 'get_settings', 'list_inbox', 'get_cron_health', 'get_ai_usage']) {
      expect(handlers.has(name), `${name} missing`).toBe(true);
    }
  });

  it('every decision refuses without confirm: true, before touching the database', async () => {
    const handlers = collect();
    for (const name of DECISIONS) {
      // No confirm at all, and an explicit false — both must refuse. If the
      // handler had touched the database it would have thrown (no env here).
      for (const args of [{}, { confirm: false }]) {
        const result = await handlers.get(name)!(args);
        expect(result.content[0].text, `${name} did not refuse`).toContain('operator decision');
      }
    }
  });
});
