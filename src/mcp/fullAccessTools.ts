/**
 * The rest of the app, as MCP tools — everything a screen can do that
 * operatorTools.ts and the assistant's DIRECT set did not already cover.
 *
 * The rule is A to Z: any operation the operator can perform by opening
 * the app must be performable over MCP. Same fences as everywhere else:
 * anything that reaches a client, redefines the day, or destroys data is
 * confirm-gated (the operator must have asked in their own words);
 * internal-only changes run directly. Every write goes through the same
 * data-layer operations the UI uses, so it is audited identically.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getWork, updateWork, pushWork, recordOverrunReason } from '@/data/work';
import { returnForInfo } from '@/data/requests';
import { editDraft, correctUpdate, getUpdate } from '@/data/updates';
import {
  getDraft, updateDraftItems, confirmDraft, discardDraft, type DraftItem,
} from '@/data/capture';
import { setRecurrenceActive } from '@/data/recurrence';
import { listClients } from '@/data/clients';
import { revertEntry } from '@/data/activity';
import { replan } from '@/data/planning';
import { refreshSignals } from '@/data/attention';
import { deleteLogin } from '@/lib/authFlow';
import { recordAudit } from '@/lib/audit';
import { logActivity } from '@/data/activity';
import { CHARGE_CURRENCIES, type WorkMode, type WorkStatus } from '@/data/types';
import { MODES } from '@/engines/planner/types';
import { OVERRUN_REASONS, type OverrunReason } from '@/engines/estimates/referenceClass';
import {
  CONFIRM_NOTE, PRIORITY_WORDS, guarded, notConfirmed, text,
} from '@/mcp/operatorTools';

const MODE_ENUM = z.enum(MODES as unknown as [string, ...string[]]);
const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkTime(value: string, label: string): string {
  if (!TIME.test(value)) throw new Error(`${label} must be HH:MM (24h)`);
  return value;
}

function checkDate(value: string | null, label: string): string | null {
  if (value !== null && !DATE.test(value)) throw new Error(`${label} must be YYYY-MM-DD or null`);
  return value;
}

async function resolveClient(db: ReturnType<typeof supabaseAdmin>, name: string) {
  const clients = await listClients(db);
  const needle = name.toLowerCase();
  const match = clients.find((c) => c.name.toLowerCase() === needle)
    ?? clients.find((c) => c.name.toLowerCase().includes(needle));
  if (!match) throw new Error(`no client matches "${name}"`);
  return match;
}

export function registerFullAccessTools(server: McpServer): void {
  const db = () => supabaseAdmin();
  const actor = 'operator-via-mcp';

  /* ── Work detail — internal fields, no confirm needed ─────────────── */

  server.registerTool('set_status', {
    description: 'Set a work item\'s status (backlog, scheduled, in_progress, blocked, waiting_on_client, review). Use complete_task for done — that records effort properly.',
    inputSchema: {
      work_id: z.string(),
      status: z.enum(['backlog', 'scheduled', 'in_progress', 'blocked', 'waiting_on_client', 'review']),
      blocked_reason: z.string().optional().describe('Only with status blocked or waiting_on_client'),
    },
  }, async ({ work_id, status, blocked_reason }) => guarded(async () => {
    const before = await getWork(db(), work_id);
    if (!before) throw new Error('work item not found');

    const sideState = status === 'blocked' || status === 'waiting_on_client';
    await updateWork(db(), work_id, {
      status: status as WorkStatus,
      blockedReason: sideState ? (blocked_reason ?? null) : null,
    }, actor);

    await logActivity({
      actor: 'operator',
      action: 'work.status_changed',
      entityType: 'tasks',
      entityId: work_id,
      before: { status: before.status },
      after: { status },
    });

    await refreshSignals(db());
    return { updated: before.title, status };
  }));

  server.registerTool('set_requested_date', {
    description: 'Record what the client asked for. Recording it never turns it into a promise — that is set_committed_date. Pass null to clear.',
    inputSchema: {
      work_id: z.string(),
      date: z.string().nullable().describe('YYYY-MM-DD or null'),
    },
  }, async ({ work_id, date }) => guarded(async () => {
    checkDate(date, 'date');
    const before = await getWork(db(), work_id);
    if (!before) throw new Error('work item not found');
    await updateWork(db(), work_id, { clientRequestedDate: date }, actor);
    await refreshSignals(db());
    return { updated: before.title, client_requested_date: date };
  }));

  server.registerTool('push_work', {
    description: 'Push work to a later day — moves the internal plan, never the commitment. Pass several ids to push a batch.',
    inputSchema: {
      work_ids: z.array(z.string()).min(1),
    },
  }, async ({ work_ids }) => guarded(async () => {
    const pushed: string[] = [];
    for (const id of work_ids) {
      const before = await getWork(db(), id);
      if (!before) throw new Error(`work item ${id} not found`);
      await pushWork(db(), id, actor);
      pushed.push(before.title);
    }
    await refreshSignals(db());
    return { pushed };
  }));

  server.registerTool('record_overrun', {
    description: 'Record why a job ran over its estimate — evidence the weekly review learns from. Only record a reason the operator actually gave; never invent one.',
    inputSchema: {
      work_id: z.string(),
      reason: z.enum(OVERRUN_REASONS.map(([key]) => key) as [string, ...string[]]),
      overrun_minutes: z.number().int().min(0),
    },
  }, async ({ work_id, reason, overrun_minutes }) => guarded(async () => {
    await recordOverrunReason(db(), work_id, reason as OverrunReason, Math.round(overrun_minutes));
    return { recorded: reason, overrun_minutes };
  }));

  server.registerTool('revert_activity', {
    description: 'Undo an entry from the activity log (within its 24-hour window): puts the recorded before-state back through the normal operations layer. Find entries with list_activity.',
    inputSchema: {
      entry_id: z.string(),
    },
  }, async ({ entry_id }) => guarded(async () => {
    const result = await revertEntry(db(), entry_id, actor);
    await refreshSignals(db());
    return { reverted: result.action, work_id: result.entityId };
  }));

  /* ── Work detail — client-facing fields, confirm-gated ────────────── */

  server.registerTool('set_charge', {
    description: `Set what the client pays for a work item, shown on their portal while the item is visible there. Pass amount null to clear it. ${CONFIRM_NOTE}`,
    inputSchema: {
      work_id: z.string(),
      amount: z.number().min(0).nullable().describe('null or 0 clears the charge'),
      currency: z.enum(CHARGE_CURRENCIES as unknown as [string, ...string[]]).optional(),
      confirm: z.boolean(),
    },
  }, async ({ work_id, amount, currency, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const before = await getWork(db(), work_id);
      if (!before) throw new Error('work item not found');
      const cleaned = amount !== null && amount > 0 ? Math.round(amount * 100) / 100 : null;
      await updateWork(db(), work_id, {
        chargeAmount: cleaned,
        chargeCurrency: currency ?? 'USD',
      }, actor);
      return { updated: before.title, charge_amount: cleaned, charge_currency: cleaned ? (currency ?? 'USD') : null };
    });
  });

  server.registerTool('set_client_visibility', {
    description: `Show or hide a work item on the client's portal. ${CONFIRM_NOTE}`,
    inputSchema: {
      work_id: z.string(),
      visible: z.boolean(),
      confirm: z.boolean(),
    },
  }, async ({ work_id, visible, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const before = await getWork(db(), work_id);
      if (!before) throw new Error('work item not found');
      await updateWork(db(), work_id, { clientVisible: visible }, actor);
      return { updated: before.title, client_visible: visible };
    });
  });

  server.registerTool('reassign_client', {
    description: `Move a work item to a different client. If it was visible it disappears from one portal and appears on another. ${CONFIRM_NOTE}`,
    inputSchema: {
      work_id: z.string(),
      client: z.string().describe('The new client, matched by name'),
      confirm: z.boolean(),
    },
  }, async ({ work_id, client: clientName, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const before = await getWork(db(), work_id);
      if (!before) throw new Error('work item not found');
      const target = await resolveClient(db(), clientName);
      if (before.client_id === target.id) return { unchanged: before.title, client: target.name };

      const { data: from } = await db().from('clients')
        .select('name').eq('id', before.client_id).maybeSingle();

      await db().from('tasks').update({ client_id: target.id }).eq('id', work_id);

      await logActivity({
        actor: 'operator',
        action: 'work.reassigned',
        entityType: 'tasks',
        entityId: work_id,
        before: { client_id: before.client_id, client_name: from?.name ?? null },
        after: { client_id: target.id, client_name: target.name },
        instruction: before.client_visible
          ? `visible work moved from ${from?.name ?? 'unknown'} to ${target.name}`
          : undefined,
      });
      await recordAudit({
        type: 'work_pushed',
        subjectTable: 'tasks',
        subjectId: work_id,
        actor,
        before: { client: from?.name ?? null },
        after: { client: target.name },
        note: 'client reassigned via MCP',
      });

      await refreshSignals(db());
      return { moved: before.title, from: from?.name ?? null, to: target.name };
    });
  });

  /* ── Requests ─────────────────────────────────────────────────────── */

  server.registerTool('ask_request_question', {
    description: `Hand one question back to the client about their request — they see it on their portal and answer there. ${CONFIRM_NOTE}`,
    inputSchema: {
      request_id: z.string(),
      question: z.string().min(1),
      confirm: z.boolean(),
    },
  }, async ({ request_id, question, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      await returnForInfo(db(), request_id, question.trim());
      await refreshSignals(db());
      return { asked: question.trim(), request_id };
    });
  });

  /* ── The update editor ────────────────────────────────────────────── */

  server.registerTool('edit_update_draft', {
    description: 'Rewrite the body of a draft client update. Drafts are invisible to the client; a published update cannot be edited — use correct_update.',
    inputSchema: {
      update_id: z.string(),
      body: z.string().min(1),
    },
  }, async ({ update_id, body }) => guarded(async () => {
    const update = await getUpdate(db(), update_id);
    if (!update) throw new Error('that update no longer exists');
    if (update.status !== 'draft') {
      throw new Error('this one is no longer a draft, so its text is fixed — use correct_update to open a new version');
    }
    await editDraft(db(), update_id, body.trim());
    return { saved: update_id, note: 'Saved. Nobody has seen it yet — publish_update makes it visible.' };
  }));

  server.registerTool('correct_update', {
    description: 'Open a correction to a published update: a fresh draft at the next version number, pointing back at what was sent. The published text is never touched.',
    inputSchema: {
      update_id: z.string().describe('The published update being corrected'),
      body: z.string().min(1).describe('The corrected text'),
    },
  }, async ({ update_id, body }) => guarded(async () => {
    const original = await getUpdate(db(), update_id);
    if (!original) throw new Error('that update no longer exists');
    if (original.status !== 'published') {
      throw new Error('only a published update needs a correction — this one is still a draft, edit it directly');
    }
    const draft = await correctUpdate(db(), update_id, body.trim());
    return { draft_id: draft.id, note: 'A new draft version. It reaches the client only when published.' };
  }));

  /* ── The Inbox — captured drafts ──────────────────────────────────── */

  server.registerTool('update_inbox_item', {
    description: 'Fill in one item of a captured draft in the Inbox — client, estimate, priority, mode, titles, visibility. Every value must come from the operator\'s words, priority above all. Nothing is planned until confirm_inbox_draft.',
    inputSchema: {
      draft_id: z.string(),
      index: z.number().int().min(0).describe('Which item in the draft, from list_inbox order'),
      title: z.string().optional(),
      client: z.string().optional().describe('Client name, matched loosely'),
      is_internal: z.boolean().optional().describe('The operator\'s own work: no client, never visible'),
      est_minutes: z.number().int().min(5).optional(),
      priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
      mode: MODE_ENUM.optional(),
      client_title: z.string().optional(),
      client_visible: z.boolean().optional(),
      internal_target: z.string().optional().describe('YYYY-MM-DD'),
      below_median_reason: z.string().optional(),
    },
  }, async (args) => guarded(async () => {
    const draft = await getDraft(db(), args.draft_id);
    if (!draft) throw new Error('draft not found');
    if (draft.state !== 'open') throw new Error('this draft has already been dealt with');

    const items: DraftItem[] = [...draft.items];
    const item = items[args.index];
    if (!item) throw new Error(`the draft has no item ${args.index}`);

    if (args.title !== undefined) item.title = args.title.trim();
    if (args.client !== undefined) item.clientId = (await resolveClient(db(), args.client)).id;
    if (args.is_internal !== undefined) item.isInternal = args.is_internal;
    if (args.est_minutes !== undefined) item.estMinutes = Math.round(args.est_minutes);
    if (args.priority !== undefined) item.priority = PRIORITY_WORDS[args.priority];
    if (args.mode !== undefined) item.mode = args.mode as WorkMode;
    if (args.client_title !== undefined) item.clientTitle = args.client_title.trim() || null;
    if (args.client_visible !== undefined) item.clientVisible = args.client_visible;
    if (args.internal_target !== undefined) item.internalTarget = checkDate(args.internal_target, 'internal_target');
    if (args.below_median_reason !== undefined) item.belowMedianReason = args.below_median_reason;

    items[args.index] = item;
    await updateDraftItems(db(), args.draft_id, items, draft.missing_fields);
    return { updated: item.title, item: args.index };
  }));

  server.registerTool('confirm_inbox_draft', {
    description: `Confirm a captured draft: every item becomes real, planned work. Each item needs a client (or internal) and a priority first — update_inbox_item fills them in. ${CONFIRM_NOTE}`,
    inputSchema: {
      draft_id: z.string(),
      confirm: z.boolean(),
    },
  }, async ({ draft_id, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const created = await confirmDraft(db(), draft_id);
      await refreshSignals(db());
      return { planned: created.length, work_ids: created };
    });
  });

  server.registerTool('discard_inbox_draft', {
    description: 'Discard a captured draft from the Inbox. Nothing was planned from it, so nothing else changes.',
    inputSchema: {
      draft_id: z.string(),
    },
  }, async ({ draft_id }) => guarded(async () => {
    const draft = await getDraft(db(), draft_id);
    if (!draft) throw new Error('draft not found');
    await discardDraft(db(), draft_id);
    return { discarded: draft.raw_input.slice(0, 80) };
  }));

  /* ── Settings — the shape of the day, confirm-gated ───────────────── */

  server.registerTool('add_zone', {
    description: `Add a zone to a weekday — a named window of the day that admits certain kinds of work. ${CONFIRM_NOTE}`,
    inputSchema: {
      weekday: z.number().int().min(0).max(6).describe('0 = Sunday … 6 = Saturday'),
      name: z.string().optional(),
      start_time: z.string().optional().describe('HH:MM, default 18:00'),
      end_time: z.string().optional().describe('HH:MM, default 19:00'),
      modes: z.array(MODE_ENUM).optional().describe('Kinds of work admitted, default operational'),
      confirm: z.boolean(),
    },
  }, async (args) => {
    if (args.confirm !== true) return notConfirmed();
    return guarded(async () => {
      const { error: insertError } = await db().from('day_zones').insert({
        weekday: args.weekday,
        name: args.name?.trim() || 'New zone',
        start_time: checkTime(args.start_time ?? '18:00', 'start_time'),
        end_time: checkTime(args.end_time ?? '19:00', 'end_time'),
        modes: args.modes?.length ? args.modes : ['operational'],
      });
      if (insertError) throw new Error(insertError.message);
      await replan(db());
      await refreshSignals(db());
      return { added: args.name?.trim() || 'New zone', weekday: args.weekday };
    });
  });

  server.registerTool('update_zone', {
    description: `Change a zone's name, times or admitted kinds of work. Zone ids come from get_settings. An end at or before the start means the zone crosses midnight. ${CONFIRM_NOTE}`,
    inputSchema: {
      zone_id: z.string(),
      name: z.string().optional(),
      start_time: z.string().optional().describe('HH:MM'),
      end_time: z.string().optional().describe('HH:MM'),
      modes: z.array(MODE_ENUM).optional(),
      confirm: z.boolean(),
    },
  }, async (args) => {
    if (args.confirm !== true) return notConfirmed();
    return guarded(async () => {
      const changes: Record<string, unknown> = {};
      if (args.name !== undefined) {
        if (!args.name.trim()) throw new Error('a zone needs a name — it is how the plan refers to it');
        changes.name = args.name.trim();
      }
      if (args.start_time !== undefined) changes.start_time = checkTime(args.start_time, 'start_time');
      if (args.end_time !== undefined) changes.end_time = checkTime(args.end_time, 'end_time');
      if (args.modes !== undefined) {
        if (args.modes.length === 0) {
          throw new Error('a zone that admits no kind of work can never hold anything; give it at least one mode');
        }
        changes.modes = args.modes;
      }
      if (Object.keys(changes).length === 0) throw new Error('nothing to change');

      const { error: updateError } = await db().from('day_zones').update(changes).eq('id', args.zone_id);
      if (updateError) throw new Error(updateError.message);
      await replan(db());
      await refreshSignals(db());
      return { updated: args.zone_id, changes };
    });
  });

  server.registerTool('remove_zone', {
    description: `Remove a zone from the day — the plan recomputes without it. Zone ids come from get_settings. ${CONFIRM_NOTE}`,
    inputSchema: {
      zone_id: z.string(),
      confirm: z.boolean(),
    },
  }, async ({ zone_id, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const { error: deleteError } = await db().from('day_zones').delete().eq('id', zone_id);
      if (deleteError) throw new Error(deleteError.message);
      await replan(db());
      await refreshSignals(db());
      return { removed: zone_id };
    });
  });

  server.registerTool('set_working_hours', {
    description: `Replace the week's working hours and daily caps in one pass. Days not listed become non-working days. ${CONFIRM_NOTE}`,
    inputSchema: {
      days: z.array(z.object({
        weekday: z.number().int().min(0).max(6),
        start_time: z.string().describe('HH:MM'),
        end_time: z.string().describe('HH:MM'),
        max_minutes: z.number().int().min(1).describe('The daily cap'),
      })).describe('One entry per working day'),
      confirm: z.boolean(),
    },
  }, async ({ days, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const rows = days.map((d) => ({
        weekday: d.weekday,
        start_time: checkTime(d.start_time, 'start_time'),
        end_time: checkTime(d.end_time, 'end_time'),
        max_minutes: Math.round(d.max_minutes),
      }));

      await db().from('capacity_rules').delete().gte('weekday', 0);
      if (rows.length) {
        const { error: insertError } = await db().from('capacity_rules').insert(rows);
        if (insertError) throw new Error(insertError.message);
      }
      await replan(db());
      await refreshSignals(db());
      return { working_days: rows.length };
    });
  });

  server.registerTool('set_notification', {
    description: 'Switch one kind of operator notification on or off — kinds come from get_settings, including peak_blackout (hold even urgent messages until a peak zone ends).',
    inputSchema: {
      kind: z.string(),
      enabled: z.boolean(),
    },
  }, async ({ kind, enabled }) => guarded(async () => {
    if (!kind.trim()) throw new Error('a notification kind is required');
    const { error: upsertError } = await db().from('notification_settings')
      .upsert({ kind: kind.trim(), enabled, updated_at: new Date().toISOString() }, { onConflict: 'kind' });
    if (upsertError) throw new Error(upsertError.message);
    return { kind: kind.trim(), enabled };
  }));

  /* ── Recurrence ───────────────────────────────────────────────────── */

  server.registerTool('set_recurrence_active', {
    description: 'Pause or resume a recurring rule by id (list them with get_settings or the recurrence screens). Pausing stops new occurrences; existing work stays.',
    inputSchema: {
      rule_id: z.string(),
      active: z.boolean(),
    },
  }, async ({ rule_id, active }) => guarded(async () => {
    await setRecurrenceActive(db(), rule_id, active, actor);
    return { rule_id, active };
  }));

  server.registerTool('delete_recurrence', {
    description: `Delete a recurring rule — the standing authorisation is withdrawn and no further occurrences are created. Existing work stays. ${CONFIRM_NOTE}`,
    inputSchema: {
      rule_id: z.string(),
      confirm: z.boolean(),
    },
  }, async ({ rule_id, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const { error: deleteError } = await db().from('recurrence_rules').delete().eq('id', rule_id);
      if (deleteError) throw new Error(deleteError.message);
      await recordAudit({
        type: 'recurrence_changed',
        subjectTable: 'recurrence_rules',
        subjectId: rule_id,
        actor,
        note: 'standing authorisation withdrawn via MCP',
      });
      return { deleted: rule_id };
    });
  });

  /* ── Client management edges ──────────────────────────────────────── */

  server.registerTool('update_client', {
    description: `Change how a client is notified (never / digest / every) or how often they should see visible progress (target days). ${CONFIRM_NOTE}`,
    inputSchema: {
      client: z.string().describe('Client name, matched loosely'),
      notify_mode: z.enum(['never', 'digest', 'every']).optional(),
      target_days: z.number().int().min(1).max(30).optional().describe('Show visible progress at least every N days'),
      confirm: z.boolean(),
    },
  }, async ({ client: clientName, notify_mode, target_days, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      if (notify_mode === undefined && target_days === undefined) throw new Error('nothing to change');
      const match = await resolveClient(db(), clientName);

      if (notify_mode !== undefined) {
        const { error: updateError } = await db().from('clients')
          .update({ notify_mode }).eq('id', match.id);
        if (updateError) throw new Error(updateError.message);
      }
      if (target_days !== undefined) {
        const { error: upsertError } = await db().from('client_visibility')
          .upsert({ client_id: match.id, target_days });
        if (upsertError) throw new Error(upsertError.message);
      }
      return { updated: match.name, notify_mode: notify_mode ?? undefined, target_days: target_days ?? undefined };
    });
  });

  server.registerTool('delete_client', {
    description: `Remove a client PERMANENTLY: their logins are deleted (portal sessions end at once) and their work, requests, updates and contacts go with them. Irreversible. confirm_name must repeat the client's exact name — the same typed-name gate the app uses. ${CONFIRM_NOTE}`,
    inputSchema: {
      client: z.string().describe('Client name, matched loosely'),
      confirm_name: z.string().describe('The client\'s exact name, repeated by the operator'),
      confirm: z.boolean(),
    },
  }, async ({ client: clientName, confirm_name, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const match = await resolveClient(db(), clientName);
      if (confirm_name.trim().toLowerCase() !== match.name.trim().toLowerCase()) {
        throw new Error(`confirm_name does not match — the client is called "${match.name}"`);
      }

      const { data: contacts } = await db().from('client_contacts')
        .select('auth_user_id').eq('client_id', match.id);
      for (const contact of contacts ?? []) {
        if (contact.auth_user_id) await deleteLogin(contact.auth_user_id);
      }

      const { error: deleteError } = await db().from('clients').delete().eq('id', match.id);
      if (deleteError) throw new Error(deleteError.message);

      await recordAudit({
        type: 'login_removed',
        subjectTable: 'clients',
        subjectId: match.id,
        actor,
        note: `client "${match.name}" removed permanently via MCP; ${contacts?.length ?? 0} logins deleted`,
      });

      return { deleted: match.name, logins_deleted: contacts?.length ?? 0 };
    });
  });

  server.registerTool('remove_client_login', {
    description: `Remove a portal login entirely — the contact row and the sign-in behind it. Every session that address holds ends at once. ${CONFIRM_NOTE}`,
    inputSchema: {
      email: z.string(),
      confirm: z.boolean(),
    },
  }, async ({ email: rawEmail, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const email = rawEmail.trim().toLowerCase();
      const { data: contact } = await db().from('client_contacts')
        .select('id, email, auth_user_id, client_id').eq('email', email).maybeSingle();
      if (!contact) throw new Error('no login exists for that address');

      await db().from('client_contacts').delete().eq('id', contact.id);

      if (contact.auth_user_id) {
        await deleteLogin(contact.auth_user_id);
      } else {
        // A contact from before logins carried the user id.
        const { data: list } = await db().auth.admin.listUsers({ page: 1, perPage: 200 });
        const user = list?.users.find((u) => u.email?.toLowerCase() === email);
        if (user) await deleteLogin(user.id);
      }

      await recordAudit({
        type: 'login_removed',
        actor: contact.email,
        subjectTable: 'clients',
        subjectId: contact.client_id,
      });

      return { removed: contact.email };
    });
  });

  /* ── The nuclear option ───────────────────────────────────────────── */

  server.registerTool('remove_all_data', {
    description: `Remove EVERY client and everything that belongs to them: all work, requests, updates, drafts, plans, recorded effort and the activity log. Portal logins are deleted, so open sessions end. What survives: the operator's sign-in and the shape of the day. IRREVERSIBLE. Beyond confirm, the operator must have said the phrase "remove data" themselves — pass it through verbatim. ${CONFIRM_NOTE}`,
    inputSchema: {
      phrase: z.string().describe('Must be exactly "remove data", said by the operator'),
      confirm: z.boolean(),
    },
  }, async ({ phrase, confirm }) => {
    if (confirm !== true) return notConfirmed();
    if (phrase.trim().toLowerCase() !== 'remove data') {
      return text({ refused: 'The phrase must be exactly "remove data", said by the operator themselves.' });
    }
    return guarded(async () => {
      const { data: contacts } = await db().from('client_contacts').select('auth_user_id');
      for (const contact of contacts ?? []) {
        if (contact.auth_user_id) await deleteLogin(contact.auth_user_id);
      }

      // Children before parents; the filter is Supabase's "delete needs a
      // where" requirement, shaped to match every row.
      const wipe = [
        'overrun_reasons', 'effort_records', 'estimate_history', 'schedule_blocks',
        'plan_runs', 'task_dependencies', 'attention_signals', 'capture_drafts',
        'client_requests', 'client_updates', 'tasks', 'recurrence_rules',
        'projects', 'client_contacts', 'client_visibility', 'clients',
        'activity_log', 'notification_log',
      ];
      for (const table of wipe) {
        const { error: wipeError } = await db().from(table).delete().not('id', 'is', null);
        // client_visibility keys on client_id, not id.
        if (wipeError && table === 'client_visibility') {
          await db().from(table).delete().not('client_id', 'is', null);
        }
      }

      await recordAudit({
        type: 'data_removed',
        actor,
        note: `all client data removed via MCP; ${contacts?.length ?? 0} portal logins deleted`,
      });

      return { removed: 'everything', logins_deleted: contacts?.length ?? 0 };
    });
  });
}
