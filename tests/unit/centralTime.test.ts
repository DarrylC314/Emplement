import { describe, it, expect } from 'vitest';
import { centralTimeEndOfDayToUtc } from '@/lib/centralTime';

describe('centralTimeEndOfDayToUtc', () => {
  it('converts a Standard Time (CST, UTC-6) date to its correct UTC instant', () => {
    expect(centralTimeEndOfDayToUtc('2026-11-30').toISOString()).toBe('2026-12-01T05:59:59.999Z');
  });

  it('converts a Daylight Time (CDT, UTC-5) date to its correct UTC instant', () => {
    expect(centralTimeEndOfDayToUtc('2026-06-15').toISOString()).toBe('2026-06-16T04:59:59.999Z');
  });

  it('correctly handles the day Daylight Time begins in 2026 (2026-03-08)', () => {
    expect(centralTimeEndOfDayToUtc('2026-03-08').toISOString()).toBe('2026-03-09T04:59:59.999Z');
  });

  it('correctly handles the day Standard Time resumes in 2026 (2026-11-01)', () => {
    expect(centralTimeEndOfDayToUtc('2026-11-01').toISOString()).toBe('2026-11-02T05:59:59.999Z');
  });
});
