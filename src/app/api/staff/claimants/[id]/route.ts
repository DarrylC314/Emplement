import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

const EDITABLE_FIELDS = ['legalName', 'phone', 'mailingAddress'] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { caseworkerId, ...updates } = body;
  if (!caseworkerId) {
    return Response.json({ error: 'caseworkerId is required' }, { status: 400 });
  }

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
    actorUserId: caseworkerId,
    action: 'CLAIMANT_RECORD_EDITED',
    targetEntity: 'ClaimantProfile',
    targetId: params.id,
    metadata: { fields: Object.keys(data) },
  });

  return Response.json(updated, { status: 200 });
}
