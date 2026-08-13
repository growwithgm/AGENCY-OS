/**
 * Client visibility rotation.
 *
 * Every client should *see* something finish every few days. A client at
 * or past their target gets their visible work boosted: +150 at target,
 * +25 for each further day, capped at +300.
 *
 * The boost never outranks operator priority or a committed date — it
 * reorders only among work that is otherwise equal on both (see order.ts).
 * That keeps it a fairness nudge, not automatic priority scoring.
 */

import type { VisibilityState } from './types';

export const BOOST_AT_TARGET = 150;
export const BOOST_PER_DAY = 25;
export const BOOST_CAP = 300;

export function visibilityBoosts(
  states: VisibilityState[],
  now: Date,
): Map<string, number> {
  const boosts = new Map<string, number>();

  for (const s of states) {
    const last = s.last_visible_completion ? new Date(s.last_visible_completion) : null;
    // Never seen anything finish: treat as long past target.
    const daysSince = last
      ? Math.floor((now.getTime() - last.getTime()) / 86_400_000)
      : Number.POSITIVE_INFINITY;

    if (daysSince < s.target_days) continue;

    const past = daysSince === Number.POSITIVE_INFINITY
      ? BOOST_CAP
      : Math.min(BOOST_AT_TARGET + BOOST_PER_DAY * (daysSince - s.target_days), BOOST_CAP);
    boosts.set(s.client_id, past);
  }

  return boosts;
}
