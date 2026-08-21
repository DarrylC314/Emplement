import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { GET as listUnmatched } from '@/app/api/staff/unmatched-credentials/route';
import { POST as matchCredential } from '@/app/api/staff/unmatched-credentials/[id]/match/route';
import { POST as dismissCredential } from '@/app/api/staff/unmatched-credentials/[id]/dismiss/route';
import { POST as retryCredential } from '@/app/api/staff/unmatched-credentials/[id]/retry/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('unmatched-credentials staff review routes', () => {
  let caseworkerUserId: string;
  let orgUserId: string;
  let orgProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let unmatchedRecordId: string;
  let secondUnmatchedRecordId: string;
  let thirdUnmatchedRecordId: string;
  const targetSsn = '601-44-2299';

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `uc-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const orgUser = await prisma.user.create({
      data: { email: `uc-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'UC Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `uc-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'UC Claimant', ssnHash: hashSSN(targetSsn) },
    });
    claimantProfileId = claimantProfile.id;

    const unmatchedRecord = await prisma.credentialRecord.create({
      data: {
        organizationId: orgProfileId, type: 'CERTIFICATION', title: 'CPA',
        eventDate: new Date('2020-01-01'), details: { schemaVersion: 1, certificationName: 'CPA' },
        ssnHash: hashSSN('999-99-0001'), reportedVia: 'PROACTIVE_AGREEMENT',
      },
    });
    unmatchedRecordId = unmatchedRecord.id;

    const secondUnmatchedRecord = await prisma.credentialRecord.create({
      data: {
        organizationId: orgProfileId, type: 'CERTIFICATION', title: 'CPA',
        eventDate: new Date('2020-01-01'), details: { schemaVersion: 1, certificationName: 'CPA' },
        ssnHash: hashSSN('999-99-0002'), reportedVia: 'PROACTIVE_AGREEMENT',
      },
    });
    secondUnmatchedRecordId = secondUnmatchedRecord.id;

    const thirdUnmatchedRecord = await prisma.credentialRecord.create({
      data: {
        organizationId: orgProfileId, type: 'CERTIFICATION', title: 'CPA',
        eventDate: new Date('2020-01-01'), details: { schemaVersion: 1, certificationName: 'CPA' },
        ssnHash: hashSSN(targetSsn), reportedVia: 'PROACTIVE_AGREEMENT',
      },
    });
    thirdUnmatchedRecordId = thirdUnmatchedRecord.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('lists unmatched, non-dismissed credentials', async () => {
    const res = await listUnmatched();
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.some((r: { id: string }) => r.id === unmatchedRecordId)).toBe(true);
  });

  it('manually matches an unmatched credential by a caller-supplied SSN', async () => {
    const res = await matchCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${unmatchedRecordId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: targetSsn, note: 'Confirmed via phone call.' }),
      }),
      { params: { id: unmatchedRecordId } }
    );
    expect(res.status).toBe(200);
    const record = await prisma.credentialRecord.findUnique({ where: { id: unmatchedRecordId } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
  });

  it('returns 404 matching against an SSN with no claimant', async () => {
    const res = await matchCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${secondUnmatchedRecordId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: '111-11-1111', note: 'Attempted match.' }),
      }),
      { params: { id: secondUnmatchedRecordId } }
    );
    expect(res.status).toBe(404);
  });

  it('dismisses an unmatched credential with a note', async () => {
    const res = await dismissCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${secondUnmatchedRecordId}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Duplicate report.' }),
      }),
      { params: { id: secondUnmatchedRecordId } }
    );
    expect(res.status).toBe(200);
    const record = await prisma.credentialRecord.findUnique({ where: { id: secondUnmatchedRecordId } });
    expect(record?.dismissedAt).not.toBeNull();
  });

  it('retries matching using the credential\'s own stored ssnHash', async () => {
    const res = await retryCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${thirdUnmatchedRecordId}/retry`, { method: 'POST' }),
      { params: { id: thirdUnmatchedRecordId } }
    );
    expect(res.status).toBe(200);
    const record = await prisma.credentialRecord.findUnique({ where: { id: thirdUnmatchedRecordId } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
  });

  it('returns 409 matching an already-resolved credential', async () => {
    const res = await matchCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${unmatchedRecordId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: targetSsn, note: 'Retry.' }),
      }),
      { params: { id: unmatchedRecordId } }
    );
    expect(res.status).toBe(409);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.credentialRecord.deleteMany({ where: { organizationId: orgProfileId } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
