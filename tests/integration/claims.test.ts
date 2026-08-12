import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST, GET } from '@/app/api/claims/route';

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
