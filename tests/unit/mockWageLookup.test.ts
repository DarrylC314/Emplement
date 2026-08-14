import { describe, it, expect } from 'vitest';
import { generateMockWageRecords } from '@/lib/mockWageLookup';

describe('generateMockWageRecords', () => {
  it('is deterministic: the same claimId always returns the same result', () => {
    const first = generateMockWageRecords('claim-abc-123');
    const second = generateMockWageRecords('claim-abc-123');
    expect(first).toEqual(second);
  });

  it('returns realistic, non-empty employer/wage fields when records are found', () => {
    // Sample many ids; at least one should produce a non-empty result with
    // complete fields (the generator is allowed to return zero records for
    // some ids — the "no records found" state is a real, handled outcome —
    // so this asserts on the non-empty branch specifically).
    const withRecords = Array.from({ length: 20 }, (_, i) => generateMockWageRecords(`claim-${i}`)).find(
      (r) => r.length > 0
    );
    expect(withRecords).toBeDefined();
    const record = withRecords![0]!;
    expect(record.employerName.length).toBeGreaterThan(0);
    expect(record.fein).toMatch(/^\d{2}-\d{7}$/);
    expect(record.wageRate).toBeGreaterThan(0);
    expect(record.hoursPerWeek).toBeGreaterThan(0);
    expect(record.firstDayWorked).toBeInstanceOf(Date);
  });

  it('can return zero records for some claims — a valid, handled state', () => {
    const withNoRecords = Array.from({ length: 20 }, (_, i) => generateMockWageRecords(`claim-${i}`)).find(
      (r) => r.length === 0
    );
    expect(withNoRecords).toBeDefined();
  });

  it('produces two distinct employer templates across a large sample', () => {
    const employerNames = new Set(
      Array.from({ length: 30 }, (_, i) => generateMockWageRecords(`sample-${i}`))
        .filter((r) => r.length > 0)
        .map((r) => r[0]!.employerName)
    );
    expect(employerNames.size).toBeGreaterThanOrEqual(2);
  });
});
