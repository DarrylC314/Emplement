import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/wage-lookup/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/wage-lookup', () => {
  let userId: string;
  let claimantProfileId: string;
  let claimId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `wage-lookup-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
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
  });

  it('creates wage records for a claim and writes an audit log', async () => {
    const req = new Request('http://localhost/api/wage-lookup', {
      method: 'POST',
      body: JSON.stringify({ claimId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const records = await res.json();
    expect(Array.isArray(records)).toBe(true);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Claim', targetId: claimId, action: 'WAGE_LOOKUP_PERFORMED' },
    });
    expect(log).not.toBeNull();
  });

  it('is idempotent: a second lookup returns the same records instead of creating duplicates', async () => {
    const before = await prisma.wageRecord.count({ where: { claimId } });
    const req = new Request('http://localhost/api/wage-lookup', {
      method: 'POST',
      body: JSON.stringify({ claimId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const after = await prisma.wageRecord.count({ where: { claimId } });
    expect(after).toBe(before);
  });

  it('rejects a lookup for a claim the caller does not own', async () => {
    const otherUser = await prisma.user.create({
      data: { email: `wage-lookup-other-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const otherProfile = await prisma.claimantProfile.create({ data: { userId: otherUser.id } });
    const otherClaim = await prisma.claim.create({
      data: {
        claimantId: otherProfile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });

    const req = new Request('http://localhost/api/wage-lookup', {
      method: 'POST',
      body: JSON.stringify({ claimId: otherClaim.id }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);

    await prisma.claim.delete({ where: { id: otherClaim.id } });
    await prisma.claimantProfile.delete({ where: { id: otherProfile.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'Claim', targetId: claimId } });
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
