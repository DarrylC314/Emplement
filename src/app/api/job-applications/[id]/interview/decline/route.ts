import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      candidateProfile: { select: { claimantProfileId: true } },
      interview: { select: { id: true, status: true } },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }

  const owns = requireOwnership(session, application.candidateProfile.claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  if (!application.interview || application.interview.status !== 'PROPOSED') {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  const updated = await prisma.interview.updateMany({
    where: { id: application.interview.id, status: 'PROPOSED' },
    data: { status: 'DECLINED' },
  });
  if (updated.count === 0) {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'INTERVIEW_DECLINED',
    targetEntity: 'Interview',
    targetId: application.interview.id,
  });

  return Response.json({ id: application.interview.id, status: 'DECLINED' }, { status: 200 });
}
