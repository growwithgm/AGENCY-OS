import { NextRequest, NextResponse } from 'next/server';
import { isBotAuthorized } from '@/lib/apiAuth';
import {
  cmdApprove, cmdBlock, cmdClient, cmdDone, cmdReplan, cmdReport, cmdToday, cmdWeek,
} from '@/commands/handlers';

export const maxDuration = 60;

/** Slash-command endpoint. body: { command, args: string[] } */
export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { command, args = [] } = (await req.json()) as { command: string; args?: string[] };

  try {
    let message: string;
    switch (command) {
      case 'today':   message = await cmdToday(); break;
      case 'week':    message = await cmdWeek(); break;
      case 'done': {
        const last = args[args.length - 1];
        const minutes = /^\d+$/.test(last ?? '') ? Number(last) : undefined;
        const search = (minutes ? args.slice(0, -1) : args).join(' ');
        message = await cmdDone(search, minutes);
        break;
      }
      case 'block':   message = await cmdBlock(args[0] ?? '', args.slice(1).join(' ')); break;
      case 'client':  message = await cmdClient(args[0] ?? ''); break;
      case 'report':  message = await cmdReport(args[0] ?? ''); break;
      case 'approve': message = await cmdApprove(args[0] ?? ''); break;
      case 'replan':  message = await cmdReplan(); break;
      default:
        return NextResponse.json({ error: `unknown command: ${command}` }, { status: 400 });
    }
    return NextResponse.json({ message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
