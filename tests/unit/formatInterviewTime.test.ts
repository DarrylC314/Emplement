import { describe, it, expect } from 'vitest';
import { formatInterviewTime } from '@/lib/formatInterviewTime';

describe('formatInterviewTime', () => {
  it('formats a UTC instant into a full weekday/date/time string in Central time, with a "CT" label', () => {
    // 2026-08-19T15:00:00Z is 10:00 AM Central (UTC-5, CDT in August).
    expect(formatInterviewTime('2026-08-19T15:00:00Z')).toBe('Wednesday, August 19, 2026 at 10:00 AM CT');
  });

  it('accepts a Date object directly, not just a string', () => {
    expect(formatInterviewTime(new Date('2026-08-18T14:00:00Z'))).toBe('Tuesday, August 18, 2026 at 9:00 AM CT');
  });

  it('does not zero-pad the hour', () => {
    // 2026-08-20T14:00:00Z is 9:00 AM Central -- single-digit hour.
    expect(formatInterviewTime('2026-08-20T14:00:00Z')).toMatch(/at 9:00 AM CT$/);
  });
});
