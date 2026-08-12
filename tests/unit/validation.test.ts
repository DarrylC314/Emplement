import { describe, it, expect } from 'vitest';
import { signupSchema } from '@/lib/validation/auth';
import { identityVerificationSchema } from '@/lib/validation/identity';
import { claimInitiationSchema } from '@/lib/validation/claim';
import { weeklyCertificationSchema } from '@/lib/validation/certification';
import { reviewActionSchema } from '@/lib/validation/review';

describe('signupSchema', () => {
  it('accepts a valid email and password', () => {
    const result = signupSchema.safeParse({
      email: 'claimant@example.com',
      password: 'CorrectHorseBattery9',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 10 characters', () => {
    const result = signupSchema.safeParse({ email: 'a@b.com', password: 'short1' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = signupSchema.safeParse({ email: 'not-an-email', password: 'CorrectHorseBattery9' });
    expect(result.success).toBe(false);
  });
});

describe('identityVerificationSchema', () => {
  it('accepts a valid identity payload', () => {
    const result = identityVerificationSchema.safeParse({
      legalName: 'Jane Doe',
      dateOfBirth: '1990-01-15',
      ssn: '123-45-6789',
      phone: '5551234567',
      mailingAddress: '123 Main St, Jefferson City, MO 65101',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed SSN', () => {
    const result = identityVerificationSchema.safeParse({
      legalName: 'Jane Doe',
      dateOfBirth: '1990-01-15',
      ssn: '123456789',
      phone: '5551234567',
      mailingAddress: '123 Main St, Jefferson City, MO 65101',
    });
    expect(result.success).toBe(false);
  });
});

describe('claimInitiationSchema', () => {
  it('accepts a valid claim initiation payload', () => {
    const result = claimInitiationSchema.safeParse({
      employmentHistory: 'Worked at Acme Corp for 3 years as a machinist.',
      reasonForSeparation: 'LAYOFF',
      benefitYearStart: '2026-08-11',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid reasonForSeparation', () => {
    const result = claimInitiationSchema.safeParse({
      employmentHistory: 'Worked at Acme Corp.',
      reasonForSeparation: 'MADE_UP_REASON',
      benefitYearStart: '2026-08-11',
    });
    expect(result.success).toBe(false);
  });
});

describe('weeklyCertificationSchema', () => {
  it('accepts a valid certification with job search activities', () => {
    const result = weeklyCertificationSchema.safeParse({
      weekEndingDate: '2026-08-15',
      ableAndAvailable: true,
      workedThisWeek: false,
      earnings: 0,
      refusedWork: false,
      jobSearchActivities: [
        { employerName: 'Acme', contactMethod: 'Online application', contactDate: '2026-08-12', position: 'Machinist' },
        { employerName: 'Beta Co', contactMethod: 'In person', contactDate: '2026-08-13', position: 'Operator' },
        { employerName: 'Gamma LLC', contactMethod: 'Phone', contactDate: '2026-08-14', position: 'Technician' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative earnings', () => {
    const result = weeklyCertificationSchema.safeParse({
      weekEndingDate: '2026-08-15',
      ableAndAvailable: true,
      workedThisWeek: true,
      earnings: -10,
      refusedWork: false,
      jobSearchActivities: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('reviewActionSchema', () => {
  it('accepts a valid review action with reason', () => {
    const result = reviewActionSchema.safeParse({
      action: 'APPROVED',
      reason: 'Job search activity confirmed by phone with all three employers.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a review action with an empty reason', () => {
    const result = reviewActionSchema.safeParse({ action: 'DENIED', reason: '' });
    expect(result.success).toBe(false);
  });
});
