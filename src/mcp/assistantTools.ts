/**
 * The assistant MCP — Agency OS as a set of tools for Claude.
 *
 * Where the first MCP endpoint (`/api/mcp`, "ledger") is read-and-propose,
 * this one exposes the SAME toolset the in-app assistant has: every DIRECT
 * tool from the registry, and nothing else. The fence travels with it —
 * CONFIRM names (priority, committed dates, approving requests, publishing,
 * archiving, deleting, the shape of the day) are never registered here, and
 * `runTool` refuses them structurally even if a client invents the name.
 *
 * The tool list is derived from the registry at startup, so a DIRECT tool
 * added there appears here automatically — one registry, three surfaces
 * (in-app assistant, this MCP, and the registry test that pins them).
 */

import { z, type ZodTypeAny } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DIRECT_TOOLS } from '@/assistant/registry';
import { runTool, TOOL_SCHEMAS, type ToolContext } from '@/assistant/tools';
import { logActivity } from '@/data/activity';

function toolContext(): ToolContext {
  return { db: supabaseAdmin(), actor: 'assistant-mcp', now: new Date() };
}

/**
 * Our tool schemas use a small, known vocabulary of JSON Schema — string
 * (with enum), integer, number, boolean, array-of-string — which maps
 * mechanically onto the zod shape the MCP server wants. Anything outside
 * that vocabulary is a build-time surprise, so it throws rather than being
 * silently accepted as `any`.
 */
type JsonProperty = {
  type?: string;
  enum?: string[];
  description?: string;
  items?: { type?: string };
};

function zodFor(property: JsonProperty): ZodTypeAny {
  let field: ZodTypeAny;

  if (property.enum) {
    field = z.enum(property.enum as [string, ...string[]]);
  } else if (property.type === 'string') {
    field = z.string();
  } else if (property.type === 'integer') {
    field = z.number().int();
  } else if (property.type === 'number') {
    field = z.number();
  } else if (property.type === 'boolean') {
    field = z.boolean();
  } else if (property.type === 'array') {
    field = z.array(property.items?.type === 'string' ? z.string() : z.unknown());
  } else {
    throw new Error(`unmapped schema type: ${property.type}`);
  }

  return property.description ? field.describe(property.description) : field;
}

function inputShapeFor(name: string): Record<string, ZodTypeAny> {
  const parameters = TOOL_SCHEMAS[name].parameters as {
    properties?: Record<string, JsonProperty>;
    required?: string[];
  };
  const required = new Set(parameters.required ?? []);

  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, property] of Object.entries(parameters.properties ?? {})) {
    const field = zodFor(property);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

function text(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

export function registerAssistantTools(server: McpServer): void {
  for (const name of DIRECT_TOOLS) {
    server.registerTool(name, {
      description: TOOL_SCHEMAS[name].description,
      inputSchema: inputShapeFor(name),
    }, async (args: Record<string, unknown>) => {
      try {
        const result = await runTool(name, args ?? {}, toolContext());

        if (!result.ok) {
          // A refusal is a rule, not a failure — the model relays it.
          return text({ refused: result.refused, alternative: result.alternative ?? undefined });
        }

        // Writes land in the same activity log the in-app assistant uses,
        // so "why did this change?" has one answer wherever it came from.
        if (result.undo) {
          await logActivity({
            actor: 'assistant',
            action: `mcp.${name}`,
            entityType: 'tasks',
            entityId: result.undo.taskId,
            before: result.undo.before,
            after: result.data,
            instruction: 'via MCP',
          });
        }

        return text({
          ...(result.data as Record<string, unknown>),
          ...(result.diff ? { diff: result.diff } : {}),
        });
      } catch (e) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${e instanceof Error ? e.message : String(e)}`,
          }],
          isError: true,
        };
      }
    });
  }
}
