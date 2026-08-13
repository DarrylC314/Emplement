import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const parsedBody = await parseJson<{
    claimantProfileId?: string;
    subject?: string;
    body?: string;
  }>(req);
  if (!parsedBody) return invalidBody();

  const { claimantProfileId, subject, body } = parsedBody;
  if (!claimantProfileId || !subject || !body) {
    return apiError('claimantProfileId, subject, and body are required', 400);
  }
  // Attribution always comes from the verified session, never client input —
  // otherwise an authenticated caseworker could attribute a message to a
  // colleague. (This route is CASEWORKER/ADMIN-only; there is currently no
  // "system-generated" caseworkerId: null path exercised anywhere in the app.)
  const message = await prisma.message.create({
    data: { claimantId: claimantProfileId, caseworkerId: session!.user.id, subject, body },
  });

  // Caseworker-initiated messaging is exactly the kind of activity an
  // accountability audit needs to reconstruct (design spec, caseworker flow:
  // "Every action here writes to AuditLog"). Only this caseworker path is
  // logged — a future system-generated message would have no human actor.
  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'MESSAGE_SENT',
    targetEntity: 'Message',
    targetId: message.id,
    metadata: { claimantProfileId, subject },
  });

  return Response.json(message, { status: 201 });
}

export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const url = new URL(req.url);
  const claimantProfileId = url.searchParams.get('claimantProfileId');
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }

  const owns = requireOwnership(session, claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  const messages = await prisma.message.findMany({
    where: { claimantId: claimantProfileId },
    orderBy: { sentAt: 'desc' },
  });

  // Only the claimant reading their own thread marks it read. Marking on every
  // fetch meant a caseworker opening the case detail page silently cleared the
  // claimant's unread state for messages the claimant had never seen.
  if (session!.user.role === 'CLAIMANT') {
    await prisma.message.updateMany({
      where: { claimantId: claimantProfileId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  return Response.json(messages);
}
