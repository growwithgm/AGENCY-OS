import { createMcpHandler } from 'mcp-handler';
import { registerAssistantTools } from '@/mcp/assistantTools';
import { registerOperatorTools } from '@/mcp/operatorTools';
import { registerFullAccessTools } from '@/mcp/fullAccessTools';

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
    registerFullAccessTools(server);
  },
  {
    serverInfo: { name: 'agency-os-assistant', version: '1.2.0' },
    instructions:
      'Agency OS — capacity-aware work management for a solo agency operator. '
      + 'The whole app is here, A to Z: full sight of the dashboard (work, '
      + 'clients, requests, updates, the plan, settings, the inbox, the '
      + 'weekly review, cron health, AI usage), the everyday operations '
      + '(create and change work, statuses, timers, pushes, blackouts, '
      + 'recurrences, the update editor, the inbox, activity reverts), and — '
      + 'because this connection is authenticated as the operator themselves '
      + '— every operator decision too: priorities, committed dates, '
      + 'approving and declining requests, publishing and correcting '
      + 'updates, charges, portal visibility, the shape of the day (zones, '
      + 'working hours), client management (create/update/archive/delete a '
      + 'client, portal logins — one-time passwords are returned exactly '
      + 'once, relay them verbatim), and even remove_all_data. Decision '
      + 'tools require confirm: true and may ONLY be called when the '
      + 'operator explicitly asked for that exact action in their own words '
      + '— never on your own initiative. Never state a number a tool did '
      + 'not return.',
  },
);
