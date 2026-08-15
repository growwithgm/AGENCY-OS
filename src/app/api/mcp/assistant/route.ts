import { createMcpHandler } from 'mcp-handler';
import type { NextRequest } from 'next/server';
import { isMcpAuthorised } from '@/lib/machineAuth';
import { registerAssistantTools } from '@/mcp/assistantTools';
import { registerOperatorTools } from '@/mcp/operatorTools';

export const maxDuration = 120;

/**
 * The second MCP endpoint — the in-app assistant's whole DIRECT toolset,
 * for Claude to connect to (Claude Code, claude.ai, or the API's MCP
 * connector). Authenticated by the shared MCP secret, sent as the
 * `x-mcp-secret` header, an `Authorization: Bearer` token, or — for
 * clients that can only pass a URL — a `?key=` query parameter.
 *
 * The fence travels with it: only DIRECT tools are registered, and the
 * dispatch refuses CONFIRM names structurally. Nothing reachable from here
 * can set a priority, promise a date, approve or decline a request,
 * publish to a client, archive, delete, or change the shape of the day.
 */
const handler = createMcpHandler(
  (server) => {
    registerAssistantTools(server);
    registerOperatorTools(server);
  },
  {
    serverInfo: { name: 'agency-os-assistant', version: '1.1.0' },
    instructions:
      'Agency OS — capacity-aware work management for a solo agency operator. '
      + 'The whole app is here: full sight of the dashboard (work, clients, '
      + 'requests, updates, the plan, settings, the inbox, the weekly review, '
      + 'cron health, AI usage), the everyday operations (create and change '
      + 'work, timers, blackouts, recurrences, report drafts), and — because '
      + 'this connection is authenticated as the operator themselves — the '
      + 'operator decisions too (set_priority, set_committed_date, '
      + 'approve_request, decline_request, publish_update, archive_client, '
      + 'delete_task). Decision tools require confirm: true and may ONLY be '
      + 'called when the operator explicitly asked for that exact action in '
      + 'their own words — never on your own initiative. Never state a number '
      + 'a tool did not return. The one thing not writable from here is the '
      + 'shape of the day (zones, hours) — that changes in Settings only.',
  },
);

function guard(request: NextRequest): Promise<Response> | Response {
  if (!isMcpAuthorised(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return handler(request);
}

export { guard as GET, guard as POST, guard as DELETE };
