import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/certifications/[id]/review/route';
import { PATCH } from '@/app/api/staff/claimants/[id]/route';

describe('review action + claimant record editing', () => {
  let claimId: string;
  let certId: string;
  let claimantProfileId: string;
  let claimantUserId: string;
  let caseworkerId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `review-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'Original Name' },
    });
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
    const cert = await prisma.weeklyCertification.create({
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
    certId = cert.id;
    const caseworker = await prisma.user.create({
      data: { email: `review-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;
  });

  it('approves a flagged certification and reactivates the claim', async () => {
    const req = new Request(`http://localhost/api/certifications/${certId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'APPROVED',
        reason: 'Confirmed job search activity by phone with all listed employers.',
      }),
    });
    const res = await POST(req, { params: { id: certId } });
    expect(res.status).toBe(201);

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('ACTIVE');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'ClaimReviewAction', action: 'CLAIM_REVIEWED' },
    });
    expect(log).not.toBeNull();
  });

  it('updates claimant record fields and writes an audit log', async () => {
    const req = new Request(`http://localhost/api/staff/claimants/${claimantProfileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ caseworkerId, legalName: 'Corrected Name' }),
    });
    const res = await PATCH(req, { params: { id: claimantProfileId } });
    expect(res.status).toBe(200);

    const profile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
    expect(profile?.legalName).toBe('Corrected Name');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'ClaimantProfile', action: 'CLAIMANT_RECORD_EDITED' },
    });
    expect(log).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetId: { in: [certId, claimantProfileId] } }, { actorUserId: caseworkerId }] },
    });
    await prisma.claimReviewAction.deleteMany({ where: { weeklyCertificationId: certId } });
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
