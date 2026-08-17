import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as searchOrganizations } from '@/app/api/organizations/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('GET /api/organizations', () => {
  let verifiedUserId: string;
  let verifiedProfileId: string;
  let unverifiedUserId: string;
  let unverifiedProfileId: string;
  let claimantUserId: string;

  beforeAll(async () => {
    const verifiedUser = await prisma.user.create({
      data: { email: `org-search-verified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    verifiedUserId = verifiedUser.id;
    const verifiedProfile = await prisma.employerProfile.create({
      data: { userId: verifiedUser.id, companyName: 'Org Search Verified University', verificationStatus: 'VERIFIED' },
    });
    verifiedProfileId = verifiedProfile.id;

    const unverifiedUser = await prisma.user.create({
      data: { email: `org-search-unverified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    unverifiedUserId = unverifiedUser.id;
    const unverifiedProfile = await prisma.employerProfile.create({
      data: { userId: unverifiedUser.id, companyName: 'Org Search Unverified University', verificationStatus: 'PENDING' },
    });
    unverifiedProfileId = unverifiedProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `org-search-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId: 'irrelevant', email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('returns matching VERIFIED organizations only, never unverified ones', async () => {
    const res = await searchOrganizations(new Request('http://localhost/api/organizations?q=Org Search'));
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.some((r: { id: string }) => r.id === verifiedProfileId)).toBe(true);
    expect(results.some((r: { id: string }) => r.id === unverifiedProfileId)).toBe(false);
  });

  it('rejects an EMPLOYER session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: verifiedUserId, role: 'EMPLOYER', employerProfileId: verifiedProfileId, email: 'employer@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await searchOrganizations(new Request('http://localhost/api/organizations?q=Org'));
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.employerProfile.delete({ where: { id: verifiedProfileId } });
    await prisma.user.delete({ where: { id: verifiedUserId } });
    await prisma.employerProfile.delete({ where: { id: unverifiedProfileId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
