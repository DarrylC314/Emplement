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
    const result = evaluateCertification(baseline);
    expect(result).toEqual({
      decision: 'APPROVED',
      reason: 'All eligibility criteria met.',
      ruleId: 'ALL_CRITERIA_MET',
    });
  });

  it('denies when not able/available to work', () => {
    const result = evaluateCertification({ ...baseline, ableAndAvailable: false });
    expect(result.decision).toBe('DENIED');
    expect(result.reason).toMatch(/able.*available/i);
    expect(result.ruleId).toBe('ABLE_AND_AVAILABLE');
  });

  it('flags when work was refused', () => {
    const result = evaluateCertification({ ...baseline, refusedWork: true });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/refus/i);
    expect(result.ruleId).toBe('WORK_REFUSAL');
  });

  it('flags when earnings are reported', () => {
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: true,
      earnings: 150,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
    expect(result.ruleId).toBe('EARNED_INCOME');
  });

  it('flags reported earnings even when workedThisWeek is false', () => {
    // Regression: the rule used to require BOTH workedThisWeek AND earnings > 0,
    // so a claimant reporting earnings while answering "No" to "did you work
    // this week" fell through to APPROVED — a silent overpayment path. The spec
    // flags earned income unconditionally.
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: false,
      earnings: 150,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
    expect(result.ruleId).toBe('EARNED_INCOME');
  });

  it('flags reported work even when earnings are zero', () => {
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: true,
      earnings: 0,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
    expect(result.ruleId).toBe('EARNED_INCOME');
  });

  it('flags when fewer than 3 job-search contacts are reported, with threshold/actualValue set', () => {
    const result = evaluateCertification({ ...baseline, jobSearchActivityCount: 2 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/job.search/i);
    expect(result.ruleId).toBe('JOB_SEARCH_MINIMUM');
    expect(result.threshold).toBe('3 contacts');
    expect(result.actualValue).toBe('2 contacts');
  });

  it('denies (not flags) when both not-able/available AND under job-search minimum apply — first match wins', () => {
    const result = evaluateCertification({
      ...baseline,
      ableAndAvailable: false,
      jobSearchActivityCount: 0,
    });
    expect(result.decision).toBe('DENIED');
    expect(result.ruleId).toBe('ABLE_AND_AVAILABLE');
  });

  it('defaults to FLAGGED for a negative job-search count (malformed input, fail-safe)', () => {
    const result = evaluateCertification({ ...baseline, jobSearchActivityCount: -1 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.ruleId).toBe('INVALID_INPUT');
  });

  it('defaults to FLAGGED for negative earnings (malformed input, fail-safe)', () => {
    const result = evaluateCertification({ ...baseline, earnings: -50 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.ruleId).toBe('INVALID_INPUT');
  });
});
