import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as acceptInterview } from '@/app/api/job-applications/[id]/interview/accept/route';
import { POST as declineInterview } from '@/app/api/job-applications/[id]/interview/decline/route';
import { GET as listMyApplications } from '@/app/api/job-applications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('claimant interview responses and application list', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let otherClaimantUserId: string;
  let otherClaimantProfileId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let postingId: string;
  let confirmedPostingId: string;
  let applicationId: string;
  let interviewId: string;
  let slot1Id: string;
  let slot2Id: string;
  let confirmedApplicationId: string;
  let confirmedInterviewId: string;
  let resolvedPostingId: string;
  let resolvedApplicationId: string;
  let resolvedInterviewId: string;
  let resolvedSlotId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `respond-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `respond-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Candidate', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otherClaimantUser = await prisma.user.create({
      data: { email: `respond-other-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    otherClaimantUserId = otherClaimantUser.id;
    const otherClaimantProfile = await prisma.claimantProfile.create({
      data: { userId: otherClaimantUser.id, ssnHash: `respond-other-hash-${Date.now()}` },
    });
    otherClaimantProfileId = otherClaimantProfile.id;

    const employerUser = await prisma.user.create({
      data: { email: `respond-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '21-3344556', companyName: 'Respond Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;
    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Respond posting', description: 'N/A', location: 'Columbia, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;
    const interview = await prisma.interview.create({
      data: {
        jobApplicationId: applicationId,
        slots: {
          create: [
            { startTime: new Date('2026-09-01T14:00:00Z') },
            { startTime: new Date('2026-09-02T14:00:00Z') },
          ],
        },
      },
      include: { slots: true },
    });
    interviewId = interview.id;
    slot1Id = interview.slots[0]!.id;
    slot2Id = interview.slots[1]!.id;

    // A JobApplication has a real @@unique([jobPostingId, candidateProfileId])
    // constraint, so this second application (same candidate) needs its own
    // posting rather than reusing `postingId`.
    const confirmedPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Respond posting (confirmed)', description: 'N/A', location: 'Columbia, MO' },
    });
    confirmedPostingId = confirmedPosting.id;
    const confirmedApplication = await prisma.jobApplication.create({
      data: { jobPostingId: confirmedPostingId, candidateProfileId, initiatedBy: 'EMPLOYER' },
    });
    confirmedApplicationId = confirmedApplication.id;
    const confirmedInterview = await prisma.interview.create({
      data: {
        jobApplicationId: confirmedApplicationId,
        status: 'CONFIRMED',
        confirmedSlot: new Date('2026-09-05T14:00:00Z'),
        slots: { create: [{ startTime: new Date('2026-09-05T14:00:00Z') }] },
      },
    });
    confirmedInterviewId = confirmedInterview.id;

    // Regression fixture for the "resolved application with a still-PROPOSED
    // interview" bug: this mirrors what the hire route's auto-reject leaves
    // behind when a different application on the same posting gets hired
    // after this one already had an interview proposed.
    const resolvedPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Respond posting (resolved)', description: 'N/A', location: 'Columbia, MO' },
    });
    resolvedPostingId = resolvedPosting.id;
    const resolvedApplication = await prisma.jobApplication.create({
      data: { jobPostingId: resolvedPostingId, candidateProfileId, initiatedBy: 'EMPLOYER', status: 'REJECTED' },
    });
    resolvedApplicationId = resolvedApplication.id;
    const resolvedInterview = await prisma.interview.create({
      data: {
        jobApplicationId: resolvedApplicationId,
        slots: { create: [{ startTime: new Date('2026-09-08T14:00:00Z') }] },
      },
      include: { slots: true },
    });
    resolvedInterviewId = resolvedInterview.id;
    resolvedSlotId = resolvedInterview.slots[0]!.id;
  });

  it('rejects a claimant acting on another claimant\'s application with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherClaimantUserId, role: 'CLAIMANT', claimantProfileId: otherClaimantProfileId, email: 'other@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot1Id }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(403);
  });

  it('rejects accepting an interview that is already CONFIRMED with 409', async () => {
    const req = new Request(`http://localhost/api/job-applications/${confirmedApplicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot1Id }),
    });
    const res = await acceptInterview(req, { params: { id: confirmedApplicationId } });
    expect(res.status).toBe(409);
  });

  it('rejects accepting a slotId that does not belong to the interview with 404', async () => {
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: 'nonexistent-slot-id' }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(404);
  });

  it('lists the claimant\'s own applications with interview slots', async () => {
    const res = await listMyApplications();
    expect(res.status).toBe(200);
    const applications = await res.json();
    const target = applications.find((a: { id: string }) => a.id === applicationId);
    expect(target.interview.status).toBe('PROPOSED');
    expect(target.interview.slots).toHaveLength(2);
    expect(target.jobPosting.title).toBe('Respond posting');
  });

  it('accepts a slot, confirming the interview', async () => {
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot1Id }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(200);

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    expect(interview?.status).toBe('CONFIRMED');
    expect(interview?.confirmedSlot?.toISOString()).toBe(new Date('2026-09-01T14:00:00Z').toISOString());

    const auditEntry = await prisma.auditLog.findFirst({
      where: { actorUserId: claimantUserId, action: 'INTERVIEW_ACCEPTED' },
      orderBy: { timestamp: 'desc' },
    });
    expect(auditEntry?.targetEntity).toBe('JobApplication');
    expect(auditEntry?.targetId).toBe(applicationId);
  });

  it('rejects accepting an interview on a REJECTED application with 409, without changing Interview.status', async () => {
    const req = new Request(`http://localhost/api/job-applications/${resolvedApplicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: resolvedSlotId }),
    });
    const res = await acceptInterview(req, { params: { id: resolvedApplicationId } });
    expect(res.status).toBe(409);

    const interview = await prisma.interview.findUnique({ where: { id: resolvedInterviewId } });
    expect(interview?.status).toBe('PROPOSED');
    expect(interview?.confirmedSlot).toBeNull();
  });

  it('rejects declining an interview on a REJECTED application with 409, without changing Interview.status', async () => {
    const req = new Request(`http://localhost/api/job-applications/${resolvedApplicationId}/interview/decline`, { method: 'POST' });
    const res = await declineInterview(req, { params: { id: resolvedApplicationId } });
    expect(res.status).toBe(409);

    const interview = await prisma.interview.findUnique({ where: { id: resolvedInterviewId } });
    expect(interview?.status).toBe('PROPOSED');
  });

  it('rejects accepting again on an already-CONFIRMED interview with 409', async () => {
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot2Id }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(409);
  });

  it('declines an interview still in PROPOSED status', async () => {
    // Same @@unique([jobPostingId, candidateProfileId]) constraint as above:
    // this application needs its own posting since `postingId` is already
    // used by the `application` created in beforeAll for this candidate.
    const declinePosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Respond posting (decline)', description: 'N/A', location: 'Columbia, MO' },
    });
    const declineApplication = await prisma.jobApplication.create({
      data: { jobPostingId: declinePosting.id, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    const declineInterviewRow = await prisma.interview.create({
      data: { jobApplicationId: declineApplication.id, slots: { create: [{ startTime: new Date('2026-09-20T10:00:00Z') }] } },
    });

    const req = new Request(`http://localhost/api/job-applications/${declineApplication.id}/interview/decline`, { method: 'POST' });
    const res = await declineInterview(req, { params: { id: declineApplication.id } });
    expect(res.status).toBe(200);

    const interview = await prisma.interview.findUnique({ where: { id: declineInterviewRow.id } });
    expect(interview?.status).toBe('DECLINED');

    const auditEntry = await prisma.auditLog.findFirst({
      where: { actorUserId: claimantUserId, action: 'INTERVIEW_DECLINED' },
      orderBy: { timestamp: 'desc' },
    });
    expect(auditEntry?.targetEntity).toBe('JobApplication');
    expect(auditEntry?.targetId).toBe(declineApplication.id);

    await prisma.interviewSlot.deleteMany({ where: { interviewId: declineInterviewRow.id } });
    await prisma.interview.delete({ where: { id: declineInterviewRow.id } });
    await prisma.jobApplication.delete({ where: { id: declineApplication.id } });
    await prisma.jobPosting.delete({ where: { id: declinePosting.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [claimantUserId, otherClaimantUserId] } } });
    await prisma.interviewSlot.deleteMany({ where: { interviewId: { in: [interviewId, confirmedInterviewId, resolvedInterviewId] } } });
    await prisma.interview.deleteMany({ where: { id: { in: [interviewId, confirmedInterviewId, resolvedInterviewId] } } });
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.delete({ where: { id: postingId } });
    await prisma.jobPosting.delete({ where: { id: confirmedPostingId } });
    await prisma.jobPosting.delete({ where: { id: resolvedPostingId } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.claimantProfile.delete({ where: { id: otherClaimantProfileId } });
    await prisma.user.delete({ where: { id: otherClaimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
