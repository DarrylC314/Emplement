import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
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

  const body = await parseJson<{ ssn?: string; note?: string }>(req);
  if (!body) return invalidBody();

  const { ssn, note } = body;
  if (!ssn) {
    return apiError('ssn is required', 400);
  }
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

  // Hashes the freshly-submitted SSN — never the event's own stored
  // ssnHash. This is what handles "the employer had the wrong SSN on
  // file": the event's original hash will never match anyone no matter
  // how many times it's retried, so staff supply a corrected one here.
  const ssnHash = hashSSN(ssn);
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    return apiError('No claimant found with that SSN', 404);
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
    metadata: { via: 'manual', note },
  });

  return Response.json(updated, { status: 200 });
}
