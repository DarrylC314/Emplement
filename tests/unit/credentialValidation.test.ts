import { describe, it, expect } from 'vitest';
import {
  parseCredentialDetails,
  credentialRequestCreateSchema,
  credentialResponseSchema,
  proactiveCredentialReportSchema,
} from '@/lib/validation/credential';

describe('parseCredentialDetails', () => {
  it('accepts valid EDUCATION details', () => {
    const result = parseCredentialDetails('EDUCATION', {
      schemaVersion: 1,
      major: 'Computer Science',
      degreeType: "Bachelor's",
      graduationDate: '2018-05-15',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid MILITARY_SERVICE details', () => {
    const result = parseCredentialDetails('MILITARY_SERVICE', {
      schemaVersion: 1,
      branch: 'U.S. Army',
      rank: 'Sergeant',
    });
    expect(result.success).toBe(true);
  });

  it('rejects MILITARY_SERVICE details missing the required branch field', () => {
    const result = parseCredentialDetails('MILITARY_SERVICE', { schemaVersion: 1, rank: 'Sergeant' });
    expect(result.success).toBe(false);
  });

  it('accepts valid LAW_ENFORCEMENT details', () => {
    const result = parseCredentialDetails('LAW_ENFORCEMENT', { schemaVersion: 1, agency: 'Rolla Police Department' });
    expect(result.success).toBe(true);
  });

  it('accepts valid CERTIFICATION details', () => {
    const result = parseCredentialDetails('CERTIFICATION', {
      schemaVersion: 1,
      certificationName: 'Certified Public Accountant',
      expirationDate: '2030-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects CERTIFICATION details missing the required certificationName field', () => {
    const result = parseCredentialDetails('CERTIFICATION', { schemaVersion: 1 });
    expect(result.success).toBe(false);
  });

  it('accepts valid OTHER details', () => {
    const result = parseCredentialDetails('OTHER', { schemaVersion: 1, description: 'Volunteer firefighter, 2015-2020' });
    expect(result.success).toBe(true);
  });

  it('rejects a details object with the wrong schemaVersion', () => {
    const result = parseCredentialDetails('EDUCATION', { schemaVersion: 2, major: 'Computer Science' });
    expect(result.success).toBe(false);
  });
});

describe('credentialRequestCreateSchema', () => {
  it('accepts a valid request with all fields', () => {
    const result = credentialRequestCreateSchema.safeParse({
      organizationId: 'org-1',
      credentialType: 'EDUCATION',
      requestedTitle: "Bachelor's degree, Computer Science, ~2018",
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid request with requestedTitle omitted', () => {
    const result = credentialRequestCreateSchema.safeParse({ organizationId: 'org-1', credentialType: 'CERTIFICATION' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid credentialType', () => {
    const result = credentialRequestCreateSchema.safeParse({ organizationId: 'org-1', credentialType: 'NOT_A_TYPE' });
    expect(result.success).toBe(false);
  });
});

describe('credentialResponseSchema', () => {
  it('accepts a confirming response', () => {
    const result = credentialResponseSchema.safeParse({
      confirmed: true,
      title: 'Bachelor of Science in Computer Science',
      eventDate: '2018-05-15',
      details: { schemaVersion: 1, major: 'Computer Science' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a denying response with no note', () => {
    const result = credentialResponseSchema.safeParse({ confirmed: false });
    expect(result.success).toBe(true);
  });

  it('rejects a confirming response missing title', () => {
    const result = credentialResponseSchema.safeParse({ confirmed: true, eventDate: '2018-05-15', details: {} });
    expect(result.success).toBe(false);
  });
});

describe('proactiveCredentialReportSchema', () => {
  it('accepts a valid proactive report', () => {
    const result = proactiveCredentialReportSchema.safeParse({
      ssn: '123-45-6789',
      type: 'EDUCATION',
      title: 'Bachelor of Science in Computer Science',
      eventDate: '2018-05-15',
      details: { schemaVersion: 1, major: 'Computer Science' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed SSN', () => {
    const result = proactiveCredentialReportSchema.safeParse({
      ssn: 'not-an-ssn',
      type: 'EDUCATION',
      title: 'Degree',
      eventDate: '2018-05-15',
      details: { schemaVersion: 1 },
    });
    expect(result.success).toBe(false);
  });
});
