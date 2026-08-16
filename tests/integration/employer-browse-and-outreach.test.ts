import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listCandidates } from '@/app/api/employer/candidates/route';
import { POST as reachOut } from '@/app/api/employer/job-applications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer browse candidates and reach out', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let otherEmployerUserId: string;
  let otherEmployerProfileId: string;
  let unverifiedEmployerUserId: string;
  let unverifiedEmployerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let openPostingId: string;
  let otherEmployerPostingId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `outreach-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '93-4455667', companyName: 'Outreach Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const openPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Retail associate', description: 'Front of store', location: 'Columbia, MO' },
    });
    openPostingId = openPosting.id;

    const otherEmployerUser = await prisma.user.create({
      data: { email: `outreach-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    otherEmployerUserId = otherEmployerUser.id;
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, fein: '94-5566778', companyName: 'Other Co', verificationStatus: 'VERIFIED' },
    });
    otherEmployerProfileId = otherEmployerProfile.id;
    const otherEmployerPosting = await prisma.jobPosting.create({
      data: { employerId: otherEmployerProfileId, title: 'Not mine', description: 'N/A', location: 'Elsewhere' },
    });
    otherEmployerPostingId = otherEmployerPosting.id;

    const claimantUser = await prisma.user.create({
      data: { email: `outreach-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName: 'Outreach Target',
        ssnHash: `outreach-test-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId,
        headline: 'Retail associate',
        skills: 'POS systems',
        availability: 'Immediate',
        tags: ['SALES'],
      },
    });
    candidateProfileId = candidateProfile.id;

    const unverifiedEmployerUser = await prisma.user.create({
      data: { email: `outreach-unverified-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    unverifiedEmployerUserId = unverifiedEmployerUser.id;
    const unverifiedEmployerProfile = await prisma.employerProfile.create({
      data: { userId: unverifiedEmployerUser.id },
    });
    unverifiedEmployerProfileId = unverifiedEmployerProfile.id;
  });

  it('rejects browsing candidates for an unverified employer with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: unverifiedEmployerUserId, role: 'EMPLOYER', employerProfileId: unverifiedEmployerProfileId, email: 'unverified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listCandidates();
    expect(res.status).toBe(403);
  });

  it('lists candidate profiles without leaking claimant PII, including tags', async () => {
    const res = await listCandidates();
    expect(res.status).toBe(200);
    const candidates = await res.json();
    const target = candidates.find((c: { id: string }) => c.id === candidateProfileId);
    expect(target.headline).toBe('Retail associate');
    expect(target.tags).toEqual(['SALES']);
    expect(target.legalName).toBeUndefined();
    expect(target.ssnHash).toBeUndefined();
    expect(target.claimantProfileId).toBeUndefined();
  });

  it('creates an outreach application against the employer own posting', async () => {
    const req = new Request('http://localhost/api/employer/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: openPostingId, candidateProfileId }),
    });
    const res = await reachOut(req);
    expect(res.status).toBe(201);

    const application = await prisma.jobApplication.findFirst({
      where: { jobPostingId: openPostingId, candidateProfileId },
    });
    expect(application?.initiatedBy).toBe('EMPLOYER');
  });

  it('rejects reaching out against a posting belonging to a different employer with 403', async () => {
    const req = new Request('http://localhost/api/employer/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: otherEmployerPostingId, candidateProfileId }),
    });
    const res = await reachOut(req);
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, otherEmployerUserId] } } });
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.deleteMany({ where: { employerId: { in: [employerProfileId, otherEmployerProfileId] } } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfileId } });
    await prisma.user.delete({ where: { id: otherEmployerUserId } });
    await prisma.employerProfile.delete({ where: { id: unverifiedEmployerProfileId } });
    await prisma.user.delete({ where: { id: unverifiedEmployerUserId } });
    await prisma.$disconnect();
  });
});
