import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { extractSecret, secretMatches } from '@/lib/secrets';

/**
 * Machine callers: cron and MCP. Both compare in constant time — these
 * endpoints are reachable from the internet and `===` leaks how much of a
 * guess was right.
 */

export function isCronAuthorised(request: NextRequest): boolean {
  return secretMatches(extractSecret(request.headers, 'x-cron-secret'), env.CRON_SECRET);
}

export function isMcpAuthorised(request: NextRequest): boolean {
  const fromHeader = extractSecret(request.headers, 'x-mcp-secret');
  if (secretMatches(fromHeader, env.MCP_SECRET)) return true;

  // claude.ai custom connectors can only pass a URL, so a query parameter
  // is accepted as well. Same constant-time comparison.
  const fromQuery = new URL(request.url).searchParams.get('key');
  return secretMatches(fromQuery, env.MCP_SECRET);
}
