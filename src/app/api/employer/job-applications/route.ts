import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<{ jobPostingId?: string; candidateProfileId?: string }>(req);
  if (!body) return invalidBody();
  const { jobPostingId, candidateProfileId } = body;
  if (!jobPostingId || !candidateProfileId) {
    return apiError('jobPostingId and candidateProfileId are required', 400);
  }

  const posting = await prisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { employerId: true, status: true },
  });
  if (!posting) {
    return apiError('Job posting not found', 404);
  }
  if (posting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (posting.status !== 'OPEN') {
    return apiError('This job posting is no longer open', 400);
  }

  const candidate = await prisma.candidateProfile.findUnique({
    where: { id: candidateProfileId },
    select: { id: true },
  });
  if (!candidate) {
    return apiError('Candidate not found', 404);
  }

  let application;
  try {
    application = await prisma.jobApplication.create({
      data: { jobPostingId, candidateProfileId, initiatedBy: 'EMPLOYER' },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('You have already reached out to this candidate for this posting', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_EMPLOYER_OUTREACH',
    targetEntity: 'JobApplication',
    targetId: application.id,
  });

  return Response.json(application, { status: 201 });
}
