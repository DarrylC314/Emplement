import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { encryptSSN } from '@/lib/encryption';
import { getServerAuthSession } from '@/lib/auth';
import { expectNoSensitiveFields } from '../helpers/pii';
import { GET as searchClaimants } from '@/app/api/staff/claimants/route';
import { GET as getClaimantDetail } from '@/app/api/staff/claimants/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('staff claimant routes (search + detail)', () => {
  let claimId: string;
  let claimantProfileId: string;
  let claimantUserId: string;
  let caseworkerUserId: string;
  let certificationId: string;
  let caseNoteId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let employmentEventId: string;
  const legalName = `Search Target ${Date.now()}`;
  // Distinctive values so the PII-leak assertions below are meaningful: if the
  // routes ever revert to `include: { user: true }` / `claimant: true`, these
  // exact strings show up in the response body.
  const claimantPasswordHash = `sentinel-password-hash-${Date.now()}`;
  const ssnCiphertext = encryptSSN('123-45-6789');

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: {
        email: `claimants-search-test-${Date.now()}@example.com`,
        passwordHash: claimantPasswordHash,
        role: 'CLAIMANT',
      },
    });
    claimantUserId = claimantUser.id;

    const caseworkerUser = await prisma.user.create({
      data: { email: `claimants-search-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    // A real User row, not a placeholder string: the detail route now writes
    // an AuditLog row on every successful fetch, and AuditLog.actorUserId is
    // a foreign key — a fake id would fail that constraint the moment the
    // route is actually exercised.
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const profile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName,
        ssnEncrypted: ssnCiphertext,
        prefix: 'DR',
        suffix: 'JR',
        gender: 'Non-binary',
        dateOfBirth: new Date('1990-05-15'),
      },
    });
    claimantProfileId = profile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const certification = await prisma.weeklyCertification.create({
      data: {
        claimId,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'FLAGGED',
        autoDecisionReason: 'Fewer than 3 job-search contacts.',
      },
    });
    certificationId = certification.id;

    const caseNote = await prisma.caseNote.create({
      data: {
        claimId,
        caseworkerId: caseworkerUser.id,
        note: 'Called claimant to confirm job-search log.',
      },
    });
    caseNoteId = caseNote.id;

    const employerUser = await prisma.user.create({
      data: { email: `claimants-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;

    const employerProfile = await prisma.employerProfile.create({
      data: {
        userId: employerUser.id,
        companyName: 'Test Employer Corp',
        verificationStatus: 'VERIFIED',
      },
    });
    employerProfileId = employerProfile.id;

    const employmentEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Test Employee',
        ssnHash: 'test-hash',
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    employmentEventId = employmentEvent.id;
  });

  it('returns matching claimants with nested claim certifications and case notes', async () => {
    const res = await searchClaimants(
      new Request(`http://localhost/api/staff/claimants?q=${encodeURIComponent(legalName)}`)
    );
    const results = await res.json();

    expect(results).toHaveLength(1);
    const [claimant] = results;
    expect(claimant.id).toBe(claimantProfileId);
    expect(claimant.legalName).toBe(legalName);
    expect(claimant.prefix).toBe('DR');
    expect(claimant.suffix).toBe('JR');
    expect(claimant.gender).toBe('Non-binary');
    expect(claimant.dateOfBirth).toBeTruthy();

    expect(claimant.claims).toHaveLength(1);
    const [claim] = claimant.claims;
    expect(claim.id).toBe(claimId);

    expect(claim.certifications).toHaveLength(1);
    expect(claim.certifications[0].id).toBe(certificationId);
    expect(claim.certifications[0].autoDecision).toBe('FLAGGED');
    expect(claim.certifications[0].autoDecisionReason).toBe('Fewer than 3 job-search contacts.');

    expect(claim.caseNotes).toHaveLength(1);
    expect(claim.caseNotes[0].id).toBe(caseNoteId);
    expect(claim.caseNotes[0].note).toBe('Called claimant to confirm job-search log.');
  });

  it('never leaks passwordHash or ssnEncrypted from the search route', async () => {
    const res = await searchClaimants(
      new Request(`http://localhost/api/staff/claimants?q=${encodeURIComponent(legalName)}`)
    );
    expectNoSensitiveFields(await res.json(), [claimantPasswordHash, ssnCiphertext]);
  });

  it('returns a single claimant by id with the same nested shape as the search route', async () => {
    const res = await getClaimantDetail(
      new Request(`http://localhost/api/staff/claimants/${claimantProfileId}`),
      { params: { id: claimantProfileId } }
    );
    expect(res.status).toBe(200);
    const claimant = await res.json();

    expect(claimant.id).toBe(claimantProfileId);
    expect(claimant.legalName).toBe(legalName);
    expect(claimant.prefix).toBe('DR');
    expect(claimant.suffix).toBe('JR');
    expect(claimant.gender).toBe('Non-binary');
    expect(claimant.claims).toHaveLength(1);
    expect(claimant.claims[0].id).toBe(claimId);
    expect(claimant.claims[0].certifications[0].id).toBe(certificationId);
    expect(claimant.claims[0].caseNotes[0].id).toBe(caseNoteId);
    expect(claimant.matchedEmploymentEvents).toBeUndefined();
    expect(claimant.timeline).toHaveLength(1);
    expect(claimant.timeline[0].title).toBe('Hired');
    expect(claimant.timeline[0].detail).toBe('Test Employer Corp');
  });

  it('never leaks passwordHash or ssnEncrypted from the detail route', async () => {
    const res = await getClaimantDetail(
      new Request(`http://localhost/api/staff/claimants/${claimantProfileId}`),
      { params: { id: claimantProfileId } }
    );
    expectNoSensitiveFields(await res.json(), [claimantPasswordHash, ssnCiphertext]);
  });

  it('writes an audit log entry when a caseworker views a claimant record, attributed to the session', async () => {
    const res = await getClaimantDetail(
      new Request(`http://localhost/api/staff/claimants/${claimantProfileId}`),
      { params: { id: claimantProfileId } }
    );
    expect(res.status).toBe(200);

    const log = await prisma.auditLog.findFirst({
      where: {
        actorUserId: caseworkerUserId,
        action: 'CLAIMANT_RECORD_VIEWED',
        targetEntity: 'ClaimantProfile',
        targetId: claimantProfileId,
      },
    });
    expect(log).not.toBeNull();
  });

  it('does not write an audit log entry for a claimant id that does not exist', async () => {
    await getClaimantDetail(
      new Request('http://localhost/api/staff/claimants/does-not-exist'),
      { params: { id: 'does-not-exist' } }
    );
    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'ClaimantProfile', targetId: 'does-not-exist' },
    });
    expect(log).toBeNull();
  });

  it('rejects a CLAIMANT session on the detail route with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await getClaimantDetail(
      new Request(`http://localhost/api/staff/claimants/${claimantProfileId}`),
      { params: { id: claimantProfileId } }
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 for a claimant id that does not exist', async () => {
    const res = await getClaimantDetail(
      new Request('http://localhost/api/staff/claimants/does-not-exist'),
      { params: { id: 'does-not-exist' } }
    );
    expect(res.status).toBe(404);
  });

  afterAll(async () => {
    // The detail route now writes AuditLog rows (actorUserId: caseworkerUserId)
    // on every successful fetch — must clear those before the FK-referenced
    // users can be deleted below.
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.caseNote.deleteMany({ where: { claimId } });
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
