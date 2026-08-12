// MCP endpoint (Streamable HTTP) — Claude ko Agency OS se jorne ke liye.
// Auth: MCP_SECRET, teen shaklon mein qubool:
//   · Authorization: Bearer <secret>   (Claude Code / Desktop --header)
//   · x-mcp-secret: <secret>
//   · ?key=<secret>                    (claude.ai custom connector URL)
// Secret ke baghair 401 — ye operator-grade surface hai, portal nahi.

import { createMcpHandler } from 'mcp-handler';
import { registerTools } from '@/mcp/tools';

export const maxDuration = 120;

const handler = createMcpHandler(
  (server) => registerTools(server),
  {
    serverInfo: { name: 'agency-os', version: '0.1.0' },
    instructions:
      'Agency OS — single-operator agency ka operations system. ' +
      'Tasks, schedule (deterministic engine), metrics aur client reports yahan se manage hote hain. ' +
      'Reports hamesha draft se shuru hoti hain; approve_report human-approval gate hai — ' +
      'sirf operator ke saaf kehne par chalao. Client-visible cheezein portal par turant dikhti hain.',
  },
);

function authorized(req: Request): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) return false; // unset = surface band
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get('x-mcp-secret') === secret) return true;
  return new URL(req.url).searchParams.get('key') === secret;
}

function withAuth(req: Request): Promise<Response> | Response {
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return handler(req);
}

export { withAuth as GET, withAuth as POST, withAuth as DELETE };
