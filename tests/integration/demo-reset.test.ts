import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as resetDemo } from '@/app/api/demo/reset/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/demo/reset', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let employerProfileId: string;
  let postingId: string;
  let applicationId: string;
  let interviewId: string;

  beforeAll(async () => {
    // Same upserted-by-identity pattern as the scenario-links test — works
    // whether or not the real seed script has already run.
    const claimantUser = await prisma.user.upsert({
      where: { email: 'claimant@example.com' },
      update: {},
      create: { email: 'claimant@example.com', passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;

    const claimantProfile = await prisma.claimantProfile.upsert({
      where: { userId: claimantUserId },
      update: {},
      create: { userId: claimantUserId, legalName: 'Seed Claimant', identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;

    const claim =
      (await prisma.claim.findFirst({ where: { claimantId: claimantProfileId } })) ??
      (await prisma.claim.create({
        data: {
          claimantId: claimantProfileId,
          status: 'ACTIVE',
          benefitYearStart: new Date('2026-08-01'),
          benefitYearEnd: new Date('2027-08-01'),
          weeklyBenefitAmount: 320,
        },
      }));
    claimId = claim.id;

    const employerUser = await prisma.user.upsert({
      where: { email: 'employer@example.com' },
      update: {},
      create: { email: 'employer@example.com', passwordHash: 'x', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.upsert({
      where: { userId: employerUser.id },
      update: {},
      create: {
        userId: employerUser.id,
        fein: '47-1002233',
        companyName: 'Riverbend Logistics Inc.',
        verificationStatus: 'VERIFIED',
      },
    });
    employerProfileId = employerProfile.id;

    const posting =
      (await prisma.jobPosting.findFirst({ where: { employerId: employerProfileId, title: 'Warehouse Associate' } })) ??
      (await prisma.jobPosting.create({
        data: {
          employerId: employerProfileId,
          title: 'Warehouse Associate',
          description: 'N/A',
          location: 'Jefferson City, MO',
        },
      }));
    postingId = posting.id;

    const candidateProfile = await prisma.candidateProfile.upsert({
      where: { claimantProfileId },
      update: {},
      create: {
        claimantProfileId,
        headline: 'Warehouse & Logistics Associate',
        skills: 'Forklift certified',
        availability: 'Immediate',
      },
    });

    const application =
      (await prisma.jobApplication.findFirst({
        where: { jobPostingId: postingId, candidateProfileId: candidateProfile.id },
      })) ??
      (await prisma.jobApplication.create({
        data: { jobPostingId: postingId, candidateProfileId: candidateProfile.id, initiatedBy: 'CANDIDATE' },
      }));
    applicationId = application.id;

    const interview =
      (await prisma.interview.findUnique({ where: { jobApplicationId: applicationId } })) ??
      (await prisma.interview.create({
        data: {
          jobApplicationId: applicationId,
          status: 'PROPOSED',
          slots: { create: [{ startTime: new Date('2026-08-19T15:00:00Z') }] },
        },
      }));
    interviewId = interview.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('reverts a hired/confirmed state back to the seeded PROPOSED starting point', async () => {
    // Arrange: simulate exactly what Accept + Hire produce.
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: 'CONFIRMED', confirmedSlot: new Date('2026-08-19T15:00:00Z') },
    });
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: 'HIRED' } });
    await prisma.jobPosting.update({ where: { id: postingId }, data: { status: 'FILLED' } });
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'RESTRICTED' } });
    await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Seed Claimant',
        ssnHash: hashSSN('999-11-2222'),
        eventDate: new Date(),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    await prisma.message.create({
      data: {
        claimantId: claimantProfileId,
        subject: 'Your claim status has changed',
        body: 'Your claim status was updated to Restricted because you were hired through the Emplement marketplace.',
      },
    });

    const res = await resetDemo();
    expect(res.status).toBe(200);

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    expect(interview?.status).toBe('PROPOSED');
    expect(interview?.confirmedSlot).toBeNull();

    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    expect(application?.status).toBe('PENDING');

    const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
    expect(posting?.status).toBe('OPEN');

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('ACTIVE');

    const event = await prisma.employmentEvent.findFirst({
      where: { matchedClaimantProfileId: claimantProfileId, type: 'HIRE' },
    });
    expect(event).toBeNull();

    const message = await prisma.message.findFirst({
      where: { claimantId: claimantProfileId, subject: 'Your claim status has changed' },
    });
    expect(message).toBeNull();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce(null);
    const res = await resetDemo();
    expect(res.status).toBe(401);
  });

  afterAll(async () => {
    // Deliberately does not delete the shared identity rows (User,
    // profiles, claim, posting, application, interview) — they're the real
    // demo fixtures the guided-demo scenario and other tests/manual use
    // rely on, and this test's own last action already leaves them in the
    // correct canonical PROPOSED/PENDING/OPEN/ACTIVE state.
    await prisma.$disconnect();
  });
});
