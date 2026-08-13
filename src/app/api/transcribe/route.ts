import { NextResponse, type NextRequest } from 'next/server';
import { operatorOrNull } from '@/lib/auth';

/**
 * Speech to text for the assistant's microphone.
 *
 * The recording is forwarded to Groq's whisper-large-v3 and the text comes
 * straight back to the input box as ordinary typing — nothing is executed,
 * nothing is stored here. An operator session is required: without it this
 * would be an open transcription endpoint billed to the operator.
 */

/** Roughly ten minutes of Opus. Longer than anyone dictates into a box. */
const MAX_BYTES = 20 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/** Whisper reads the format from the filename, so it has to be plausible. */
function filenameFor(blob: Blob): string {
  const type = (blob.type || '').split(';')[0].trim().toLowerCase();
  return `recording.${EXTENSIONS[type] ?? 'webm'}`;
}

async function readAudio(request: NextRequest): Promise<Blob | null> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return null;
    const value = form.get('audio') ?? form.get('file');
    return value instanceof Blob ? value : null;
  }

  const blob = await request.blob().catch(() => null);
  return blob && blob.size > 0 ? blob : null;
}

export async function POST(request: NextRequest) {
  const session = await operatorOrNull();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = process.env.TRANSCRIPTION_URL;
  const key = process.env.TRANSCRIPTION_KEY;
  if (!url || !key) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const audio = await readAudio(request);
  if (!audio || audio.size === 0) {
    return NextResponse.json({ error: 'no_audio' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'audio_too_large' }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.set('file', audio, filenameFor(audio));
  upstream.set('model', 'whisper-large-v3');
  upstream.set('response_format', 'json');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
    });
  } catch {
    return NextResponse.json({ error: 'transcription_unreachable' }, { status: 502 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'transcription_failed' }, { status: 502 });
  }

  const body = await response.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';

  return NextResponse.json({ text });
}
