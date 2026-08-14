/**
 * The tool registry — and the line the assistant cannot cross.
 *
 * Two classes of action exist:
 *
 *   DIRECT   executes immediately, reports what it did, and can be undone
 *            for 30 seconds. Everything here affects only the operator.
 *
 *   CONFIRM  never executes. These are *proposal builders*: they return a
 *            payload the UI renders as a panel with an Apply button, and
 *            Apply calls an ordinary authenticated server action. There is
 *            no code path by which model output performs one.
 *
 * The dividing line is simple: what affects only the operator is DIRECT.
 * What reaches a client, or sets priority, is CONFIRM. Priority is fenced
 * because it is the scheduler's primary input — a model that can set it
 * can rewrite the whole plan by implication.
 *
 * This separation is structural, not a matter of prompting. CONFIRM names
 * are never placed in the tool list sent to the model, so no phrasing
 * ("just do it", "you decide", an earlier standing instruction) can reach
 * one. A test asserts this.
 */

export const DIRECT_TOOLS = [
  // Work
  'create_task', 'update_task', 'complete_task', 'block_task', 'unblock_task',
  'split_task', 'move_task', 'pin_task', 'unpin_task',
  // Time
  'start_timer', 'stop_timer', 'reschedule',
  // Capacity shape (within the rules Settings defines)
  'add_blackout', 'remove_blackout', 'adjust_capacity_exception',
  // Recurrence
  'create_recurrence', 'pause_recurrence',
  // Reports — drafting only. Publishing is CONFIRM.
  'generate_report_draft', 'regenerate_report_draft',
  // Client rhythm
  'create_touchpoint', 'apply_estimate_suggestion',
  // Reading and moving around
  'navigate', 'filter', 'search',
  // Deterministic scheduling questions — read-only until applied
  'can_i_do_this_now', 'when_can_i_do', 'propose_placement',
  'propose_reshuffle', 'what_if',
  'get_briefing', 'get_weekly_review', 'list_activity',
  // AI narration over computed facts — read-only, figures returned alongside.
  'get_workload_advice', 'get_estimate_insight',

  // Full sight of the dashboard. Everything a screen shows, a tool returns:
  // an assistant that cannot see the requests badge answers "nothing new"
  // while the sidebar shows two waiting.
  'list_requests', 'get_request', 'list_work', 'get_work',
  'list_clients', 'list_updates',
] as const;

export const CONFIRM_TOOLS = [
  // Priority is the scheduler's primary input.
  'set_priority', 'change_priority',
  // A promise to a client.
  'set_committed_date', 'change_committed_date',
  // Reaches a client.
  'approve_request', 'decline_request', 'publish_report',
  'archive_client', 'revoke_portal_access',
  // Destroys work.
  'delete_task', 'cancel_task',
  // Redefines the day. Only Settings may do this.
  'change_zone_rules',
] as const;

export type DirectTool = (typeof DIRECT_TOOLS)[number];
export type ConfirmTool = (typeof CONFIRM_TOOLS)[number];

const DIRECT = new Set<string>(DIRECT_TOOLS);
const CONFIRM = new Set<string>(CONFIRM_TOOLS);

export function isDirect(name: string): name is DirectTool {
  return DIRECT.has(name);
}

export function isConfirm(name: string): name is ConfirmTool {
  return CONFIRM.has(name);
}

/**
 * The only names the model may ever call. A name that is neither known nor
 * direct is refused rather than guessed at.
 */
export function callable(name: string): boolean {
  return DIRECT.has(name);
}

/** What the operator is asked to confirm, in their own words. */
export const CONFIRM_LABELS: Record<ConfirmTool, string> = {
  set_priority: 'Set the priority',
  change_priority: 'Change the priority',
  set_committed_date: 'Commit to a date',
  change_committed_date: 'Change a committed date',
  approve_request: 'Approve this request',
  decline_request: 'Decline this request',
  publish_report: 'Publish this update',
  archive_client: 'Archive this client',
  revoke_portal_access: 'Revoke portal access',
  delete_task: 'Delete this work',
  cancel_task: 'Cancel this work',
  change_zone_rules: 'Change the shape of the day',
};

/**
 * Why an action is fenced. Shown when the assistant declines one, so the
 * refusal reads as a rule rather than a failure.
 */
export const CONFIRM_REASONS: Record<ConfirmTool, string> = {
  set_priority: 'Priority is yours to set — it is what the scheduler orders everything by.',
  change_priority: 'Priority is yours to set — it is what the scheduler orders everything by.',
  set_committed_date: 'A committed date is a promise to a client, so it needs your explicit tap.',
  change_committed_date: 'Changing a promise a client is holding you to needs your explicit tap.',
  approve_request: 'Approving reaches the client and creates work, so it stays with you.',
  decline_request: 'Declining reaches the client, so it stays with you.',
  publish_report: 'Publishing is visible to the client the moment it happens.',
  archive_client: 'Archiving ends people’s access, so it stays with you.',
  revoke_portal_access: 'Revoking access ends someone’s session, so it stays with you.',
  delete_task: 'Deleting destroys the record of the work.',
  cancel_task: 'Cancelling is visible to the client if the work was.',
  change_zone_rules: 'The shape of your day changes in Settings only — not in chat.',
};
