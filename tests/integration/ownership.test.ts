import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';

// Consolidated negative-path coverage for every ownership (IDOR) check added
// in Task 22: a CLAIMANT session for claimant A must never be able to read
// or write claimant B's data via a client-supplied id, on any of the 7
// routes that carry an ownership check. Every test below authenticates as A
// (a real session, via the dynamic-mock pattern) and targets a resource that
// belongs to B, asserting 403 and, where the route would otherwise perform
// a write, that no side effect occurred.

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

import { POST as callbackVerification } from '@/app/api/identity-verification/callback/route';
import { POST as startVerification } from '@/app/api/identity-verification/start/route';
import { POST as createClaim, GET as listClaims } from '@/app/api/claims/route';
import { GET as claimDetail } from '@/app/api/claims/[id]/route';
import { POST as submitCertification } from '@/app/api/certifications/route';
import { GET as listMessages } from '@/app/api/messages/route';

describe('cross-claimant ownership enforcement (IDOR negative paths)', () => {
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let profileA: { id: string };
  let profileB: { id: string };
  let claimB: { id: string };

  function mockSessionA() {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: userA.id, role: 'CLAIMANT', claimantProfileId: profileA.id, email: userA.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  }

  beforeAll(async () => {
    userA = await prisma.user.create({
      data: { email: `ownership-a-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    profileA = await prisma.claimantProfile.create({
      data: { userId: userA.id, identityVerificationStatus: 'VERIFIED' },
    });
    userB = await prisma.user.create({
      data: { email: `ownership-b-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    profileB = await prisma.claimantProfile.create({
      data: { userId: userB.id, identityVerificationStatus: 'VERIFIED' },
    });
    claimB = await prisma.claim.create({
      data: {
        claimantId: profileB.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });

    mockSessionA();
  });

  it('rejects identity-verification/start when claimantProfileId belongs to another claimant', async () => {
    const before = await prisma.identityVerificationAttempt.count({ where: { claimantId: profileB.id } });
    const req = new Request('http://localhost/api/identity-verification/start', {
      method: 'POST',
      body: JSON.stringify({ claimantProfileId: profileB.id }),
    });
    const res = await startVerification(req);
    expect(res.status).toBe(403);
    const after = await prisma.identityVerificationAttempt.count({ where: { claimantId: profileB.id } });
    expect(after).toBe(before);
  });

  it('rejects identity-verification/callback when claimantProfileId belongs to another claimant', async () => {
    const before = await prisma.claimantProfile.findUnique({ where: { id: profileB.id } });
    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: profileB.id,
        legalName: 'Attacker Supplied Name',
        dateOfBirth: '1990-01-15',
        ssn: '999-99-9999',
        phone: '5551234567',
        mailingAddress: '1 Attacker Way',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(403);
    const after = await prisma.claimantProfile.findUnique({ where: { id: profileB.id } });
    expect(after?.legalName).toBe(before?.legalName);
    expect(after?.ssnEncrypted).toBe(before?.ssnEncrypted);
  });

  it('rejects claims POST when claimantProfileId belongs to another claimant', async () => {
    const before = await prisma.claim.count({ where: { claimantId: profileB.id } });
    const req = new Request('http://localhost/api/claims', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: profileB.id,
        employmentHistory: 'Attacker-supplied employment history.',
        reasonForSeparation: 'LAYOFF',
        benefitYearStart: '2026-08-11',
      }),
    });
    const res = await createClaim(req);
    expect(res.status).toBe(403);
    const after = await prisma.claim.count({ where: { claimantId: profileB.id } });
    expect(after).toBe(before);
  });

  it('rejects claims GET when claimantProfileId belongs to another claimant', async () => {
    const req = new Request(`http://localhost/api/claims?claimantProfileId=${profileB.id}`);
    const res = await listClaims(req);
    expect(res.status).toBe(403);
  });

  it('rejects claims/[id] GET when the claim belongs to another claimant', async () => {
    const req = new Request(`http://localhost/api/claims/${claimB.id}`);
    const res = await claimDetail(req, { params: { id: claimB.id } });
    expect(res.status).toBe(403);
  });

  it('rejects certifications POST when the claim belongs to another claimant', async () => {
    const before = await prisma.weeklyCertification.count({ where: { claimId: claimB.id } });
    const req = new Request('http://localhost/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId: claimB.id,
        weekEndingDate: '2026-08-15',
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        jobSearchActivities: [
          { employerName: 'Acme', contactMethod: 'Online', contactDate: '2026-08-12', position: 'Machinist' },
          { employerName: 'Beta', contactMethod: 'Phone', contactDate: '2026-08-13', position: 'Operator' },
          { employerName: 'Gamma', contactMethod: 'In person', contactDate: '2026-08-14', position: 'Technician' },
        ],
      }),
    });
    const res = await submitCertification(req);
    expect(res.status).toBe(403);
    const after = await prisma.weeklyCertification.count({ where: { claimId: claimB.id } });
    expect(after).toBe(before);
  });

  it('rejects messages GET when claimantProfileId belongs to another claimant', async () => {
    const req = new Request(`http://localhost/api/messages?claimantProfileId=${profileB.id}`);
    const res = await listMessages(req);
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.identityVerificationAttempt.deleteMany({
      where: { claimantId: { in: [profileA.id, profileB.id] } },
    });
    await prisma.weeklyCertification.deleteMany({ where: { claimId: claimB.id } });
    await prisma.claim.deleteMany({ where: { id: claimB.id } });
    await prisma.claimantProfile.deleteMany({ where: { id: { in: [profileA.id, profileB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.$disconnect();
  });
});
