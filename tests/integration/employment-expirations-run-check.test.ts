import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as runCheck } from '@/app/api/staff/employment-expirations/run-check/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/employment-expirations/run-check', () => {
  let caseworkerUserId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimId: string;
  let employmentEventId: string;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: 'system@emplement.internal' },
      update: {},
      create: { email: 'system@emplement.internal', passwordHash: 'x', role: 'ADMIN' },
    });

    const caseworkerUser = await prisma.user.create({
      data: { email: `run-check-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const employerUser = await prisma.user.create({
      data: { email: `run-check-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Run Check Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `run-check-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: hashSSN('601-77-2233'), identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Run Check Claimant',
        ssnHash: hashSSN('601-77-2233'),
        eventDate: new Date('2026-08-01'),
        expectedEndDate: new Date('2026-08-02'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    employmentEventId = event.id;
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await runCheck();
    expect(res.status).toBe(403);
  });

  it('runs the check for a CASEWORKER session and returns the full summary', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await runCheck();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recordsEvaluated).toBeGreaterThanOrEqual(1);
    expect(body.separationsCreated).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.failures)).toBe(true);

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('ACTIVE');
  });

  afterAll(async () => {
    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'EmploymentEvent', targetId: { in: [employmentEventId, separation?.id ?? ''] } } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    if (separation) await prisma.employmentEvent.delete({ where: { id: separation.id } });
    await prisma.employmentEvent.delete({ where: { id: employmentEventId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
