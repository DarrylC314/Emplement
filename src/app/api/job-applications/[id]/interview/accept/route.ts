import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ slotId?: string }>(req);
  if (!body) return invalidBody();
  const { slotId } = body;
  if (!slotId) {
    return apiError('slotId is required', 400);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      candidateProfile: { select: { claimantProfileId: true } },
      interview: { select: { id: true, status: true, slots: { select: { id: true, startTime: true } } } },
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

  const slot = application.interview.slots.find((s) => s.id === slotId);
  if (!slot) {
    return apiError('That time slot was not found', 404);
  }

  const updated = await prisma.interview.updateMany({
    where: { id: application.interview.id, status: 'PROPOSED' },
    data: { status: 'CONFIRMED', confirmedSlot: slot.startTime },
  });
  if (updated.count === 0) {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'INTERVIEW_ACCEPTED',
    targetEntity: 'JobApplication',
    targetId: params.id,
    metadata: { interviewId: application.interview.id, slotId, confirmedSlot: slot.startTime },
  });

  return Response.json({ id: application.interview.id, status: 'CONFIRMED' }, { status: 200 });
}
