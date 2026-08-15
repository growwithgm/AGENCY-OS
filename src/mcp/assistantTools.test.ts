import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAssistantTools } from './assistantTools';
import { DIRECT_TOOLS, CONFIRM_TOOLS } from '@/assistant/registry';

/**
 * The MCP surface is the registry, verbatim. Registration itself is the
 * test of the schema bridge: an unmapped JSON-schema construct throws at
 * register time, so this failing means a new tool schema used vocabulary
 * the bridge does not translate.
 */

function collectRegistrations() {
  const names: string[] = [];
  const fake = {
    registerTool: (name: string) => { names.push(name); },
  } as unknown as McpServer;
  registerAssistantTools(fake);
  return names;
}

describe('the assistant MCP surface', () => {
  it('registers every DIRECT tool — the schema bridge covers them all', () => {
    const registered = new Set(collectRegistrations());
    for (const name of DIRECT_TOOLS) {
      expect(registered.has(name), `${name} missing from the MCP surface`).toBe(true);
    }
  });

  it('registers no CONFIRM tool — the fence travels with the endpoint', () => {
    const registered = new Set(collectRegistrations());
    for (const fenced of CONFIRM_TOOLS) {
      expect(registered.has(fenced), `${fenced} leaked onto the MCP surface`).toBe(false);
    }
  });
});
