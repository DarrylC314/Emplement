import { describe, it, expect } from 'vitest';
import { findConflictingWageRecords } from '@/lib/conflictingData';

const weekEndingDate = new Date('2026-08-15');

describe('findConflictingWageRecords', () => {
  it('returns no flags when the claimant reported working this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: true, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: null }]
    );
    expect(flags).toEqual([]);
  });

  it('returns no flags when the claimant reported earnings this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 100, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: null }]
    );
    expect(flags).toEqual([]);
  });

  it('flags an active job with no separation and no recall date, when the claimant reported no work/earnings', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: null }]
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.wageRecordId).toBe('w1');
  });

  it('does not flag a job that separated before this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: new Date('2026-08-01'), recallDate: null }]
    );
    expect(flags).toEqual([]);
  });

  it('does not flag an active job with a recall date after this week (approved layoff)', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: new Date('2026-09-01') }]
    );
    expect(flags).toEqual([]);
  });

  it('flags an active job whose recall date has already passed this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: new Date('2026-08-01') }]
    );
    expect(flags).toHaveLength(1);
  });

  it('evaluates multiple wage records independently', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [
        { id: 'w1', lastDayWorked: new Date('2026-08-01'), recallDate: null },
        { id: 'w2', lastDayWorked: null, recallDate: null },
      ]
    );
    expect(flags.map((f) => f.wageRecordId)).toEqual(['w2']);
  });
});
