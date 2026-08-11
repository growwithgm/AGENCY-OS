// Required-fields checklist (spec §7.7). This is DETERMINISTIC — code decides
// what is missing; the AI only phrases the question for it.

export type DraftTask = {
  title: string | null;
  description: string | null;
  client_id: string | null;
  client_hint: string | null;
  client_confidence: number;      // confidence of the client resolution
  project_id: string | null;
  est_minutes: number | null;
  est_confidence: number;         // AI's confidence in its own estimate
  due_at: string | null;          // ISO
  due_hint: string | null;
  client_visible: boolean | null; // null = not yet answered
  priority: number | null;        // null until the operator picks — AI never sets it
  depends_on_hint: string | null;
  confidence: number;             // overall parse confidence
  flagged_fields: string[];       // defaults applied after the question cap
};

export type MissingField =
  | 'client_id'
  | 'title'
  | 'due_at'
  | 'est_minutes'
  | 'client_visible';

/**
 * Order matters (spec §7.7 rule 3): first what blocks everything else
 * (client → deliverable), then timing, then estimate, then visibility.
 * Priority is NOT in this list — it is its own state, always asked.
 */
export function missingFields(d: DraftTask): MissingField[] {
  const missing: MissingField[] = [];
  if (!d.client_id || d.client_confidence < 0.8) missing.push('client_id');
  if (!d.title || d.confidence < 0.5) missing.push('title');
  if (!d.due_at && !d.due_hint) missing.push('due_at');
  if (d.est_minutes == null || d.est_confidence < 0.6) missing.push('est_minutes');
  if (d.client_visible == null && d.client_id) missing.push('client_visible');
  return missing;
}

export const MAX_QUESTIONS = 4;

/** Defaults applied when the question cap is reached. Each applied default is flagged for review. */
export function applyDefaults(d: DraftTask): DraftTask {
  const flagged = [...d.flagged_fields];
  const out = { ...d };
  for (const f of missingFields(d)) {
    switch (f) {
      case 'due_at':
        break; // no due date is a valid state — scheduler treats it as non-urgent
      case 'est_minutes':
        if (out.est_minutes == null) out.est_minutes = 60;
        break;
      case 'client_visible':
        out.client_visible = true;
        break;
      default:
        break; // client/title can't be defaulted — they stay flagged
    }
    if (!flagged.includes(f)) flagged.push(f);
  }
  out.flagged_fields = flagged;
  return out;
}

/** Static button options for fields with known choices — no AI needed for these. */
export function staticOptions(field: MissingField, knownClients: string[]): string[] | null {
  switch (field) {
    case 'client_id':      return knownClients;
    case 'due_at':         return ['Aaj', 'Kal', 'Is hafte', 'Custom'];
    case 'est_minutes':    return ['30m', '1h', '2h', '4h', 'Custom'];
    case 'client_visible': return ['Client ko dikhe', 'Sirf mere liye'];
    default:               return null;
  }
}

export const PRIORITY_OPTIONS = ['1 Urgent', '2 High', '3 Normal', '4 Low'];
