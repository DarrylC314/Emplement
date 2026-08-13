import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/case-notes/route';

// Dynamic mock: the route now derives CaseNote.caseworkerId from
// session.user.id, and that column is a real FK to User.id, so the mocked
// session must resolve to a genuine caseworker user created below.
vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
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

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworker.id, role: 'CASEWORKER', email: caseworker.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('creates a case note on a claim, attributed to the session caseworker', async () => {
    const req = new Request('http://localhost/api/case-notes', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        note: 'Called claimant to confirm job search activity for week of 8/15.',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const notes = await prisma.caseNote.findMany({ where: { claimId } });
    expect(notes).toHaveLength(1);
    // Attribution must come from the verified session, not any client input.
    expect(notes[0].caseworkerId).toBe(caseworkerId);
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
