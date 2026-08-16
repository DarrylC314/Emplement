import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listApplications } from '@/app/api/employer/job-postings/[id]/applications/route';
import { POST as rejectApplication } from '@/app/api/employer/job-applications/[id]/reject/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer application review', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let otherEmployerUserId: string;
  let otherEmployerUserEmail: string;
  let otherEmployerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let postingId: string;
  let applicationId: string;
  let alreadyResolvedApplicationId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `review-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '15-9988776', companyName: 'Review Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otherEmployerUser = await prisma.user.create({
      data: { email: `review-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    otherEmployerUserId = otherEmployerUser.id;
    otherEmployerUserEmail = otherEmployerUser.email;
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, fein: '16-8877665', companyName: 'Other Review Co', verificationStatus: 'VERIFIED' },
    });
    otherEmployerProfileId = otherEmployerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `review-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `review-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Applicant', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Reviewed posting', description: 'N/A', location: 'Springfield, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;

    const secondCandidateUser = await prisma.user.create({
      data: { email: `review-claimant-2-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const secondClaimantProfile = await prisma.claimantProfile.create({
      data: { userId: secondCandidateUser.id, ssnHash: `review-test-hash-2-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    const secondCandidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId: secondClaimantProfile.id, headline: 'Second applicant', skills: 'Various', availability: 'Now' },
    });
    const alreadyResolvedApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId: secondCandidateProfile.id, initiatedBy: 'CANDIDATE', status: 'REJECTED' },
    });
    alreadyResolvedApplicationId = alreadyResolvedApplication.id;
  });

  it('lists applications for the employer own posting, without claimant PII', async () => {
    const res = await listApplications(
      new Request(`http://localhost/api/employer/job-postings/${postingId}/applications`),
      { params: { id: postingId } }
    );
    expect(res.status).toBe(200);
    const applications = await res.json();
    expect(applications).toHaveLength(2);
    const target = applications.find((a: { id: string }) => a.id === applicationId);
    expect(target.candidateProfile.headline).toBe('Applicant');
    expect(target.candidateProfile.legalName).toBeUndefined();
  });

  it('rejects an application', async () => {
    const res = await rejectApplication(
      new Request(`http://localhost/api/employer/job-applications/${applicationId}/reject`, { method: 'POST' }),
      { params: { id: applicationId } }
    );
    expect(res.status).toBe(200);

    const updated = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    expect(updated?.status).toBe('REJECTED');
  });

  it('returns 409 rejecting an already-resolved application', async () => {
    const res = await rejectApplication(
      new Request(`http://localhost/api/employer/job-applications/${alreadyResolvedApplicationId}/reject`, { method: 'POST' }),
      { params: { id: alreadyResolvedApplicationId } }
    );
    expect(res.status).toBe(409);
  });

  it('rejects listing applications for a posting belonging to a different employer with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherEmployerUserId, role: 'EMPLOYER', employerProfileId: otherEmployerProfileId, email: otherEmployerUserEmail },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listApplications(
      new Request(`http://localhost/api/employer/job-postings/${postingId}/applications`),
      { params: { id: postingId } }
    );
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, otherEmployerUserId] } } });
    await prisma.jobApplication.deleteMany({ where: { jobPostingId: postingId } });
    await prisma.jobPosting.delete({ where: { id: postingId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    const secondClaimant = await prisma.claimantProfile.findFirst({ where: { candidateProfile: { headline: 'Second applicant' } } });
    if (secondClaimant) {
      await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: secondClaimant.id } });
      await prisma.claimantProfile.delete({ where: { id: secondClaimant.id } });
      await prisma.user.delete({ where: { id: secondClaimant.userId } });
    }
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfileId } });
    await prisma.user.delete({ where: { id: otherEmployerUserId } });
    await prisma.$disconnect();
  });
});
