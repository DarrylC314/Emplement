import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

const EDITABLE_FIELDS = ['legalName', 'phone', 'mailingAddress'] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const body = await req.json();
  // caseworkerId, if sent, is ignored — attribution always comes from the
  // verified session, never client input.
  const { caseworkerId: _ignoredCaseworkerId, ...updates } = body;

  const data: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    if (typeof updates[field] === 'string') data[field] = updates[field];
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const updated = await prisma.claimantProfile.update({
    where: { id: params.id },
    data,
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CLAIMANT_RECORD_EDITED',
    targetEntity: 'ClaimantProfile',
    targetId: params.id,
    metadata: { fields: Object.keys(data) },
  });

  return Response.json(updated, { status: 200 });
}
