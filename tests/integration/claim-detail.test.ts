import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/claims/[id]/route';

describe('GET /api/claims/[id]', () => {
  let claimId: string;
  let claimantProfileId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `detail-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
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
    await prisma.weeklyCertification.create({
      data: {
        claimId,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'APPROVED',
        autoDecisionReason: 'All eligibility criteria met.',
      },
    });
  });

  it('returns the claim with its certifications', async () => {
    const res = await GET(new Request(`http://localhost/api/claims/${claimId}`), {
      params: { id: claimId },
    });
    const data = await res.json();
    expect(data.id).toBe(claimId);
    expect(data.certifications).toHaveLength(1);
  });

  afterAll(async () => {
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
