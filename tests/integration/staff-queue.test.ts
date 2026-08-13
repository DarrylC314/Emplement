import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { GET as getQueue } from '@/app/api/staff/queue/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: 'mock-caseworker-user-id', role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
}));

describe('GET /api/staff/queue', () => {
  let claimId: string;
  let claimantProfileId: string;
  let userId: string;
  let flaggedCertId: string;
  let approvedCertId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `queue-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    claimantProfileId = profile.id;
    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const flagged = await prisma.weeklyCertification.create({
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
    flaggedCertId = flagged.id;

    const approved = await prisma.weeklyCertification.create({
      data: {
        claimId,
        weekEndingDate: new Date('2026-08-08'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'APPROVED',
        autoDecisionReason: 'All eligibility criteria met.',
      },
    });
    approvedCertId = approved.id;
  });

  it('returns only flagged certifications without an existing review action', async () => {
    const res = await getQueue(new Request('http://localhost/api/staff/queue'));
    const queue = await res.json();
    const ids = queue.map((c: { id: string }) => c.id);
    expect(ids).toContain(flaggedCertId);
    expect(ids).not.toContain(approvedCertId);
  });

  afterAll(async () => {
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
