import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listOpenPostings } from '@/app/api/job-postings/route';
import { POST as applyToPosting } from '@/app/api/job-applications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('claimant browse and apply', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let openPostingId: string;
  let filledPostingId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `browse-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `browse-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Retail associate', skills: 'POS systems', availability: 'Immediate' },
    });
    candidateProfileId = candidateProfile.id;

    const employerUser = await prisma.user.create({
      data: { email: `browse-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '82-3344556', companyName: 'Browse Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const openPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Retail associate', description: 'Front of store', location: 'Columbia, MO' },
    });
    openPostingId = openPosting.id;

    const filledPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Already filled', description: 'N/A', location: 'Columbia, MO', status: 'FILLED' },
    });
    filledPostingId = filledPosting.id;
  });

  it('lists only OPEN postings', async () => {
    const res = await listOpenPostings();
    expect(res.status).toBe(200);
    const postings = await res.json();
    const ids = postings.map((p: { id: string }) => p.id);
    expect(ids).toContain(openPostingId);
    expect(ids).not.toContain(filledPostingId);
  });

  it('creates an application when a candidate applies', async () => {
    const req = new Request('http://localhost/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: openPostingId }),
    });
    const res = await applyToPosting(req);
    expect(res.status).toBe(201);

    const application = await prisma.jobApplication.findFirst({
      where: { jobPostingId: openPostingId, candidateProfileId },
    });
    expect(application?.initiatedBy).toBe('CANDIDATE');
    expect(application?.status).toBe('PENDING');
  });

  it('rejects a duplicate application with 409', async () => {
    const req = new Request('http://localhost/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: openPostingId }),
    });
    const res = await applyToPosting(req);
    expect(res.status).toBe(409);
  });

  it('rejects applying to a non-OPEN posting with 400', async () => {
    const req = new Request('http://localhost/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: filledPostingId }),
    });
    const res = await applyToPosting(req);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [claimantUserId, employerUserId] } } });
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
