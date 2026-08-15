import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const event = await prisma.employmentEvent.findUnique({
    where: { id: params.id },
    select: { id: true, ssnHash: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!event) {
    return apiError('Event not found', 404);
  }
  if (event.matchedClaimantProfileId || event.dismissedAt) {
    return apiError('This event has already been resolved', 409);
  }

  // Re-checks the event's own already-stored ssnHash — no new hash is
  // computed here. This is what handles "the claimant verified their
  // identity after the event was reported": the original hash was always
  // correct, it just didn't match anyone yet.
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash: event.ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    return apiError('No claimant found for this event yet', 404);
  }

  const updated = await prisma.employmentEvent.update({
    where: { id: params.id },
    data: { matchedClaimantProfileId: matchedClaimant.id },
    select: { id: true },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { via: 'retry' },
  });

  return Response.json(updated, { status: 200 });
}
