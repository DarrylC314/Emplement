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

  const updated = await prisma.employmentEvent.update({
    where: { id: params.id },
    data: { dismissedAt: new Date(), dismissedByUserId: session!.user.id },
    select: { id: true },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_DISMISSED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { note },
  });

  return Response.json(updated, { status: 200 });
}
