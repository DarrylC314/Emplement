import { describe, it, expect } from 'vitest';
import { filterApplicationsInWeek } from '@/lib/certificationPrefill';

describe('filterApplicationsInWeek', () => {
  const posting = { title: 'Test Job', employer: { companyName: 'Test Co' } };

  it('includes an application created exactly on the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-15T10:00:00Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('includes an application created exactly 6 days before the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-09T00:00:00Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('excludes an application created 7 days before the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-08T23:00:00Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result).toEqual([]);
  });

  it('excludes an application created after the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-16T00:00:01Z', jobPosting: posting }],
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
        { id: 'a', createdAt: '2026-08-12T00:00:00Z', jobPosting: { title: 'Job A', employer: { companyName: 'Co A' } } },
        { id: 'b', createdAt: '2026-08-13T00:00:00Z', jobPosting: { title: 'Job B', employer: { companyName: null } } },
        { id: 'c', createdAt: '2026-07-01T00:00:00Z', jobPosting: { title: 'Job C', employer: { companyName: 'Co C' } } },
      ],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array for an invalid weekEndingDate', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-15T10:00:00Z', jobPosting: posting }],
      'not-a-date'
    );
    expect(result).toEqual([]);
  });
});
