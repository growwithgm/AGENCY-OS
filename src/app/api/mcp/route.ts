import { createMcpHandler } from 'mcp-handler';
import type { NextRequest } from 'next/server';
import { isMcpAuthorised } from '@/lib/machineAuth';
import { registerTools } from '@/mcp/tools';

export const maxDuration = 120;

/**
 * MCP endpoint — a machine caller, authenticated by shared secret rather
 * than a session, so it is one of the two legitimate service-role users.
 *
 * The tools it exposes are read-and-propose only: it can see the plan and
 * park a capture in the Inbox, but it cannot confirm work, set a priority,
 * approve a request or publish an update. Those are all decisions
 * (INV-1, INV-3, INV-4, INV-7).
 */
const handler = createMcpHandler(
  (server) => registerTools(server),
  {
    serverInfo: { name: 'ledger', version: '1.0.0' },
    instructions:
      'Agency OS — capacity-aware work management for a solo agency operator. '
      + 'It answers whether promised work fits before its deadlines. '
      + 'You can read the plan and park captures in the Inbox for review. '
      + 'You cannot set priority, confirm work, approve client requests or '
      + 'publish anything to a client: those are the operator\'s decisions '
      + 'and live in the web app only.',
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
