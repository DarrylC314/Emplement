import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ note?: string }>(req);
  if (!body) return invalidBody();

  const { note } = body;
  if (!note) {
    return apiError('note is required', 400);
  }

  const event = await prisma.employmentEvent.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!event) {
    return apiError('Event not found', 404);
  }
  if (event.matchedClaimantProfileId || event.dismissedAt) {
    return apiError('This event has already been resolved', 409);
  }

  // Atomic compare-and-swap: guards against a concurrent Match/Retry on the
  // same event racing past the findUnique check above and both writing —
  // updateMany only touches the row if it's still unresolved.
  const updated = await prisma.employmentEvent.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { dismissedAt: new Date(), dismissedByUserId: session!.user.id },
  });
  if (updated.count === 0) {
    return apiError('This event has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_DISMISSED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { note },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
