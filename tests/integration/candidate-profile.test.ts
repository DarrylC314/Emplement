import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as getOwnProfile, POST as createProfile } from '@/app/api/candidate-profile/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('candidate profile routes', () => {
  let verifiedUserId: string;
  let verifiedProfileId: string;
  let unverifiedUserId: string;
  let unverifiedProfileId: string;

  beforeAll(async () => {
    const verifiedUser = await prisma.user.create({
      data: { email: `candidate-verified-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    verifiedUserId = verifiedUser.id;
    const verifiedProfile = await prisma.claimantProfile.create({
      data: {
        userId: verifiedUser.id,
        legalName: 'Verified Candidate',
        ssnHash: `candidate-test-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    verifiedProfileId = verifiedProfile.id;

    const unverifiedUser = await prisma.user.create({
      data: { email: `candidate-unverified-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    unverifiedUserId = unverifiedUser.id;
    const unverifiedProfile = await prisma.claimantProfile.create({ data: { userId: unverifiedUser.id } });
    unverifiedProfileId = unverifiedProfile.id;
  });

  it('rejects creation for an unverified claimant with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: unverifiedUserId, role: 'CLAIMANT', claimantProfileId: unverifiedProfileId, email: 'unverified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Cook', skills: 'Line cooking', availability: 'Weekends' }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(403);
  });

  it('creates a candidate profile for a verified claimant', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: verifiedUserId, role: 'CLAIMANT', claimantProfileId: verifiedProfileId, email: 'verified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Warehouse associate', skills: 'Forklift certified', availability: 'Immediate' }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.headline).toBe('Warehouse associate');

    const getRes = await getOwnProfile();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.id).toBe(body.id);
    expect(getBody.headline).toBe('Warehouse associate');
    expect(getBody.claimantProfileId).toBeUndefined();
  });

  it('rejects a duplicate profile with 409', async () => {
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Another headline', skills: 'Other skills', availability: 'Flexible' }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(409);
  });

  it('creates a candidate profile with tags', async () => {
    const taggedUser = await prisma.user.create({
      data: { email: `candidate-tagged-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const taggedProfile = await prisma.claimantProfile.create({
      data: {
        userId: taggedUser.id,
        ssnHash: `candidate-tagged-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    const taggedSession = {
      user: { id: taggedUser.id, role: 'CLAIMANT', claimantProfileId: taggedProfile.id, email: taggedUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    };
    vi.mocked(getServerAuthSession).mockResolvedValueOnce(taggedSession);
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({
        headline: 'Paramedic',
        skills: 'Emergency response',
        availability: 'On call',
        tags: ['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE'],
      }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    vi.mocked(getServerAuthSession).mockResolvedValueOnce(taggedSession);
    const getRes = await getOwnProfile();
    const getBody = await getRes.json();
    expect(getBody.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    await prisma.candidateProfile.delete({ where: { claimantProfileId: taggedProfile.id } });
    await prisma.claimantProfile.delete({ where: { id: taggedProfile.id } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: taggedUser.id } });
    await prisma.user.delete({ where: { id: taggedUser.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [verifiedUserId, unverifiedUserId] } } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: verifiedProfileId } });
    await prisma.claimantProfile.delete({ where: { id: verifiedProfileId } });
    await prisma.user.delete({ where: { id: verifiedUserId } });
    await prisma.claimantProfile.delete({ where: { id: unverifiedProfileId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
    await prisma.$disconnect();
  });
});
