import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as proposeInterview } from '@/app/api/employer/job-applications/[id]/interview/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/job-applications/[id]/interview', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let otherEmployerUserId: string;
  let otherEmployerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let postingId: string;
  let secondPostingId: string;
  let otherPostingId: string;
  let applicationId: string;
  let otherEmployerApplicationId: string;
  let hiredApplicationId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `interview-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '11-2233445', companyName: 'Interview Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otherEmployerUser = await prisma.user.create({
      data: { email: `interview-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    otherEmployerUserId = otherEmployerUser.id;
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, fein: '12-3344556', companyName: 'Other Interview Co', verificationStatus: 'VERIFIED' },
    });
    otherEmployerProfileId = otherEmployerProfile.id;
    const otherPosting = await prisma.jobPosting.create({
      data: { employerId: otherEmployerProfileId, title: 'Not mine', description: 'N/A', location: 'Elsewhere' },
    });
    otherPostingId = otherPosting.id;

    const claimantUser = await prisma.user.create({
      data: { email: `interview-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `interview-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Candidate', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Interview posting', description: 'N/A', location: 'Springfield, MO' },
    });
    postingId = posting.id;

    // Separate posting (same employer) for the non-PENDING application below —
    // JobApplication has a @@unique([jobPostingId, candidateProfileId])
    // constraint from Task 1's schema, so it can't share `postingId` with the
    // PENDING `application` created for the same `candidateProfileId`.
    const secondPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Second interview posting', description: 'N/A', location: 'Springfield, MO' },
    });
    secondPostingId = secondPosting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;

    const otherEmployerApplication = await prisma.jobApplication.create({
      data: { jobPostingId: otherPostingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    otherEmployerApplicationId = otherEmployerApplication.id;

    const hiredApplication = await prisma.jobApplication.create({
      data: { jobPostingId: secondPostingId, candidateProfileId, initiatedBy: 'CANDIDATE', status: 'REJECTED' },
    });
    hiredApplicationId = hiredApplication.id;
  });

  it('rejects proposing for an application belonging to a different employer with 403', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${otherEmployerApplicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-01T14:00', '2026-09-02T14:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: otherEmployerApplicationId } });
    expect(res.status).toBe(403);
  });

  it('rejects proposing for a non-PENDING application with 409', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${hiredApplicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-01T14:00', '2026-09-02T14:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: hiredApplicationId } });
    expect(res.status).toBe(409);
  });

  it('proposes interview slots and notifies the claimant', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-01T14:00', '2026-09-02T15:30'], location: 'Video call' }),
    });
    const res = await proposeInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('PROPOSED');

    const interview = await prisma.interview.findUnique({
      where: { jobApplicationId: applicationId },
      include: { slots: true },
    });
    expect(interview?.slots).toHaveLength(2);
    expect(interview?.location).toBe('Video call');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message).not.toBeNull();
    expect(message?.caseworkerId).toBeNull();
  });

  it('rejects a second proposal while the interview is still PROPOSED with 409', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-03T14:00', '2026-09-04T14:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(409);
  });

  it('allows re-proposing after the interview is DECLINED, replacing the slots', async () => {
    await prisma.interview.update({
      where: { jobApplicationId: applicationId },
      data: { status: 'DECLINED' },
    });

    const req = new Request(`http://localhost/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-10T09:00', '2026-09-11T09:00', '2026-09-12T09:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(201);

    const interview = await prisma.interview.findUnique({
      where: { jobApplicationId: applicationId },
      include: { slots: true },
    });
    expect(interview?.status).toBe('PROPOSED');
    expect(interview?.slots).toHaveLength(3);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, otherEmployerUserId] } } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    const interview = await prisma.interview.findUnique({ where: { jobApplicationId: applicationId } });
    if (interview) {
      await prisma.interviewSlot.deleteMany({ where: { interviewId: interview.id } });
      await prisma.interview.delete({ where: { id: interview.id } });
    }
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.deleteMany({ where: { employerId: { in: [employerProfileId, otherEmployerProfileId] } } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfileId } });
    await prisma.user.delete({ where: { id: otherEmployerUserId } });
    await prisma.$disconnect();
  });
});
