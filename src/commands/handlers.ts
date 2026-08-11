// Operator command handlers (spec §9). Return plain text blocks that the
// Discord bot relays. All reads/writes go through the service-role client —
// commands only arrive via the authenticated bot.

import { db } from '@/lib/db';
import { rebuildSchedule } from '@/scheduler/rebuild';
import { enqueue, drainJobs } from '@/jobs/worker';
import { approveReport, deliverReport } from '@/reporting/deliver';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

export async function cmdToday(now = new Date()): Promise<string> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const { data: blocks } = await db()
    .from('schedule_blocks')
    .select('starts_at, ends_at, is_locked, tasks(title, status, clients(name))')
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at', dayEnd.toISOString())
    .order('starts_at');

  if (!blocks?.length) return 'Aaj ke liye koi block scheduled nahi.';

  const lines = blocks.map((b) => {
    const t = b.tasks as unknown as { title: string; status: string; clients: { name: string } | null };
    const lock = b.is_locked ? ' 🔒' : '';
    return `${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)}  ${t.clients?.name ?? '—'} · ${t.title}${lock}`;
  });

  const overflowNote = await overflowSummary();
  return `**Aaj ka plan**\n${lines.join('\n')}${overflowNote}`;
}

export async function cmdWeek(now = new Date()): Promise<string> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(dayStart.getTime() + 7 * 86400000);
  const { data: blocks } = await db()
    .from('schedule_blocks')
    .select('starts_at, ends_at, tasks(title, clients(name))')
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at', weekEnd.toISOString())
    .order('starts_at');

  const byDay = new Map<string, string[]>();
  for (const b of blocks ?? []) {
    const t = b.tasks as unknown as { title: string; clients: { name: string } | null };
    const day = new Date(b.starts_at).toDateString();
    byDay.set(day, [
      ...(byDay.get(day) ?? []),
      `  ${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)}  ${t.clients?.name ?? '—'} · ${t.title}`,
    ]);
  }

  const lines = [...byDay.entries()].map(([day, items]) => `**${day}**\n${items.join('\n')}`);
  const overflowNote = await overflowSummary();
  return `${lines.join('\n') || 'Hafte mein kuch scheduled nahi.'}${overflowNote}`;
}

/**
 * Overflow is never hidden (invariant 7): open tasks with no scheduled block
 * inside the horizon are surfaced with total hours and due dates.
 */
async function overflowSummary(): Promise<string> {
  const { data: open } = await db()
    .from('tasks')
    .select('id, title, est_minutes, due_at, clients(name)')
    .in('status', ['backlog', 'scheduled', 'in_progress']);
  if (!open?.length) return '';

  const { data: futureBlocks } = await db()
    .from('schedule_blocks')
    .select('task_id')
    .gte('starts_at', new Date().toISOString());
  const scheduled = new Set((futureBlocks ?? []).map((b) => b.task_id));

  const overflow = open.filter((t) => !scheduled.has(t.id));
  if (!overflow.length) return '';

  const totalMin = overflow.reduce((s, t) => s + (t.est_minutes ?? 60), 0);
  const items = overflow.map((t) => {
    const c = t.clients as unknown as { name: string } | null;
    const due = t.due_at ? `, due ${new Date(t.due_at).toLocaleDateString('en-GB', { weekday: 'short' })}` : '';
    return `   · ${c?.name ?? '—'} — ${t.title} (${fmtHours(t.est_minutes ?? 60)}${due})`;
  });
  return `\n\n⚠️ **${fmtHours(totalMin)} ka kaam fit nahi hua.** Ye ${overflow.length} task(s) horizon se bahar hain:\n${items.join('\n')}`;
}

export async function cmdDone(search: string, actualMinutes?: number): Promise<string> {
  const { data: task } = await db()
    .from('tasks')
    .select('id, title')
    .neq('status', 'done')
    .ilike('title', `%${search}%`)
    .limit(1)
    .maybeSingle();
  if (!task) return `"${search}" se koi open task nahi mila.`;

  await db().from('tasks').update({
    status: 'done',
    completed_at: new Date().toISOString(),
    ...(actualMinutes ? { actual_minutes: actualMinutes } : {}),
  }).eq('id', task.id);

  await rebuildSchedule();
  return actualMinutes
    ? `✅ **${task.title}** done (${actualMinutes} min). Schedule update ho gaya.`
    : `✅ **${task.title}** done. Kitne minute lage? \`/done ${search} <minutes>\` se actual time record hoga — estimates isi se behtar hote hain.`;
}

export async function cmdBlock(search: string, reason: string): Promise<string> {
  const { data: task } = await db()
    .from('tasks')
    .select('id, title')
    .neq('status', 'done')
    .ilike('title', `%${search}%`)
    .limit(1)
    .maybeSingle();
  if (!task) return `"${search}" se koi open task nahi mila.`;

  await db().from('tasks').update({ status: 'blocked', blocked_reason: reason }).eq('id', task.id);
  await rebuildSchedule();
  return `⛔ **${task.title}** blocked: ${reason}\nYe client ke agle update mein khud aa jayega.`;
}

export async function cmdClient(slug: string): Promise<string> {
  const { data: client } = await db()
    .from('clients')
    .select('id, name, retainer_hours')
    .eq('brand_slug', slug)
    .maybeSingle();
  if (!client) return `Client "${slug}" nahi mila.`;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: open }, { data: doneTasks }, { data: lastReport }] = await Promise.all([
    db().from('tasks').select('title, status, due_at').eq('client_id', client.id).neq('status', 'done'),
    db().from('tasks').select('actual_minutes').eq('client_id', client.id)
      .eq('status', 'done').gte('completed_at', monthStart.toISOString()),
    db().from('reports').select('kind, period_end, status').eq('client_id', client.id)
      .order('period_end', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const usedMin = (doneTasks ?? []).reduce((s, t) => s + (t.actual_minutes ?? 0), 0);
  const retainer = client.retainer_hours
    ? `Retainer: ${fmtHours(usedMin)} / ${client.retainer_hours}h is mahine`
    : `Is mahine ${fmtHours(usedMin)} kaam hua`;

  const tasks = (open ?? []).map((t) =>
    `  · [${t.status}] ${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : ''}`,
  ).join('\n') || '  koi open task nahi';

  const report = lastReport
    ? `Last report: ${lastReport.kind} tak ${lastReport.period_end} (${lastReport.status})`
    : 'Abhi koi report nahi bani';

  return `**${client.name}**\n${retainer}\n${report}\n\nOpen tasks:\n${tasks}`;
}

export async function cmdReport(slug: string): Promise<string> {
  const { data: client } = await db()
    .from('clients').select('id, name').eq('brand_slug', slug).maybeSingle();
  if (!client) return `Client "${slug}" nahi mila.`;

  await enqueue('weekly_report', { client_id: client.id });
  await drainJobs(1); // run it now; queue keeps it durable if this times out

  const { data: draft } = await db()
    .from('reports')
    .select('id, narrative_md')
    .eq('client_id', client.id)
    .eq('status', 'draft')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draft) return `${client.name} ka draft ban raha hai — thori der mein check karein.`;
  return `**Draft ${draft.id}** (${client.name}) — approve karne ke liye \`/approve ${draft.id}\`\n\n${draft.narrative_md}`;
}

export async function cmdApprove(reportId: string): Promise<string> {
  await approveReport(reportId);

  const { data: report } = await db()
    .from('reports')
    .select('client_id, clients(name, contact_email, contact_wa)')
    .eq('id', reportId)
    .single();
  const client = report?.clients as unknown as { name: string; contact_email: string | null; contact_wa: string | null };

  const delivered: string[] = ['portal'];
  if (client?.contact_email) {
    try { await deliverReport(reportId, 'email'); delivered.push('email'); }
    catch (e) { delivered.push(`email FAILED: ${e instanceof Error ? e.message : e}`); }
  }
  if (client?.contact_wa) {
    try { await deliverReport(reportId, 'whatsapp'); delivered.push('whatsapp'); }
    catch (e) { delivered.push(`whatsapp FAILED: ${e instanceof Error ? e.message : e}`); }
  }
  return `✅ Report approved (${client?.name ?? '?'}). Delivery: ${delivered.join(', ')}.`;
}

export async function cmdReplan(): Promise<string> {
  const result = await rebuildSchedule();
  const overflowNote = result.overflow.length
    ? `\n⚠️ ${result.overflow.length} task(s) fit nahi hue.`
    : '';
  const cycleNote = result.cycles.length
    ? `\n🔄 Dependency cycle mila — ye tasks manually check karein: ${result.cycles.flat().join(', ')}`
    : '';
  return `Schedule rebuild ho gaya: ${result.blocks.length} blocks.${overflowNote}${cycleNote}`;
}
