import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: { status: true, jobPosting: { select: { employerId: true } } },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }
  if (application.jobPosting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (application.status !== 'PENDING') {
    return apiError('This application has already been resolved', 409);
  }

  // Atomic compare-and-swap, matching the pattern already established by the
  // unmatched-events queue's routes: the findUnique check above is still
  // needed for the 404/403/fast-path-409 responses, but the write itself is
  // guarded against a concurrent Hire on this same application racing past
  // that check.
  const updated = await prisma.jobApplication.updateMany({
    where: { id: params.id, status: 'PENDING' },
    data: { status: 'REJECTED' },
  });
  if (updated.count === 0) {
    return apiError('This application has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_REJECTED',
    targetEntity: 'JobApplication',
    targetId: params.id,
  });

  return Response.json({ id: params.id }, { status: 200 });
}
