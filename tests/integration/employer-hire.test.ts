import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as hireApplication } from '@/app/api/employer/job-applications/[id]/hire/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/job-applications/[id]/hire', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let claimId: string;
  let postingId: string;
  let applicationId: string;
  let otherApplicationId: string;
  let thirdCandidateUserId: string | undefined;
  let thirdClaimantProfileId: string | undefined;
  let thirdApplicationId: string;
  const claimantSsn = '447-88-2211';

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `hire-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '27-1122334', companyName: 'Hire Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claimantUser = await prisma.user.create({
      data: { email: `hire-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName: 'Hire Target',
        ssnHash: hashSSN(claimantSsn),
        identityVerificationStatus: 'VERIFIED',
      },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Candidate', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Hired posting', description: 'N/A', location: 'Rolla, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;

    const secondUser = await prisma.user.create({
      data: { email: `hire-claimant-2-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const secondClaimant = await prisma.claimantProfile.create({
      data: { userId: secondUser.id, ssnHash: `hire-test-hash-2-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    const secondCandidate = await prisma.candidateProfile.create({
      data: { claimantProfileId: secondClaimant.id, headline: 'Second candidate', skills: 'Various', availability: 'Now' },
    });
    const otherApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId: secondCandidate.id, initiatedBy: 'CANDIDATE' },
    });
    otherApplicationId = otherApplication.id;
  });

  it('hires the application and cascades every side effect', async () => {
    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${applicationId}/hire`, { method: 'POST' }),
      { params: { id: applicationId } }
    );
    expect(res.status).toBe(200);

    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    expect(application?.status).toBe('HIRED');

    const otherApplication = await prisma.jobApplication.findUnique({ where: { id: otherApplicationId } });
    expect(otherApplication?.status).toBe('REJECTED');

    const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
    expect(posting?.status).toBe('FILLED');

    const event = await prisma.employmentEvent.findFirst({ where: { matchedClaimantProfileId: claimantProfileId } });
    expect(event?.type).toBe('HIRE');
    expect(event?.ssnHash).toBe(hashSSN(claimantSsn));
    expect(event?.employerId).toBe(employerProfileId);

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('RESTRICTED');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.caseworkerId).toBeNull();
    expect(message?.subject).toBeTruthy();

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'JobApplication', targetId: applicationId, action: 'JOB_APPLICATION_HIRED' },
    });
    expect(log).not.toBeNull();
  });

  it('returns 409 hiring an already-resolved application', async () => {
    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${applicationId}/hire`, { method: 'POST' }),
      { params: { id: applicationId } }
    );
    expect(res.status).toBe(409);
  });

  it('returns 409 hiring the other application on the now-FILLED posting, with no side effects', async () => {
    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${otherApplicationId}/hire`, { method: 'POST' }),
      { params: { id: otherApplicationId } }
    );
    expect(res.status).toBe(409);

    // The posting was already FILLED by the first hire — confirm this second
    // attempt did not create a second EmploymentEvent/Claim-restriction for
    // the second candidate.
    const events = await prisma.employmentEvent.findMany({ where: { employerId: employerProfileId } });
    expect(events).toHaveLength(1);
  });

  it('returns 409 hiring a still-PENDING application created after the posting was already FILLED, with no side effects', async () => {
    // Create a brand-new application on the same posting *after* test 1
    // already flipped the posting to FILLED. Nothing at the schema level
    // stops a new PENDING application from being created against a FILLED
    // posting — only the hire transaction's posting-level CAS gate
    // (route.ts, tx.jobPosting.updateMany({ where: { status: 'OPEN' } }))
    // enforces that. This is what actually exercises that gate: unlike the
    // "other application" test above, this application's own status is
    // still PENDING, so the route's pre-transaction
    // `application.status !== 'PENDING'` short-circuit cannot fire — the
    // 409 here can only come from inside the transaction.
    const thirdUser = await prisma.user.create({
      data: { email: `hire-claimant-3-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    thirdCandidateUserId = thirdUser.id;
    const thirdClaimant = await prisma.claimantProfile.create({
      data: { userId: thirdUser.id, ssnHash: `hire-test-hash-3-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    thirdClaimantProfileId = thirdClaimant.id;
    const thirdCandidate = await prisma.candidateProfile.create({
      data: { claimantProfileId: thirdClaimant.id, headline: 'Third candidate', skills: 'Various', availability: 'Now' },
    });
    const thirdApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId: thirdCandidate.id, initiatedBy: 'CANDIDATE', status: 'PENDING' },
    });
    thirdApplicationId = thirdApplication.id;

    const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
    expect(posting?.status).toBe('FILLED');
    expect(thirdApplication.status).toBe('PENDING');

    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${thirdApplicationId}/hire`, { method: 'POST' }),
      { params: { id: thirdApplicationId } }
    );
    expect(res.status).toBe(409);

    // No second EmploymentEvent was created — the transaction rolled back
    // cleanly rather than partially applying.
    const events = await prisma.employmentEvent.findMany({ where: { employerId: employerProfileId } });
    expect(events).toHaveLength(1);

    const application = await prisma.jobApplication.findUnique({ where: { id: thirdApplicationId } });
    expect(application?.status).toBe('PENDING');
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUserId } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.jobApplication.deleteMany({ where: { jobPostingId: postingId } });
    await prisma.jobPosting.delete({ where: { id: postingId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    const secondClaimant = await prisma.claimantProfile.findFirst({ where: { candidateProfile: { headline: 'Second candidate' } } });
    if (secondClaimant) {
      await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: secondClaimant.id } });
      await prisma.claimantProfile.delete({ where: { id: secondClaimant.id } });
      await prisma.user.delete({ where: { id: secondClaimant.userId } });
    }
    if (thirdClaimantProfileId) {
      await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: thirdClaimantProfileId } });
      await prisma.claimantProfile.delete({ where: { id: thirdClaimantProfileId } });
      await prisma.user.delete({ where: { id: thirdCandidateUserId } });
    }
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
