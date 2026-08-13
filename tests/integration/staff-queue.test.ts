import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { encryptSSN } from '@/lib/encryption';
import { expectNoSensitiveFields } from '../helpers/pii';
import { GET as getQueue } from '@/app/api/staff/queue/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: 'mock-caseworker-user-id', role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
}));

describe('GET /api/staff/queue', () => {
  let claimId: string;
  let claimantProfileId: string;
  let userId: string;
  let flaggedCertId: string;
  let approvedCertId: string;
  // Distinctive values so the PII-leak assertion below is meaningful: if the
  // route ever reverts to `include: { claim: { include: { claimant: true } } }`,
  // these exact strings appear in the response body.
  const claimantPasswordHash = `sentinel-password-hash-${Date.now()}`;
  const ssnCiphertext = encryptSSN('123-45-6789');

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `queue-test-${Date.now()}@example.com`,
        passwordHash: claimantPasswordHash,
        role: 'CLAIMANT',
      },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: user.id, ssnEncrypted: ssnCiphertext },
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

    const flagged = await prisma.weeklyCertification.create({
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
    flaggedCertId = flagged.id;

    const approved = await prisma.weeklyCertification.create({
      data: {
        claimId,
        weekEndingDate: new Date('2026-08-08'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'APPROVED',
        autoDecisionReason: 'All eligibility criteria met.',
      },
    });
    approvedCertId = approved.id;
  });

  it('returns only flagged certifications without an existing review action', async () => {
    const res = await getQueue(new Request('http://localhost/api/staff/queue'));
    const queue = await res.json();
    const ids = queue.map((c: { id: string }) => c.id);
    expect(ids).toContain(flaggedCertId);
    expect(ids).not.toContain(approvedCertId);
  });

  it('returns the claimant fields the dashboard renders', async () => {
    const res = await getQueue(new Request('http://localhost/api/staff/queue'));
    const queue = await res.json();
    const item = queue.find((c: { id: string }) => c.id === flaggedCertId);
    expect(item.claim.claimant.id).toBe(claimantProfileId);
    expect(item.autoDecisionReason).toBe('Fewer than 3 job-search contacts.');
  });

  it('never leaks passwordHash or ssnEncrypted', async () => {
    const res = await getQueue(new Request('http://localhost/api/staff/queue'));
    expectNoSensitiveFields(await res.json(), [claimantPasswordHash, ssnCiphertext]);
  });

  afterAll(async () => {
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
