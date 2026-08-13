import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/certifications/[id]/review/route';
import { PATCH } from '@/app/api/staff/claimants/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: 'mock-caseworker-user-id', role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
}));

describe('review action + claimant record editing', () => {
  let claimId: string;
  let certId: string;
  let deniedClaimId: string;
  let deniedCertId: string;
  let fraudClaimId: string;
  let fraudCertId: string;
  let amountClaimId: string;
  let amountCertId: string;
  let invalidAmountClaimId: string;
  let invalidAmountCertId: string;
  let claimantProfileId: string;
  let claimantUserId: string;
  let caseworkerId: string;
  const extraCertIds: string[] = [];
  const extraClaimIds: string[] = [];

  async function makeClaimWithCert(status: 'RESTRICTED' | 'ACTIVE' = 'RESTRICTED') {
    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status,
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    const cert = await prisma.weeklyCertification.create({
      data: {
        claimId: claim.id,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'FLAGGED',
        autoDecisionReason: 'Fewer than 3 job-search contacts.',
      },
    });
    extraClaimIds.push(claim.id);
    extraCertIds.push(cert.id);
    return { claimId: claim.id, certId: cert.id };
  }

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

    ({ claimId: deniedClaimId, certId: deniedCertId } = await makeClaimWithCert());
    ({ claimId: fraudClaimId, certId: fraudCertId } = await makeClaimWithCert('ACTIVE'));
    ({ claimId: amountClaimId, certId: amountCertId } = await makeClaimWithCert('ACTIVE'));
    ({ claimId: invalidAmountClaimId, certId: invalidAmountCertId } = await makeClaimWithCert('ACTIVE'));
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

  it('denies a flagged certification and sets the claim status to DENIED', async () => {
    const req = new Request(`http://localhost/api/certifications/${deniedCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'DENIED',
        reason: 'Claimant did not meet the able-and-available requirement for this week.',
      }),
    });
    const res = await POST(req, { params: { id: deniedCertId } });
    expect(res.status).toBe(201);

    const claim = await prisma.claim.findUnique({ where: { id: deniedClaimId } });
    expect(claim?.status).toBe('DENIED');
  });

  it('flags a certification for fraud and restricts the claim', async () => {
    const req = new Request(`http://localhost/api/certifications/${fraudCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'FLAGGED_FOR_FRAUD',
        reason: 'Reported earnings do not match wage records on file for this week.',
      }),
    });
    const res = await POST(req, { params: { id: fraudCertId } });
    expect(res.status).toBe(201);

    const claim = await prisma.claim.findUnique({ where: { id: fraudClaimId } });
    expect(claim?.status).toBe('RESTRICTED');
  });

  it('adjusts the weekly benefit amount and records the previous value', async () => {
    const req = new Request(`http://localhost/api/certifications/${amountCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'AMOUNT_ADJUSTED',
        reason: 'Corrected weekly benefit amount after wage recalculation.',
        newValue: '410',
      }),
    });
    const res = await POST(req, { params: { id: amountCertId } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.previousValue).toBe('320');

    const claim = await prisma.claim.findUnique({ where: { id: amountClaimId } });
    expect(Number(claim?.weeklyBenefitAmount)).toBe(410);
    expect(claim?.status).toBe('ACTIVE');
  });

  it('rejects AMOUNT_ADJUSTED with a missing or invalid newValue', async () => {
    const missingReq = new Request(`http://localhost/api/certifications/${invalidAmountCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'AMOUNT_ADJUSTED',
        reason: 'Attempting an adjustment without a new amount.',
      }),
    });
    const missingRes = await POST(missingReq, { params: { id: invalidAmountCertId } });
    expect(missingRes.status).toBe(400);

    const invalidReq = new Request(`http://localhost/api/certifications/${invalidAmountCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'AMOUNT_ADJUSTED',
        reason: 'Attempting an adjustment with a non-numeric amount.',
        newValue: 'not-a-number',
      }),
    });
    const invalidRes = await POST(invalidReq, { params: { id: invalidAmountCertId } });
    expect(invalidRes.status).toBe(400);

    const zeroReq = new Request(`http://localhost/api/certifications/${invalidAmountCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId,
        action: 'AMOUNT_ADJUSTED',
        reason: 'Attempting an adjustment with a non-positive amount.',
        newValue: '0',
      }),
    });
    const zeroRes = await POST(zeroReq, { params: { id: invalidAmountCertId } });
    expect(zeroRes.status).toBe(400);

    const claim = await prisma.claim.findUnique({ where: { id: invalidAmountClaimId } });
    expect(Number(claim?.weeklyBenefitAmount)).toBe(320);
    const reviewActions = await prisma.claimReviewAction.findMany({
      where: { weeklyCertificationId: invalidAmountCertId },
    });
    expect(reviewActions.length).toBe(0);
  });

  it('rejects a review action with a missing caseworkerId', async () => {
    const req = new Request(`http://localhost/api/certifications/${invalidAmountCertId}/review`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'APPROVED',
        reason: 'No caseworkerId provided on this request.',
      }),
    });
    const res = await POST(req, { params: { id: invalidAmountCertId } });
    expect(res.status).toBe(400);
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
    const allCertIds = [certId, ...extraCertIds];
    const allClaimIds = [claimId, ...extraClaimIds];

    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ targetId: { in: [certId, claimantProfileId] } }, { actorUserId: caseworkerId }],
      },
    });
    await prisma.claimReviewAction.deleteMany({ where: { weeklyCertificationId: { in: allCertIds } } });
    await prisma.weeklyCertification.deleteMany({ where: { claimId: { in: allClaimIds } } });
    await prisma.claim.deleteMany({ where: { id: { in: allClaimIds } } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
