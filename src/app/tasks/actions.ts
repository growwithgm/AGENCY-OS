'use server';

// Server actions for the web task CRUD — the fallback surface when Claude
// isn't at hand. Same operations module as the MCP tools, so behaviour
// (including the schedule rebuild after every write) can't drift.

import { revalidatePath } from 'next/cache';
import {
  addBlackout, blockTask, completeTask, createTask, updateTask,
} from '@/tasks/operations';

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

function num(form: FormData, key: string): number | undefined {
  const s = str(form, key);
  return s === undefined ? undefined : Number(s);
}

export async function createTaskAction(form: FormData) {
  const clientId = str(form, 'client_id');
  const title = str(form, 'title');
  const priority = num(form, 'priority');
  if (!clientId || !title || !priority) throw new Error('client, title aur priority zaroori hain');

  const due = str(form, 'due_at');
  await createTask({
    clientId,
    title,
    priority,
    description: str(form, 'description') ?? null,
    estMinutes: num(form, 'est_minutes') ?? null,
    dueAt: due ? new Date(due).toISOString() : null,
    clientVisible: form.get('client_visible') === 'on',
    source: 'web',
  });

  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function updateTaskAction(form: FormData) {
  const taskId = str(form, 'task_id');
  if (!taskId) throw new Error('task_id chahiye');

  const due = str(form, 'due_at');
  await updateTask(taskId, {
    title: str(form, 'title'),
    client_title: str(form, 'client_title') ?? null,
    description: str(form, 'description') ?? null,
    priority: num(form, 'priority'),
    est_minutes: num(form, 'est_minutes'),
    due_at: due ? new Date(due).toISOString() : null,
    client_visible: form.get('client_visible') === 'on',
    needs_review: form.get('needs_review') === 'on',
    status: str(form, 'status') as 'backlog' | 'scheduled' | 'in_progress' | 'blocked' | 'review' | undefined,
  });

  revalidatePath('/tasks');
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/');
}

export async function completeTaskAction(form: FormData) {
  const taskId = str(form, 'task_id');
  if (!taskId) throw new Error('task_id chahiye');
  await completeTask(taskId, num(form, 'actual_minutes'));
  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function blockTaskAction(form: FormData) {
  const taskId = str(form, 'task_id');
  const reason = str(form, 'reason');
  if (!taskId || !reason) throw new Error('task_id aur reason chahiye');
  await blockTask(taskId, reason);
  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function addBlackoutAction(form: FormData) {
  const starts = str(form, 'starts_at');
  const ends = str(form, 'ends_at');
  if (!starts || !ends) throw new Error('starts_at aur ends_at chahiye');
  await addBlackout(new Date(starts).toISOString(), new Date(ends).toISOString(), str(form, 'reason'));
  revalidatePath('/tasks');
  revalidatePath('/');
}
