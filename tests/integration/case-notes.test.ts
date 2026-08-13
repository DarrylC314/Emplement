import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/case-notes/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: 'mock-caseworker-user-id', role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
}));

describe('POST /api/case-notes', () => {
  let claimId: string;
  let claimantProfileId: string;
  let claimantUserId: string;
  let caseworkerId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `note-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
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
    const caseworker = await prisma.user.create({
      data: { email: `note-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;
  });

  it('creates a case note on a claim', async () => {
    const req = new Request('http://localhost/api/case-notes', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        caseworkerId,
        note: 'Called claimant to confirm job search activity for week of 8/15.',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const notes = await prisma.caseNote.findMany({ where: { claimId } });
    expect(notes).toHaveLength(1);
  });

  afterAll(async () => {
    await prisma.caseNote.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
