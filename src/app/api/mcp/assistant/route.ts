import { createMcpHandler } from 'mcp-handler';
import type { NextRequest } from 'next/server';
import { isMcpAuthorised } from '@/lib/machineAuth';
import { registerAssistantTools } from '@/mcp/assistantTools';

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
  (server) => registerAssistantTools(server),
  {
    serverInfo: { name: 'agency-os-assistant', version: '1.0.0' },
    instructions:
      'Agency OS — capacity-aware work management for a solo agency operator. '
      + 'These are the same tools the in-app assistant has: full sight of the '
      + 'dashboard (work, clients, requests, updates, the plan, the weekly '
      + 'review) and the operator-only operations (create and change work, '
      + 'timers, blackouts, recurrences, report drafts). Never state a number '
      + 'a tool did not return. You cannot set priority, commit to a date, '
      + 'approve or decline a client request, publish, archive or delete — '
      + 'those need the operator\'s own tap in the web app; if asked, say so '
      + 'and do the rest.',
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
