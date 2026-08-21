import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as reportCredential } from '@/app/api/employer/credentials/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/credentials', () => {
  let agreementOrgUserId: string;
  let agreementOrgProfileId: string;
  let noAgreementOrgUserId: string;
  let noAgreementOrgProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  const claimantSsn = '512-90-3344';

  beforeAll(async () => {
    const agreementOrgUser = await prisma.user.create({
      data: { email: `ec-agreement-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    agreementOrgUserId = agreementOrgUser.id;
    const agreementOrgProfile = await prisma.employerProfile.create({
      data: { userId: agreementOrgUser.id, companyName: 'EC Agreement University', verificationStatus: 'VERIFIED', credentialReportingAgreement: true },
    });
    agreementOrgProfileId = agreementOrgProfile.id;

    const noAgreementOrgUser = await prisma.user.create({
      data: { email: `ec-no-agreement-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    noAgreementOrgUserId = noAgreementOrgUser.id;
    const noAgreementOrgProfile = await prisma.employerProfile.create({
      data: { userId: noAgreementOrgUser.id, companyName: 'EC No Agreement University', verificationStatus: 'VERIFIED', credentialReportingAgreement: false },
    });
    noAgreementOrgProfileId = noAgreementOrgProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `ec-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'EC Claimant', ssnHash: hashSSN(claimantSsn) },
    });
    claimantProfileId = claimantProfile.id;
  });

  it('rejects a VERIFIED organization with no reporting agreement, with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: noAgreementOrgUserId, role: 'EMPLOYER', employerProfileId: noAgreementOrgProfileId, email: 'no-agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({
          ssn: claimantSsn,
          type: 'EDUCATION',
          title: 'BS Computer Science',
          eventDate: '2018-05-15',
          details: { schemaVersion: 1, major: 'Computer Science' },
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it('creates and auto-matches a credential for an org with a reporting agreement', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: agreementOrgUserId, role: 'EMPLOYER', employerProfileId: agreementOrgProfileId, email: 'agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({
          ssn: claimantSsn,
          type: 'EDUCATION',
          title: 'BS Computer Science',
          eventDate: '2018-05-15',
          details: { schemaVersion: 1, major: 'Computer Science' },
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const record = await prisma.credentialRecord.findUnique({ where: { id: body.id } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
    expect(record?.reportedVia).toBe('PROACTIVE_AGREEMENT');
  });

  it('creates an unmatched credential for an SSN with no matching claimant', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: agreementOrgUserId, role: 'EMPLOYER', employerProfileId: agreementOrgProfileId, email: 'agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({
          ssn: '999-88-7766',
          type: 'CERTIFICATION',
          title: 'Certified Public Accountant',
          eventDate: '2020-01-01',
          details: { schemaVersion: 1, certificationName: 'Certified Public Accountant' },
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const record = await prisma.credentialRecord.findUnique({ where: { id: body.id } });
    expect(record?.matchedClaimantProfileId).toBeNull();
  });

  it('returns 400 when details fail type-specific validation', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: agreementOrgUserId, role: 'EMPLOYER', employerProfileId: agreementOrgProfileId, email: 'agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({ ssn: claimantSsn, type: 'MILITARY_SERVICE', title: 'Service', eventDate: '2015-01-01', details: { schemaVersion: 1 } }),
      })
    );
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [agreementOrgUserId, noAgreementOrgUserId] } } });
    await prisma.credentialRecord.deleteMany({ where: { organizationId: agreementOrgProfileId } });
    await prisma.employerProfile.delete({ where: { id: agreementOrgProfileId } });
    await prisma.user.delete({ where: { id: agreementOrgUserId } });
    await prisma.employerProfile.delete({ where: { id: noAgreementOrgProfileId } });
    await prisma.user.delete({ where: { id: noAgreementOrgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
