import { NextRequest, NextResponse } from 'next/server';
import { isBotAuthorized } from '@/lib/apiAuth';
import {
  activeSession, answerCapture, cancelCapture, commitCapture, startCapture,
} from '@/capture/session';

export const maxDuration = 60;

/**
 * Capture endpoint for the Discord bot.
 * body: { channel_ref, action: 'message' | 'answer' | 'confirm' | 'cancel', text? }
 * - message: starts a session if none is active on this thread, else feeds
 *   the text into the pending question (free-text answers are allowed).
 */
export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const { channel_ref: channelRef, action, text } = body as {
    channel_ref: string; action: string; text?: string;
  };
  if (!channelRef || !action) {
    return NextResponse.json({ error: 'channel_ref and action required' }, { status: 400 });
  }

  const session = await activeSession(channelRef);

  try {
    if (action === 'cancel') {
      if (!session) return NextResponse.json({ state: 'cancelled', message: 'Koi active capture nahi thi.' });
      return NextResponse.json(await cancelCapture(session.id));
    }
    if (action === 'confirm') {
      if (!session) return NextResponse.json({ error: 'no active session' }, { status: 404 });
      return NextResponse.json(await commitCapture(session.id));
    }
    if (action === 'answer' || (action === 'message' && session)) {
      if (!session) return NextResponse.json({ error: 'no active session' }, { status: 404 });
      return NextResponse.json(await answerCapture(session.id, text ?? ''));
    }
    if (action === 'message') {
      return NextResponse.json(await startCapture('discord', channelRef, text ?? ''));
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
