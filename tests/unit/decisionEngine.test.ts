import { describe, it, expect } from 'vitest';
import { evaluateCertification, type CertificationInput } from '@/lib/decisionEngine';

const baseline: CertificationInput = {
  ableAndAvailable: true,
  workedThisWeek: false,
  earnings: 0,
  refusedWork: false,
  jobSearchActivityCount: 3,
};

describe('evaluateCertification', () => {
  it('approves a clean baseline week', () => {
    expect(evaluateCertification(baseline)).toEqual({
      decision: 'APPROVED',
      reason: 'All eligibility criteria met.',
    });
  });

  it('denies when not able/available to work', () => {
    const result = evaluateCertification({ ...baseline, ableAndAvailable: false });
    expect(result.decision).toBe('DENIED');
    expect(result.reason).toMatch(/able.*available/i);
  });

  it('flags when work was refused', () => {
    const result = evaluateCertification({ ...baseline, refusedWork: true });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/refus/i);
  });

  it('flags when earnings are reported', () => {
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: true,
      earnings: 150,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
  });

  it('flags when fewer than 3 job-search contacts are reported', () => {
    const result = evaluateCertification({ ...baseline, jobSearchActivityCount: 2 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/job.search/i);
  });

  it('denies (not flags) when both not-able/available AND under job-search minimum apply — first match wins', () => {
    const result = evaluateCertification({
      ...baseline,
      ableAndAvailable: false,
      jobSearchActivityCount: 0,
    });
    expect(result.decision).toBe('DENIED');
  });

  it('defaults to FLAGGED for a negative job-search count (malformed input, fail-safe)', () => {
    const result = evaluateCertification({ ...baseline, jobSearchActivityCount: -1 });
    expect(result.decision).toBe('FLAGGED');
  });

  it('defaults to FLAGGED for negative earnings (malformed input, fail-safe)', () => {
    const result = evaluateCertification({ ...baseline, earnings: -50 });
    expect(result.decision).toBe('FLAGGED');
  });
});
