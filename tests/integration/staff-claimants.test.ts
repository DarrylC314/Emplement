import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { GET as searchClaimants } from '@/app/api/staff/claimants/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: 'mock-caseworker-user-id', role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
}));

describe('GET /api/staff/claimants', () => {
  let claimId: string;
  let claimantProfileId: string;
  let claimantUserId: string;
  let caseworkerUserId: string;
  let certificationId: string;
  let caseNoteId: string;
  const legalName = `Search Target ${Date.now()}`;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `claimants-search-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;

    const caseworkerUser = await prisma.user.create({
      data: { email: `claimants-search-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName },
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

  afterAll(async () => {
    await prisma.caseNote.deleteMany({ where: { claimId } });
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
