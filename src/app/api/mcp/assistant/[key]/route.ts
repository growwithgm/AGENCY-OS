import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { secretMatches } from '@/lib/secrets';
import { assistantMcpHandler } from '@/mcp/assistantHandler';

export const maxDuration = 120;

/**
 * The same assistant MCP, with the secret as a path segment:
 *
 *   https://<app>/api/mcp/assistant/<MCP_SECRET>
 *
 * This is the form for claude.ai custom connectors: the connector form
 * takes only a URL, and a path segment survives every request the client
 * derives from it, where a query string might not. With the secret in the
 * path, every request authenticates, nothing ever answers 401, and the
 * client never falls back to hunting for an OAuth sign-in service.
 *
 * The URL is the credential. Constant-time comparison, same as the header.
 */
async function guard(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  if (!secretMatches(decodeURIComponent(key ?? ''), env.MCP_SECRET)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return assistantMcpHandler(request);
}

export { guard as GET, guard as POST, guard as DELETE };
