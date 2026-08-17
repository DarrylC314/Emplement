import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listPending } from '@/app/api/employer/verification-requests/route';
import { POST as respond } from '@/app/api/employer/verification-requests/[id]/respond/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer verification-request response routes', () => {
  let orgUserId: string;
  let orgProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let authorizedRequestId: string;
  let secondAuthorizedRequestId: string;

  beforeAll(async () => {
    const orgUser = await prisma.user.create({
      data: { email: `evr-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'EVR Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `evr-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id, legalName: 'EVR Claimant' } });
    claimantProfileId = claimantProfile.id;

    const authorizedRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'EDUCATION', requestedByUserId: claimantUserId, status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    authorizedRequestId = authorizedRequest.id;

    const secondAuthorizedRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'EDUCATION', requestedByUserId: claimantUserId, status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    secondAuthorizedRequestId = secondAuthorizedRequest.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: orgUserId, role: 'EMPLOYER', employerProfileId: orgProfileId, email: 'org@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('lists AUTHORIZED requests targeting the caller\'s organization', async () => {
    const res = await listPending();
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.some((r: { id: string }) => r.id === authorizedRequestId)).toBe(true);
  });

  it('confirms a request, creating a matched CredentialRecord', async () => {
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${authorizedRequestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          title: 'Bachelor of Science in Computer Science',
          eventDate: '2018-05-15',
          details: { schemaVersion: 1, major: 'Computer Science' },
        }),
      }),
      { params: { id: authorizedRequestId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentialRecordId).toBeTruthy();

    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: authorizedRequestId } });
    expect(request?.status).toBe('CONFIRMED');
    expect(request?.resultingCredentialRecordId).toBe(body.credentialRecordId);

    const record = await prisma.credentialRecord.findUnique({ where: { id: body.credentialRecordId } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
    expect(record?.reportedVia).toBe('REQUEST_RESPONSE');
    expect(record?.type).toBe('EDUCATION');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'CredentialVerificationRequest', targetId: authorizedRequestId, action: 'CREDENTIAL_VERIFICATION_CONFIRMED' },
    });
    expect(log).not.toBeNull();
  });

  it('denies a request with no record found, creating no CredentialRecord', async () => {
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${secondAuthorizedRequestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: false, responseNote: 'No record matching this name found.' }),
      }),
      { params: { id: secondAuthorizedRequestId } }
    );
    expect(res.status).toBe(200);
    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: secondAuthorizedRequestId } });
    expect(request?.status).toBe('NO_RECORD_FOUND');
    expect(request?.resultingCredentialRecordId).toBeNull();
  });

  it('returns 409 responding to an already-resolved request', async () => {
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${authorizedRequestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: false }),
      }),
      { params: { id: authorizedRequestId } }
    );
    expect(res.status).toBe(409);
  });

  it('returns 400 when confirming details fail type-specific validation', async () => {
    const staleRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'MILITARY_SERVICE', requestedByUserId: claimantUserId, status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${staleRequest.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: true, title: 'Service record', eventDate: '2015-01-01', details: { schemaVersion: 1 } }),
      }),
      { params: { id: staleRequest.id } }
    );
    expect(res.status).toBe(400);
    await prisma.credentialVerificationRequest.delete({ where: { id: staleRequest.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: orgUserId } });
    await prisma.credentialRecord.deleteMany({ where: { organizationId: orgProfileId } });
    await prisma.credentialVerificationRequest.deleteMany({ where: { organizationId: orgProfileId } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
