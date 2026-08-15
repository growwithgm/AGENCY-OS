import type { NextRequest } from 'next/server';
import { isMcpAuthorised } from '@/lib/machineAuth';
import { assistantMcpHandler } from '@/mcp/assistantHandler';

export const maxDuration = 120;

/**
 * The assistant MCP — the whole app as tools for Claude. Authenticated by
 * the shared MCP secret: the `x-mcp-secret` header, an `Authorization:
 * Bearer` token, or a `?key=` query parameter. Clients that only take a
 * URL and may drop query strings should use the path form instead:
 * /api/mcp/assistant/<MCP_SECRET> (see [key]/route.ts).
 */
function guard(request: NextRequest): Promise<Response> | Response {
  if (!isMcpAuthorised(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return assistantMcpHandler(request);
}

export { guard as GET, guard as POST, guard as DELETE };
