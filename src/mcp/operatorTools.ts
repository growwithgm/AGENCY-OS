/**
 * Operator-decision tools — MCP only.
 *
 * The in-app assistant may never perform these (INV-1, INV-6, INV-7): they
 * set priority, promise dates, reach clients, or destroy work. The MCP
 * endpoint is different in kind — it is authenticated by the operator's own
 * machine secret, so the caller IS the operator, driving Claude by hand.
 *
 * Two guards remain even here:
 *   · every tool requires `confirm: true`, and its description tells the
 *     model to pass it only when the operator explicitly asked for that
 *     action in their own words — never on its own initiative;
 *   · everything runs through the same data-layer operations the UI uses,
 *     so every decision is audited exactly as if it were tapped in the app.
 *
 * The one deliberate exception: the shape of the day (zones, hours) still
 * changes only in Settings. It is readable here, not writable.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getWork, updateWork } from '@/data/work';
import { convertRequest, declineRequest, getRequest } from '@/data/requests';
import { publishUpdate, getUpdate } from '@/data/updates';
import { listClients } from '@/data/clients';
import { listZones } from '@/data/zones';
import { openDrafts } from '@/data/capture';
import { cronHealth } from '@/data/cronHealth';
import { aiUsage } from '@/data/aiUsage';
import { replan } from '@/data/planning';
import { provisionClientLogin, setLoginDisabled } from '@/lib/authFlow';
import { recordAudit } from '@/lib/audit';
import { CHARGE_CURRENCIES, CLIENT_COLORS } from '@/data/types';
import { MODES, type WorkMode } from '@/engines/planner/types';

const PRIORITY_WORDS: Record<string, number> = { critical: 1, high: 2, normal: 3, low: 4 };

const CONFIRM_NOTE =
  'OPERATOR DECISION. Call this ONLY when the operator explicitly asked for exactly '
  + 'this action in their own words — never on your own initiative, never inferred. '
  + 'Pass confirm: true to state that.';

function text(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

const notConfirmed = () => text({
  refused: 'This is an operator decision. Ask the operator, and call again with confirm: true only if they explicitly said to do it.',
});

async function guarded(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }
}

export function registerOperatorTools(server: McpServer): void {
  const db = () => supabaseAdmin();
  const actor = 'operator-via-mcp';

  /* ── The remaining reads, so the whole app is on MCP ─────────────── */

  server.registerTool('get_settings', {
    description: 'The shape of the working day: zones per weekday, working hours and caps, upcoming blackouts, notification switches. Read-only — the day changes in Settings only.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const [zones, hours, blackouts, notify] = await Promise.all([
      listZones(db()),
      db().from('capacity_rules').select('weekday, start_time, end_time, max_minutes').order('weekday'),
      db().from('blackouts').select('id, starts_at, ends_at, reason').gte('ends_at', new Date().toISOString()).order('starts_at'),
      db().from('notification_settings').select('kind, enabled'),
    ]);
    return {
      zones,
      working_hours: hours.data ?? [],
      blackouts_ahead: blackouts.data ?? [],
      notifications: notify.data ?? [],
    };
  }));

  server.registerTool('list_inbox', {
    description: 'Captured drafts parked in the Inbox, waiting for the operator to confirm. Nothing here is in the plan yet.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const drafts = await openDrafts(db());
    return drafts.map((d) => ({
      id: d.id,
      raw_input: d.raw_input,
      items: d.items.map((i) => ({ title: i.title, est_minutes: i.estMinutes ?? null, missing: i.priority === null ? 'priority' : null })),
      created_at: d.created_at,
    }));
  }));

  server.registerTool('get_cron_health', {
    description: 'Whether the scheduler heartbeat is alive: the last plan run and whether it is stale (over 36 hours old).',
    inputSchema: {},
  }, async () => guarded(() => cronHealth(db())));

  server.registerTool('get_ai_usage', {
    description: 'The last 7 days of AI spend: calls, tokens, errors and estimated cost per job and model.',
    inputSchema: {},
  }, async () => guarded(() => aiUsage(db(), 7)));

  /* ── The decisions ────────────────────────────────────────────────── */

  server.registerTool('set_priority', {
    description: `Set a work item's priority. ${CONFIRM_NOTE}`,
    inputSchema: {
      work_id: z.string(),
      priority: z.enum(['critical', 'high', 'normal', 'low']),
      confirm: z.boolean(),
    },
  }, async ({ work_id, priority, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const before = await getWork(db(), work_id);
      if (!before) throw new Error('work item not found');
      await updateWork(db(), work_id, { priority: PRIORITY_WORDS[priority] }, actor);
      return { updated: before.title, priority };
    });
  });

  server.registerTool('set_committed_date', {
    description: `Commit to a date, or change one — a promise the client will see. Pass date null to withdraw it. ${CONFIRM_NOTE}`,
    inputSchema: {
      work_id: z.string(),
      date: z.string().nullable().describe('YYYY-MM-DD, or null to remove the commitment'),
      confirm: z.boolean(),
    },
  }, async ({ work_id, date, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('the date must be YYYY-MM-DD or null');
      const before = await getWork(db(), work_id);
      if (!before) throw new Error('work item not found');
      await updateWork(db(), work_id, { committedDate: date }, actor);
      return {
        updated: before.title,
        committed_date: date,
        note: date ? 'This is now a promise the client can see.' : 'The commitment has been withdrawn.',
      };
    });
  });

  server.registerTool('approve_request', {
    description: `Approve a client request and turn it into planned work. Priority and estimate come from the operator's words. ${CONFIRM_NOTE}`,
    inputSchema: {
      request_id: z.string(),
      priority: z.enum(['critical', 'high', 'normal', 'low']),
      est_minutes: z.number().int().min(5),
      mode: z.enum(MODES as unknown as [string, ...string[]]),
      title: z.string().optional().describe('Defaults to the request title'),
      internal_target: z.string().optional(),
      committed_date: z.string().optional().describe('Only if the operator actually promised it'),
      charge_amount: z.number().min(0).optional().describe('What the client pays, shown on their portal'),
      charge_currency: z.enum(CHARGE_CURRENCIES as unknown as [string, ...string[]]).optional(),
      client_visible: z.boolean().optional(),
      confirm: z.boolean(),
    },
  }, async (args) => {
    if (args.confirm !== true) return notConfirmed();
    return guarded(async () => {
      const request = await getRequest(db(), args.request_id);
      if (!request) throw new Error('request not found');

      const title = args.title?.trim()
        || (request.draft as { title?: string } | null)?.title
        || request.raw_input.slice(0, 80);

      const workId = await convertRequest(db(), {
        requestId: args.request_id,
        title,
        priority: PRIORITY_WORDS[args.priority],
        estMinutes: Math.round(args.est_minutes),
        internalTarget: args.internal_target ?? null,
        committedDate: args.committed_date ?? null,
        clientVisible: args.client_visible ?? true,
        actor,
      });

      await updateWork(db(), workId, {
        mode: args.mode as WorkMode,
        chargeAmount: args.charge_amount && args.charge_amount > 0 ? args.charge_amount : null,
        chargeCurrency: args.charge_currency ?? 'USD',
      }, actor);

      return { approved: title, work_id: workId, priority: args.priority };
    });
  });

  server.registerTool('decline_request', {
    description: `Decline a client request, with the reason. ${CONFIRM_NOTE}`,
    inputSchema: {
      request_id: z.string(),
      note: z.string().min(1).describe('Why — required'),
      show_note_to_client: z.boolean().optional(),
      confirm: z.boolean(),
    },
  }, async ({ request_id, note, show_note_to_client, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      await declineRequest(db(), request_id, note, show_note_to_client ?? false, actor);
      return { declined: request_id, note_visible_to_client: show_note_to_client ?? false };
    });
  });

  server.registerTool('publish_update', {
    description: `Publish a drafted client update — it becomes visible to the client the moment this runs. ${CONFIRM_NOTE}`,
    inputSchema: {
      update_id: z.string(),
      confirm: z.boolean(),
    },
  }, async ({ update_id, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      await publishUpdate(db(), update_id, actor);
      const update = await getUpdate(db(), update_id);
      return { published: update_id, period: update ? `${update.period_start} to ${update.period_end}` : null };
    });
  });

  server.registerTool('archive_client', {
    description: `Archive a client: disables their logins, ends open sessions, stops notifications. Work and published updates are kept. ${CONFIRM_NOTE}`,
    inputSchema: {
      client: z.string().describe('Client name, matched loosely'),
      confirm: z.boolean(),
    },
  }, async ({ client: clientName, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const clients = await listClients(db());
      const needle = clientName.toLowerCase();
      const match = clients.find((c) => c.name.toLowerCase() === needle)
        ?? clients.find((c) => c.name.toLowerCase().includes(needle));
      if (!match) throw new Error(`no client matches "${clientName}"`);

      const { data: contacts } = await db().from('client_contacts')
        .select('id, auth_user_id').eq('client_id', match.id);
      for (const contact of contacts ?? []) {
        if (contact.auth_user_id) await setLoginDisabled(contact.auth_user_id, true);
      }
      await db().from('client_contacts').update({ active: false }).eq('client_id', match.id);
      await db().from('clients').update({ status: 'archived', notify_mode: 'never' }).eq('id', match.id);

      await recordAudit({
        type: 'login_disabled',
        subjectTable: 'clients',
        subjectId: match.id,
        actor,
        note: `client archived via MCP; ${contacts?.length ?? 0} logins disabled`,
      });

      return { archived: match.name, logins_disabled: contacts?.length ?? 0 };
    });
  });

  /* ── Client management ────────────────────────────────────────────── */

  server.registerTool('create_client', {
    description: `Add a new client (brand). They get a colour mark and an English portal; no login exists until create_client_login. ${CONFIRM_NOTE}`,
    inputSchema: {
      name: z.string().min(1).describe('The client\'s name, e.g. "ibBan"'),
      confirm: z.boolean(),
    },
  }, async ({ name, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('a client name is required');

      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
        || `client-${Date.now()}`;

      // Same colour rule as the app: assigned once, in order, kept forever.
      const { count } = await db().from('clients').select('id', { count: 'exact', head: true });

      const { data: created, error: insertError } = await db().from('clients').insert({
        name: trimmed,
        brand_slug: slug,
        locale: 'en',
        status: 'active',
        color_index: (count ?? 0) % CLIENT_COLORS.length,
        notify_mode: 'digest',
      }).select('id').single();
      if (insertError || !created) throw new Error(insertError?.message ?? 'insert failed');

      // Start the rotation clock now, so a new client counts as seen today
      // rather than as starved since the beginning of time.
      await db().from('client_visibility').upsert({
        client_id: created.id,
        target_days: 3,
        last_visible_completion: new Date().toISOString(),
      });

      return {
        created: trimmed,
        client_id: created.id,
        note: 'No portal login yet — use create_client_login to make one.',
      };
    });
  });

  server.registerTool('create_client_login', {
    description: `Create a portal login for someone at a client and return the email + generated password. The password is returned EXACTLY ONCE — relay it to the operator verbatim; it is never stored or shown again (reset_client_login makes a new one). ${CONFIRM_NOTE}`,
    inputSchema: {
      client: z.string().describe('Client name, matched loosely'),
      email: z.string().describe('The sign-in address for this person'),
      full_name: z.string().optional(),
      confirm: z.boolean(),
    },
  }, async ({ client: clientName, email: rawEmail, full_name, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const email = rawEmail.trim().toLowerCase();
      if (!email.includes('@')) throw new Error('a valid email address is required');

      const clients = await listClients(db());
      const needle = clientName.toLowerCase();
      const match = clients.find((c) => c.name.toLowerCase() === needle)
        ?? clients.find((c) => c.name.toLowerCase().includes(needle));
      if (!match) throw new Error(`no client matches "${clientName}"`);

      const { data: existing } = await db().from('client_contacts')
        .select('id, client_id').eq('email', email).maybeSingle();
      if (existing && existing.client_id !== match.id) {
        throw new Error('that address already has a login for another client');
      }

      const login = await provisionClientLogin(email, match.id, full_name?.trim() || null);

      if (existing) {
        await db().from('client_contacts')
          .update({ name: full_name?.trim() || null, active: true, auth_user_id: login.userId })
          .eq('id', existing.id);
      } else {
        const { error: contactError } = await db().from('client_contacts').insert({
          client_id: match.id,
          email,
          name: full_name?.trim() || null,
          active: true,
          auth_user_id: login.userId,
        });
        if (contactError) throw new Error(contactError.message);
      }

      await recordAudit({ type: 'login_created', actor: email, subjectTable: 'clients', subjectId: match.id });

      return {
        client: match.name,
        login_email: email,
        password: login.password,
        note: 'Shown once. Hand it to the client however you like; they can change it at /portal → Your account.',
      };
    });
  });

  server.registerTool('reset_client_login', {
    description: `Reset a portal login's password and return the new one — the old password stops working at once. Returned EXACTLY ONCE. ${CONFIRM_NOTE}`,
    inputSchema: {
      email: z.string().describe('The login\'s email address'),
      confirm: z.boolean(),
    },
  }, async ({ email: rawEmail, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const email = rawEmail.trim().toLowerCase();
      const { data: contact } = await db().from('client_contacts')
        .select('id, email, name, client_id').eq('email', email).maybeSingle();
      if (!contact) throw new Error('no login exists for that address');

      const login = await provisionClientLogin(contact.email, contact.client_id, contact.name);
      await db().from('client_contacts')
        .update({ auth_user_id: login.userId, active: true })
        .eq('id', contact.id);

      await recordAudit({
        type: 'login_created', actor: contact.email, note: 'password reset via MCP',
        subjectTable: 'clients', subjectId: contact.client_id,
      });

      return { login_email: contact.email, password: login.password, note: 'Shown once — the old password is dead.' };
    });
  });

  server.registerTool('set_login_disabled', {
    description: `Disable or re-enable a portal login. Disabling stops new sign-ins now; an open session lives at most an hour. ${CONFIRM_NOTE}`,
    inputSchema: {
      email: z.string(),
      disabled: z.boolean(),
      confirm: z.boolean(),
    },
  }, async ({ email: rawEmail, disabled, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const email = rawEmail.trim().toLowerCase();
      const { data: contact } = await db().from('client_contacts')
        .select('id, email, auth_user_id, client_id').eq('email', email).maybeSingle();
      if (!contact) throw new Error('no login exists for that address');

      if (contact.auth_user_id) await setLoginDisabled(contact.auth_user_id, disabled);
      await db().from('client_contacts').update({ active: !disabled }).eq('id', contact.id);

      await recordAudit({
        type: disabled ? 'login_disabled' : 'login_enabled',
        actor: contact.email,
        subjectTable: 'clients',
        subjectId: contact.client_id,
      });

      return { login_email: contact.email, disabled };
    });
  });

  server.registerTool('delete_task', {
    description: `Delete a work item permanently — its record, schedule and effort go with it. ${CONFIRM_NOTE}`,
    inputSchema: {
      work_id: z.string(),
      confirm: z.boolean(),
    },
  }, async ({ work_id, confirm }) => {
    if (confirm !== true) return notConfirmed();
    return guarded(async () => {
      const before = await getWork(db(), work_id);
      if (!before) throw new Error('work item not found');

      const { error: deleteError } = await db().from('tasks').delete().eq('id', work_id);
      if (deleteError) throw new Error(deleteError.message);

      await recordAudit({
        type: 'work_completed',
        subjectTable: 'tasks',
        subjectId: work_id,
        actor,
        note: `"${before.title}" deleted via MCP on the operator's explicit instruction`,
      });

      await replan(db());
      return { deleted: before.title };
    });
  });
}
