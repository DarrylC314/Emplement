import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { PATCH } from '@/app/api/wage-records/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('PATCH /api/wage-records/[id]', () => {
  let userId: string;
  let claimantProfileId: string;
  let claimId: string;
  let recordId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `wage-record-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    claimantProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

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

    const record = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'Acme Manufacturing LLC',
        fein: '43-1234567',
        workLocation: 'Jefferson City, MO',
        jobTitle: 'Machinist',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 22.5,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    recordId = record.id;
  });

  it('confirms a wage record as-is', async () => {
    const req = new Request(`http://localhost/api/wage-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true }),
    });
    const res = await PATCH(req, { params: { id: recordId } });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.claimantConfirmed).toBe(true);
    expect(updated.claimantDisputeNote).toBeNull();
  });

  it('applies a correction and dispute note', async () => {
    const req = new Request(`http://localhost/api/wage-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        confirmed: true,
        disputeNote: 'This was actually part-time, 20 hours a week.',
        hoursPerWeek: 20,
      }),
    });
    const res = await PATCH(req, { params: { id: recordId } });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(Number(updated.hoursPerWeek)).toBe(20);
    expect(updated.claimantDisputeNote).toBe('This was actually part-time, 20 hours a week.');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'WageRecord', targetId: recordId, action: 'WAGE_RECORD_CORRECTED' },
    });
    expect(log).not.toBeNull();
  });

  it('rejects updating a wage record the caller does not own', async () => {
    const otherUser = await prisma.user.create({
      data: { email: `wage-record-other-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherUser.id, role: 'CLAIMANT', claimantProfileId: 'not-the-owner', email: otherUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request(`http://localhost/api/wage-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true }),
    });
    const res = await PATCH(req, { params: { id: recordId } });
    expect(res.status).toBe(403);

    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'WageRecord', targetId: recordId } });
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
