import { prisma } from '@/lib/prisma';
import { jobPostingSchema } from '@/lib/validation/jobPosting';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { centralTimeEndOfDayToUtc } from '@/lib/centralTime';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const postings = await prisma.jobPosting.findMany({
    where: { employerId: session!.user.employerProfileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      status: true,
      tags: true,
      createdAt: true,
      expectedEndDate: true,
    },
  });

  return Response.json(postings);
}

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = jobPostingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED') {
    return apiError('Employer account is not verified', 403);
  }

  const posting = await prisma.jobPosting.create({
    data: {
      employerId: session!.user.employerProfileId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      tags: parsed.data.tags,
      expectedEndDate: parsed.data.expectedEndDate
        ? centralTimeEndOfDayToUtc(parsed.data.expectedEndDate)
        : null,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_POSTING_CREATED',
    targetEntity: 'JobPosting',
    targetId: posting.id,
  });

  return Response.json(posting, { status: 201 });
}
