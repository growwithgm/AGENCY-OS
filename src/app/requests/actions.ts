'use server';

import { revalidatePath } from 'next/cache';
import { approveRequest, declineRequest } from '@/requests/approve';

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

export async function approveRequestAction(form: FormData) {
  const requestId = str(form, 'request_id');
  const title = str(form, 'title');
  const priority = str(form, 'priority');
  if (!requestId || !title || !priority) {
    throw new Error('title aur priority zaroori hain — priority operator hi chunta hai');
  }

  const due = str(form, 'due_at');
  const est = str(form, 'est_minutes');

  await approveRequest({
    requestId,
    title,
    priority: Number(priority),
    estMinutes: est ? Number(est) : null,
    dueAt: due ? new Date(due).toISOString() : null,
    description: str(form, 'description') ?? null,
    clientTitle: str(form, 'client_title') ?? null,
    clientVisible: form.get('client_visible') === 'on',
    note: str(form, 'note') ?? null,
  });

  revalidatePath('/requests');
  revalidatePath('/');
}

export async function declineRequestAction(form: FormData) {
  const requestId = str(form, 'request_id');
  const note = str(form, 'note');
  if (!requestId) throw new Error('request_id chahiye');
  if (!note) throw new Error('Decline karne ke liye wajah likhna zaroori hai');

  await declineRequest(requestId, note, form.get('show_to_client') === 'on');
  revalidatePath('/requests');
}
