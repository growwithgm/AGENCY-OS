import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Audit trail (INV-12 support).
 *
 * Small system, but this is how "why did that change?" stays answerable:
 * priority changes, approvals, completions, publications, commitment-date
 * changes, and failed sign-ins.
 */
export type AuditEventType =
  | 'priority_changed'
  | 'commitment_set'
  | 'commitment_changed'
  | 'work_completed'
  | 'work_pushed'
  | 'work_split'
  | 'work_stopped'
  | 'work_pinned'
  | 'work_unpinned'
  | 'blackout_added'
  | 'blackout_removed'
  | 'charge_changed'
  | 'recurrence_created'
  | 'request_approved'
  | 'request_declined'
  | 'update_approved'
  | 'update_published'
  | 'estimate_revised'
  | 'recurrence_changed'
  | 'signin'
  | 'signin_rejected'
  | 'password_changed'
  | 'login_created'
  | 'login_disabled'
  | 'login_enabled'
  | 'login_removed'
  | 'data_removed';

export async function recordAudit(input: {
  type: AuditEventType;
  subjectTable?: string;
  subjectId?: string;
  actor?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}): Promise<void> {
  try {
    await supabaseAdmin().from('audit_events').insert({
      event_type: input.type,
      subject_table: input.subjectTable ?? null,
      subject_id: input.subjectId ?? null,
      actor: input.actor ?? null,
      before_value: input.before ?? null,
      after_value: input.after ?? null,
      note: input.note ?? null,
    });
  } catch {
    // Audit is observability, not a gate. A failure here must never block
    // the operator's actual action.
  }
}
