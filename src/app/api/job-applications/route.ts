import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.claimantProfileId) {
    return apiError('Claimant profile not found', 404);
  }

  const body = await parseJson<{ jobPostingId?: string }>(req);
  if (!body) return invalidBody();
  const { jobPostingId } = body;
  if (!jobPostingId) {
    return apiError('jobPostingId is required', 400);
  }

  const candidateProfile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
    select: { id: true },
  });
  if (!candidateProfile) {
    return apiError('You need a candidate profile before you can apply', 404);
  }

  const posting = await prisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { status: true },
  });
  if (!posting) {
    return apiError('Job posting not found', 404);
  }
  if (posting.status !== 'OPEN') {
    return apiError('This job posting is no longer accepting applications', 400);
  }

  let application;
  try {
    application = await prisma.jobApplication.create({
      data: { jobPostingId, candidateProfileId: candidateProfile.id, initiatedBy: 'CANDIDATE' },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('You have already applied to this posting', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_SUBMITTED',
    targetEntity: 'JobApplication',
    targetId: application.id,
  });

  return Response.json(application, { status: 201 });
}
