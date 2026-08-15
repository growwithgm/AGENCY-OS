import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerFullAccessTools } from './fullAccessTools';

/**
 * The A-to-Z surface: everything the app can do that the earlier MCP
 * files did not cover. Two properties matter:
 *
 *   · every tool registers (nothing silently missing from the endpoint);
 *   · everything that reaches a client, redefines the day, or destroys
 *     data refuses without confirm: true, before touching the database
 *     (there is no env here — a touch would throw, not refuse).
 */

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;

function collect() {
  const handlers = new Map<string, Handler>();
  const fake = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerFullAccessTools(fake);
  return handlers;
}

const DIRECT = [
  'set_status', 'set_requested_date', 'push_work', 'record_overrun',
  'revert_activity', 'edit_update_draft', 'correct_update',
  'update_inbox_item', 'discard_inbox_draft', 'set_notification',
  'set_recurrence_active',
];

const CONFIRM_GATED = [
  'set_charge', 'set_client_visibility', 'reassign_client',
  'ask_request_question', 'confirm_inbox_draft',
  'add_zone', 'update_zone', 'remove_zone', 'set_working_hours',
  'delete_recurrence', 'update_client', 'delete_client',
  'remove_client_login', 'remove_all_data',
];

describe('the full-access MCP surface', () => {
  it('registers every tool', () => {
    const handlers = collect();
    for (const name of [...DIRECT, ...CONFIRM_GATED]) {
      expect(handlers.has(name), `${name} missing`).toBe(true);
    }
  });

  it('every gated tool refuses without confirm: true, before touching the database', async () => {
    const handlers = collect();
    for (const name of CONFIRM_GATED) {
      for (const args of [{}, { confirm: false }]) {
        const result = await handlers.get(name)!(args);
        expect(result.content[0].text, `${name} did not refuse`).toContain('operator decision');
      }
    }
  });

  it('remove_all_data refuses without the exact phrase, even confirmed', async () => {
    const handlers = collect();
    const result = await handlers.get('remove_all_data')!({ confirm: true, phrase: 'yes do it' });
    expect(result.content[0].text).toContain('remove data');
    expect(result.content[0].text).toContain('refused');
  });
});
