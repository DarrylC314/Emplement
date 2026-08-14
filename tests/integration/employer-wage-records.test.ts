import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET } from '@/app/api/employer/wage-records/route';
import { PATCH } from '@/app/api/employer/wage-records/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer wage-record routes', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let wageRecordId: string;
  let otherWageRecordId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `employer-wage-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '55-5555555', companyName: 'Test Employer', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUser.id, role: 'EMPLOYER', employerProfileId: employerProfile.id, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claimantUser = await prisma.user.create({
      data: { email: `employer-wage-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
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

    const wageRecord = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'Test Employer',
        fein: '55-5555555',
        workLocation: 'Somewhere, MO',
        jobTitle: 'Tester',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 20,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    wageRecordId = wageRecord.id;

    const otherWageRecord = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'A Different Employer',
        fein: '11-1111111',
        workLocation: 'Elsewhere, MO',
        jobTitle: 'Other',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 20,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    otherWageRecordId = otherWageRecord.id;
  });

  it('GET lists only wage records matching the employer own FEIN', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const records = await res.json();
    expect(records.map((r: { id: string }) => r.id)).toEqual([wageRecordId]);
  });

  it('PATCH confirms a wage record with no dispute note', async () => {
    const req = new Request(`http://localhost/api/employer/wage-records/${wageRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: { id: wageRecordId } });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.employerVerifiedStatus).toBe('VERIFIED');
    expect(updated.employerDisputeNote).toBeNull();
  });

  it('PATCH rejects a wage record belonging to a different FEIN', async () => {
    const req = new Request(`http://localhost/api/employer/wage-records/${otherWageRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: { id: otherWageRecordId } });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUserId } });
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
