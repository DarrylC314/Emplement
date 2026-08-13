import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ claimId?: string; note?: string }>(req);
  if (!body) return invalidBody();

  const { claimId, note } = body;
  if (!claimId || !note) {
    return apiError('claimId and note are required', 400);
  }
  // Attribution always comes from the verified session, never client input —
  // otherwise an authenticated caseworker could attribute a note to a colleague.
  const created = await prisma.caseNote.create({
    data: { claimId, caseworkerId: session!.user.id, note },
  });

  // Case notes are caseworker activity an accountability audit needs to
  // reconstruct (design spec, caseworker flow: "Every action here writes to
  // AuditLog"). Targeted at the note itself, with the claim in metadata, so the
  // trail points at the exact artifact created.
  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CASE_NOTE_ADDED',
    targetEntity: 'CaseNote',
    targetId: created.id,
    metadata: { claimId },
  });

  return Response.json(created, { status: 201 });
}
