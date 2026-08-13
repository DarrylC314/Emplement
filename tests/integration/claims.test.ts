import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST, GET } from '@/app/api/claims/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('claims API', () => {
  let claimantProfileId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `claims-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({
      data: { userId: user.id, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('creates a new active claim with a default weekly benefit amount', async () => {
    const req = new Request('http://localhost/api/claims', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId,
        employmentHistory: 'Worked at Acme Corp for 3 years as a machinist.',
        reasonForSeparation: 'LAYOFF',
        benefitYearStart: '2026-08-11',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const claim = await res.json();
    expect(claim.status).toBe('ACTIVE');
  });

  it('lists claims for a claimant', async () => {
    const req = new Request(`http://localhost/api/claims?claimantProfileId=${claimantProfileId}`);
    const res = await GET(req);
    const claims = await res.json();
    expect(claims.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    const claims = await prisma.claim.findMany({ where: { claimantId: claimantProfileId } });
    await prisma.auditLog.deleteMany({
      where: { targetEntity: 'Claim', targetId: { in: claims.map((c) => c.id) } },
    });
    await prisma.claim.deleteMany({ where: { claimantId: claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.deleteMany({ where: { email: { contains: 'claims-test-' } } });
    await prisma.$disconnect();
  });
});
