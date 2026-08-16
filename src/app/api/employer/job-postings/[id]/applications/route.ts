import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const posting = await prisma.jobPosting.findUnique({
    where: { id: params.id },
    select: { employerId: true, title: true, status: true },
  });
  if (!posting) {
    return apiError('Job posting not found', 404);
  }
  if (posting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }

  const applications = await prisma.jobApplication.findMany({
    where: { jobPostingId: params.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      initiatedBy: true,
      createdAt: true,
      candidateProfile: {
        select: { headline: true, skills: true, bio: true, availability: true },
      },
      interview: {
        select: {
          id: true,
          status: true,
          location: true,
          confirmedSlot: true,
          slots: { select: { id: true, startTime: true } },
        },
      },
    },
  });

  return Response.json(applications);
}
