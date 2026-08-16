import { describe, it, expect } from 'vitest';
import { filterApplicationsInWeek } from '@/lib/certificationPrefill';

// Fixture createdAt values are built with the local Date constructor (not
// hardcoded UTC "...Z" strings) so these tests exercise the same local-time
// semantics as the implementation and stay correct regardless of which
// timezone the host/CI machine runs in — both sides of every comparison are
// computed in that same process, so they're inherently self-consistent.
function localIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): string {
  return new Date(year, month - 1, day, hour, minute, second, ms).toISOString();
}

describe('filterApplicationsInWeek', () => {
  const posting = { title: 'Test Job', employer: { companyName: 'Test Co' } };

  it('includes an application created exactly on the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: localIso(2026, 8, 15, 10), jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('includes an application created exactly 6 days before the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: localIso(2026, 8, 9, 0), jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('excludes an application created 7 days before the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: localIso(2026, 8, 8, 23), jobPosting: posting }],
      '2026-08-15'
    );
    expect(result).toEqual([]);
  });

  it('excludes an application created after the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: localIso(2026, 8, 16, 0, 0, 1), jobPosting: posting }],
      '2026-08-15'
    );
    expect(result).toEqual([]);
  });

  it('returns an empty array for an empty applications list', () => {
    expect(filterApplicationsInWeek([], '2026-08-15')).toEqual([]);
  });

  it('handles multiple applications from different postings, preserving order and excluding out-of-window ones', () => {
    const result = filterApplicationsInWeek(
      [
        { id: 'a', createdAt: localIso(2026, 8, 12, 0), jobPosting: { title: 'Job A', employer: { companyName: 'Co A' } } },
        { id: 'b', createdAt: localIso(2026, 8, 13, 0), jobPosting: { title: 'Job B', employer: { companyName: null } } },
        { id: 'c', createdAt: localIso(2026, 7, 1, 0), jobPosting: { title: 'Job C', employer: { companyName: 'Co C' } } },
      ],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array for an invalid weekEndingDate', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: localIso(2026, 8, 15, 10), jobPosting: posting }],
      'not-a-date'
    );
    expect(result).toEqual([]);
  });

  it('includes a late-evening local application that would roll into the next UTC calendar day', () => {
    // A UTC-fixed window (the earlier implementation) would push a 11pm
    // local application into the next UTC day for any timezone west of
    // UTC, potentially dropping it out of the correct week. Local-time
    // semantics keep it correctly inside the week it actually happened in.
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: localIso(2026, 8, 15, 23, 30), jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });
});
