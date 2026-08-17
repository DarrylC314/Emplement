import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as authorizeRequest } from '@/app/api/verification-requests/[id]/authorize/route';
import { POST as declineRequest } from '@/app/api/verification-requests/[id]/decline/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/verification-requests/[id]/{authorize,decline}', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let otherClaimantUserId: string;
  let otherClaimantProfileId: string;
  let orgUserId: string;
  let orgProfileId: string;
  let pendingRequestId: string;
  let secondPendingRequestId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `vr-auth-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id, legalName: 'VR Auth Claimant' } });
    claimantProfileId = claimantProfile.id;

    const otherClaimantUser = await prisma.user.create({
      data: { email: `vr-auth-other-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    otherClaimantUserId = otherClaimantUser.id;
    const otherClaimantProfile = await prisma.claimantProfile.create({ data: { userId: otherClaimantUser.id, legalName: 'VR Auth Other Claimant' } });
    otherClaimantProfileId = otherClaimantProfile.id;

    const orgUser = await prisma.user.create({
      data: { email: `vr-auth-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'VR Auth Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;

    const pendingRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'EDUCATION', requestedByUserId: claimantUserId, status: 'PENDING_AUTHORIZATION' },
    });
    pendingRequestId = pendingRequest.id;

    const secondPendingRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'CERTIFICATION', requestedByUserId: claimantUserId, status: 'PENDING_AUTHORIZATION' },
    });
    secondPendingRequestId = secondPendingRequest.id;
  });

  it('rejects authorizing someone else\'s request with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherClaimantUserId, role: 'CLAIMANT', claimantProfileId: otherClaimantProfileId, email: 'other@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request(`http://localhost/api/verification-requests/${pendingRequestId}/authorize`, { method: 'POST' }),
      { params: { id: pendingRequestId } }
    );
    expect(res.status).toBe(403);
  });

  it('authorizes a PENDING_AUTHORIZATION request owned by the caller', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request(`http://localhost/api/verification-requests/${pendingRequestId}/authorize`, { method: 'POST' }),
      { params: { id: pendingRequestId } }
    );
    expect(res.status).toBe(200);
    const updated = await prisma.credentialVerificationRequest.findUnique({ where: { id: pendingRequestId } });
    expect(updated?.status).toBe('AUTHORIZED');
    expect(updated?.authorizedAt).not.toBeNull();
  });

  it('returns 409 authorizing an already-authorized request', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request(`http://localhost/api/verification-requests/${pendingRequestId}/authorize`, { method: 'POST' }),
      { params: { id: pendingRequestId } }
    );
    expect(res.status).toBe(409);
  });

  it('declines a PENDING_AUTHORIZATION request owned by the caller', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await declineRequest(
      new Request(`http://localhost/api/verification-requests/${secondPendingRequestId}/decline`, { method: 'POST' }),
      { params: { id: secondPendingRequestId } }
    );
    expect(res.status).toBe(200);
    const updated = await prisma.credentialVerificationRequest.findUnique({ where: { id: secondPendingRequestId } });
    expect(updated?.status).toBe('DECLINED');
    expect(updated?.declinedAt).not.toBeNull();
  });

  it('returns 404 authorizing a request that does not exist', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request('http://localhost/api/verification-requests/does-not-exist/authorize', { method: 'POST' }),
      { params: { id: 'does-not-exist' } }
    );
    expect(res.status).toBe(404);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: claimantUserId } });
    await prisma.credentialVerificationRequest.deleteMany({ where: { id: { in: [pendingRequestId, secondPendingRequestId] } } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.claimantProfile.delete({ where: { id: otherClaimantProfileId } });
    await prisma.user.delete({ where: { id: otherClaimantUserId } });
    await prisma.$disconnect();
  });
});
