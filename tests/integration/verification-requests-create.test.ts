import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as createRequest, GET as listRequests } from '@/app/api/verification-requests/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/verification-requests', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let caseworkerUserId: string;
  let orgUserId: string;
  let orgProfileId: string;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `vr-create-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'VR Create Claimant' },
    });
    claimantProfileId = claimantProfile.id;

    const caseworkerUser = await prisma.user.create({
      data: { email: `vr-create-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const orgUser = await prisma.user.create({
      data: { email: `vr-create-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'VR Create Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;
  });

  it('creates a self-authorized request when a CLAIMANT session creates it', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgProfileId, credentialType: 'EDUCATION', requestedTitle: 'BS Computer Science' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdRequestIds.push(body.id);

    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: body.id } });
    expect(request?.status).toBe('AUTHORIZED');
    expect(request?.authorizedAt).not.toBeNull();
    expect(request?.claimantProfileId).toBe(claimantProfileId);
    expect(request?.requestedByUserId).toBe(claimantUserId);
  });

  it('ignores a client-supplied claimantProfileId when a CLAIMANT session creates it', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ claimantProfileId: 'someone-elses-id', organizationId: orgProfileId, credentialType: 'CERTIFICATION' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdRequestIds.push(body.id);
    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: body.id } });
    expect(request?.claimantProfileId).toBe(claimantProfileId);
  });

  it('creates a PENDING_AUTHORIZATION request when a CASEWORKER session creates it on behalf of a claimant', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ claimantProfileId, organizationId: orgProfileId, credentialType: 'MILITARY_SERVICE' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdRequestIds.push(body.id);
    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: body.id } });
    expect(request?.status).toBe('PENDING_AUTHORIZATION');
    expect(request?.authorizedAt).toBeNull();
    expect(request?.requestedByUserId).toBe(caseworkerUserId);
  });

  it('returns 400 when a CASEWORKER session omits claimantProfileId', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgProfileId, credentialType: 'EDUCATION' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the target organization is not VERIFIED', async () => {
    const unverifiedOrgUser = await prisma.user.create({
      data: { email: `vr-create-unverified-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    const unverifiedOrgProfile = await prisma.employerProfile.create({
      data: { userId: unverifiedOrgUser.id, companyName: 'Unverified Org', verificationStatus: 'PENDING' },
    });
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ organizationId: unverifiedOrgProfile.id, credentialType: 'EDUCATION' }),
      })
    );
    expect(res.status).toBe(400);
    await prisma.employerProfile.delete({ where: { id: unverifiedOrgProfile.id } });
    await prisma.user.delete({ where: { id: unverifiedOrgUser.id } });
  });

  it('lists a claimant\'s own requests via GET', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listRequests(new Request('http://localhost/api/verification-requests'));
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r: { organization: { companyName: string } }) => r.organization.companyName === 'VR Create Test University')).toBe(true);
  });

  it('requires claimantProfileId as a query param for a CASEWORKER session listing via GET', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listRequests(new Request('http://localhost/api/verification-requests'));
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [claimantUserId, caseworkerUserId] } } });
    await prisma.credentialVerificationRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
