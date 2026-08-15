import { createMcpHandler } from 'mcp-handler';
import { registerAssistantTools } from '@/mcp/assistantTools';
import { registerOperatorTools } from '@/mcp/operatorTools';

/**
 * The one assistant-MCP handler, shared by both routes that expose it:
 * /api/mcp/assistant (secret in header, bearer or ?key=) and
 * /api/mcp/assistant/[key] (secret as a path segment, for clients that
 * only take a URL and may drop query strings — claude.ai connectors).
 */
export const assistantMcpHandler = createMcpHandler(
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
      + 'delete_task) and client management (create_client, '
      + 'create_client_login — which returns the email and one-time '
      + 'password to relay verbatim — reset_client_login, '
      + 'set_login_disabled). Decision tools require confirm: true and may ONLY be '
      + 'called when the operator explicitly asked for that exact action in '
      + 'their own words — never on your own initiative. Never state a number '
      + 'a tool did not return. The one thing not writable from here is the '
      + 'shape of the day (zones, hours) — that changes in Settings only.',
  },
);
