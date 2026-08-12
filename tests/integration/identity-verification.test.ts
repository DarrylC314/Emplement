import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST as startVerification } from '@/app/api/identity-verification/start/route';
import { POST as callbackVerification } from '@/app/api/identity-verification/callback/route';

// This test calls the route handlers directly with a mocked session header
// approach is simplified here: routes read claimantProfileId from the body
// for testability, with real session enforcement covered by Task 10's RBAC
// helper (unit tested separately) and the E2E suite in Task 20.

describe('identity verification flow', () => {
  let claimantProfileId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `idv-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    claimantProfileId = profile.id;
  });

  it('starts a verification attempt and returns a mock reference id', async () => {
    const req = new Request('http://localhost/api/identity-verification/start', {
      method: 'POST',
      body: JSON.stringify({ claimantProfileId }),
    });
    const res = await startVerification(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mockReferenceId).toBeTruthy();
  });

  it('completes verification via callback and encrypts the SSN', async () => {
    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId,
        legalName: 'Jane Doe',
        dateOfBirth: '1990-01-15',
        ssn: '123-45-6789',
        phone: '5551234567',
        mailingAddress: '123 Main St, Jefferson City, MO 65101',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(200);

    const profile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
    expect(profile?.identityVerificationStatus).toBe('VERIFIED');
    expect(profile?.ssnEncrypted).not.toContain('123-45-6789');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'ClaimantProfile', targetId: claimantProfileId, action: 'IDENTITY_VERIFIED' },
    });
    expect(log).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetId: claimantProfileId } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: claimantProfileId } });
    const profile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
    if (profile) {
      await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
      await prisma.user.delete({ where: { id: profile.userId } });
    }
    await prisma.$disconnect();
  });
});
