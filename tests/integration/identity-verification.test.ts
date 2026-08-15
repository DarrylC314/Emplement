import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { RATE_LIMIT_MAX_ATTEMPTS, resetRateLimits } from '@/lib/rateLimit';
import { hashSSN } from '@/lib/ssnHash';
import { POST as startVerification } from '@/app/api/identity-verification/start/route';
import { POST as callbackVerification } from '@/app/api/identity-verification/callback/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

// This test calls the route handlers directly with a mocked session.
// The session mock is set dynamically in beforeAll once the real
// claimantProfileId fixture exists, so ownership enforcement (a CLAIMANT
// session's claimantProfileId must match the id the request acts on) passes.

describe('identity verification flow', () => {
  let claimantProfileId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `idv-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    claimantProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
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
    expect(profile?.ssnHash).toBe(hashSSN('123-45-6789'));

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'ClaimantProfile', targetId: claimantProfileId, action: 'IDENTITY_VERIFIED' },
    });
    expect(log).not.toBeNull();
  });

  it('stores prefix, suffix, and gender when provided', async () => {
    const user = await prisma.user.create({
      data: { email: `idv-identity-fields-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: profile.id,
        legalName: 'Alex Rivera',
        dateOfBirth: '1985-06-20',
        ssn: '321-54-9876',
        phone: '5559876543',
        mailingAddress: '456 Oak Ave, Jefferson City, MO 65101',
        prefix: 'DR',
        suffix: 'III',
        gender: 'Non-binary',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(200);

    const updated = await prisma.claimantProfile.findUnique({ where: { id: profile.id } });
    expect(updated?.prefix).toBe('DR');
    expect(updated?.suffix).toBe('III');
    expect(updated?.gender).toBe('Non-binary');

    await prisma.auditLog.deleteMany({ where: { targetId: profile.id } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profile.id } });
    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });

    // Restore the original session for any subsequent tests
    const originalProfile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
    const originalUser = await prisma.user.findUnique({ where: { id: originalProfile!.userId } });
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: originalUser!.id, role: 'CLAIMANT', claimantProfileId: claimantProfileId, email: originalUser!.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('leaves prefix, suffix, and gender null when omitted', async () => {
    const user = await prisma.user.create({
      data: { email: `idv-identity-fields-omitted-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: profile.id,
        legalName: 'Sam Chen',
        dateOfBirth: '1992-03-11',
        ssn: '654-32-1098',
        phone: '5551112222',
        mailingAddress: '789 Pine St, Jefferson City, MO 65101',
        prefix: '',
        suffix: '',
        gender: '',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(200);

    const updated = await prisma.claimantProfile.findUnique({ where: { id: profile.id } });
    expect(updated?.prefix).toBeNull();
    expect(updated?.suffix).toBeNull();
    expect(updated?.gender).toBeNull();

    await prisma.auditLog.deleteMany({ where: { targetId: profile.id } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profile.id } });
    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });

    // Restore the original session for any subsequent tests
    const originalProfile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
    const originalUser = await prisma.user.findUnique({ where: { id: originalProfile!.userId } });
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: originalUser!.id, role: 'CLAIMANT', claimantProfileId: claimantProfileId, email: originalUser!.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('rate limits repeated verification starts and refuses with 429', async () => {
    resetRateLimits();
    const makeRequest = () =>
      new Request('http://localhost/api/identity-verification/start', {
        method: 'POST',
        body: JSON.stringify({ claimantProfileId }),
      });

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const allowed = await startVerification(makeRequest());
      expect(allowed.status).toBe(200);
    }

    const blocked = await startVerification(makeRequest());
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/too many/i);

    resetRateLimits();
  });

  it('rejects a malformed JSON body with a clean 400', async () => {
    resetRateLimits();
    const res = await startVerification(
      new Request('http://localhost/api/identity-verification/start', {
        method: 'POST',
        body: 'not-json',
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
  });

  it('returns a clean 409 (never revealing the SSN belongs to another profile) on a duplicate SSN', async () => {
    const otherUser = await prisma.user.create({
      data: { email: `idv-test-dup-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const otherProfile = await prisma.claimantProfile.create({ data: { userId: otherUser.id } });

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: otherUser.id, role: 'CLAIMANT', claimantProfileId: otherProfile.id, email: otherUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: otherProfile.id,
        legalName: 'Jane Doe',
        dateOfBirth: '1990-01-15',
        ssn: '123-45-6789', // same SSN used by claimantProfileId above
        phone: '5551234567',
        mailingAddress: '123 Main St, Jefferson City, MO 65101',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).not.toMatch(/ssn/i);
    expect(body.error).not.toMatch(/already registered|belongs to another/i);

    const log = await prisma.auditLog.findFirst({
      where: {
        targetEntity: 'ClaimantProfile',
        targetId: otherProfile.id,
        action: 'IDENTITY_VERIFICATION_SSN_CONFLICT',
      },
    });
    expect(log).not.toBeNull();

    // Restore the original session for any subsequent tests/afterAll.
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: otherUser.id, role: 'CLAIMANT', claimantProfileId: otherProfile.id, email: otherUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    await prisma.auditLog.deleteMany({ where: { targetId: otherProfile.id } });
    await prisma.claimantProfile.delete({ where: { id: otherProfile.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
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
