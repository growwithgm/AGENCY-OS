/**
 * When a notification is allowed to arrive.
 *
 * Two rules, and they are rules rather than preferences:
 *
 *   Windows — non-urgent notifications wait for 09:00, 13:00 or 18:00 and
 *   arrive as one combined message. A system that interrupts thirty times
 *   a day to save you thirty seconds each time is costing you the day.
 *
 *   Peak blackout — nothing is delivered during a peak zone, urgent
 *   included. Peak is the only stretch of the day where deep work is
 *   possible, and an urgent notification during it destroys more than it
 *   saves. It waits for the zone to end.
 *
 * Exactly two things break through outside peak: a committed deadline
 * becoming impossible, and a client request naming a date inside 48 hours.
 * Both are decisions that expire.
 */

export const DELIVERY_WINDOWS = [9 * 60, 13 * 60, 18 * 60];   // minutes past midnight

/**
 * The operator's timezone — one clock for the whole product.
 *
 * The delivery windows obey APP_TIMEZONE; the planner runs on the server's
 * local clock, so deploy with TZ set to the same value (see .env.example).
 * Two clocks that disagree would deliver a "morning" digest mid-afternoon.
 */
export const TIMEZONE = process.env.APP_TIMEZONE?.trim() || 'Asia/Karachi';

export type Zone = { start_time: string; end_time: string; name: string; weekday: number };

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m ?? 0);
};

/** Local wall-clock minutes for a moment, in the operator's timezone. */
export function localMinutes(at: Date, timeZone = TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function localWeekday(at: Date, timeZone = TIMEZONE): number {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Is this moment inside a peak zone? */
export function inPeak(at: Date, zones: Zone[], timeZone = TIMEZONE): Zone | null {
  const minutes = localMinutes(at, timeZone);
  const weekday = localWeekday(at, timeZone);

  for (const zone of zones) {
    if (zone.name.toLowerCase() !== 'peak') continue;
    const start = toMinutes(zone.start_time);
    const end = toMinutes(zone.end_time);

    // A zone that crosses midnight belongs to the day it starts on, so it
    // also silences the small hours of the following morning.
    if (end > start) {
      if (zone.weekday === weekday && minutes >= start && minutes < end) return zone;
    } else {
      if (zone.weekday === weekday && minutes >= start) return zone;
      if (zone.weekday === (weekday + 6) % 7 && minutes < end) return zone;
    }
  }
  return null;
}

export type Urgency = 'routine' | 'urgent';

export type Decision =
  | { deliver: true }
  | { deliver: false; reason: 'peak_blackout' | 'outside_window'; deliverAfter: Date };

/** Minutes until the next delivery window, from a wall-clock minute. */
function nextWindowFrom(minutes: number): number {
  for (const window of DELIVERY_WINDOWS) {
    if (window > minutes) return window - minutes;
  }
  return (1440 - minutes) + DELIVERY_WINDOWS[0];
}

function minutesUntilZoneEnd(at: Date, zone: Zone, timeZone: string): number {
  const now = localMinutes(at, timeZone);
  const end = toMinutes(zone.end_time);
  return end > now ? end - now : (1440 - now) + end;
}

export function decide(
  at: Date,
  urgency: Urgency,
  zones: Zone[],
  options: { peakBlackout: boolean; timeZone?: string } = { peakBlackout: true },
): Decision {
  const timeZone = options.timeZone ?? TIMEZONE;

  // Peak wins over urgency. That is the whole point of it.
  if (options.peakBlackout) {
    const peak = inPeak(at, zones, timeZone);
    if (peak) {
      return {
        deliver: false,
        reason: 'peak_blackout',
        deliverAfter: new Date(at.getTime() + minutesUntilZoneEnd(at, peak, timeZone) * 60_000),
      };
    }
  }

  if (urgency === 'urgent') return { deliver: true };

  const minutes = localMinutes(at, timeZone);
  // Inside the ten minutes after a window opens, send now rather than
  // holding a fresh notification for another four hours.
  const justOpened = DELIVERY_WINDOWS.some((w) => minutes >= w && minutes < w + 10);
  if (justOpened) return { deliver: true };

  return {
    deliver: false,
    reason: 'outside_window',
    deliverAfter: new Date(at.getTime() + nextWindowFrom(minutes) * 60_000),
  };
}

/** Several held notifications become one message rather than a burst. */
export function combine(items: { title: string; body?: string | null }[]): { title: string; body: string } {
  if (items.length === 1) {
    return { title: items[0].title, body: items[0].body ?? '' };
  }
  return {
    title: `${items.length} things while you were working`,
    body: items.map((i) => `· ${i.title}`).join('\n'),
  };
}
