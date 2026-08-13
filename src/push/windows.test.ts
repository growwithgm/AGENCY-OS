import { describe, it, expect } from 'vitest';
import { decide, inPeak, combine, localMinutes, DELIVERY_WINDOWS } from './windows';
import type { Zone } from './windows';

/**
 * The delivery rules, in tests, because "it interrupted me during peak"
 * is the kind of bug nobody reports — they just stop trusting the thing.
 *
 * All times are constructed in UTC and read in Asia/Karachi (UTC+5).
 */

const utc = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, day, hour, minute));

// Monday 17 August 2026 in Karachi terms.
const PEAK: Zone[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, name: 'Peak', start_time: '21:00', end_time: '00:30',
}));

const OPERATIONS: Zone[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, name: 'Operations', start_time: '09:00', end_time: '12:00',
}));

describe('reading the operator’s wall clock', () => {
  it('converts to Karachi time, not the server’s', () => {
    // 04:00 UTC on a Monday is 09:00 in Karachi.
    expect(localMinutes(utc(17, 4))).toBe(9 * 60);
  });
});

describe('peak blackout', () => {
  it('recognises a peak that has not yet crossed midnight', () => {
    // 17:00 UTC Monday = 22:00 Monday in Karachi.
    expect(inPeak(utc(17, 17), PEAK)?.name).toBe('Peak');
  });

  it('still silences the small hours after midnight', () => {
    // 19:10 UTC Monday = 00:10 Tuesday in Karachi, inside Monday's peak.
    expect(inPeak(utc(17, 19, 10), PEAK)?.name).toBe('Peak');
  });

  it('lets go once the zone has ended', () => {
    // 19:40 UTC Monday = 00:40 Tuesday, past the 00:30 end.
    expect(inPeak(utc(17, 19, 40), PEAK)).toBeNull();
  });

  it('does not treat an ordinary zone as peak', () => {
    expect(inPeak(utc(17, 5), OPERATIONS)).toBeNull();
  });

  it('holds even an urgent notification, and says when it will arrive', () => {
    const decision = decide(utc(17, 17), 'urgent', PEAK, { peakBlackout: true });
    expect(decision.deliver).toBe(false);
    if (!decision.deliver) {
      expect(decision.reason).toBe('peak_blackout');
      // 22:00 Karachi → held until 00:30, two and a half hours later.
      expect(decision.deliverAfter.getTime() - utc(17, 17).getTime()).toBe(150 * 60_000);
    }
  });

  it('delivers during peak when the operator has turned the blackout off', () => {
    const decision = decide(utc(17, 17), 'urgent', PEAK, { peakBlackout: false });
    expect(decision.deliver).toBe(true);
  });
});

describe('delivery windows', () => {
  it('lets an urgent notification through outside peak', () => {
    // 06:00 UTC = 11:00 Karachi, mid-morning, no peak.
    expect(decide(utc(17, 6), 'urgent', PEAK).deliver).toBe(true);
  });

  it('holds a routine one until the next window', () => {
    // 06:00 UTC = 11:00 Karachi. Next window is 13:00, two hours away.
    const decision = decide(utc(17, 6), 'routine', PEAK);
    expect(decision.deliver).toBe(false);
    if (!decision.deliver) {
      expect(decision.reason).toBe('outside_window');
      expect(decision.deliverAfter.getTime() - utc(17, 6).getTime()).toBe(120 * 60_000);
    }
  });

  it('sends a routine one that arrives just as a window opens', () => {
    // 08:03 UTC = 13:03 Karachi, three minutes into the window.
    expect(decide(utc(17, 8, 3), 'routine', PEAK).deliver).toBe(true);
  });

  it('rolls over to the first window of the next day after the last one', () => {
    // 15:00 UTC = 20:00 Karachi: past 18:00, before peak at 21:00.
    const decision = decide(utc(17, 15), 'routine', PEAK);
    expect(decision.deliver).toBe(false);
    if (!decision.deliver) {
      // 20:00 to 09:00 the next morning is thirteen hours.
      expect(decision.deliverAfter.getTime() - utc(17, 15).getTime()).toBe(13 * 60 * 60_000);
    }
  });

  it('has three windows and no more', () => {
    expect(DELIVERY_WINDOWS).toEqual([540, 780, 1080]);
  });
});

describe('combining what was held', () => {
  it('leaves a single notification alone', () => {
    const one = combine([{ title: 'ibBan asked for something', body: 'Due Friday' }]);
    expect(one.title).toBe('ibBan asked for something');
    expect(one.body).toBe('Due Friday');
  });

  it('turns several into one message rather than a burst', () => {
    const many = combine([
      { title: 'ibBan asked for something' },
      { title: 'Two items slipped' },
      { title: 'A draft update is waiting' },
    ]);
    expect(many.title).toBe('3 things while you were working');
    expect(many.body.split('\n')).toHaveLength(3);
    expect(many.body).toContain('ibBan asked for something');
  });
});
