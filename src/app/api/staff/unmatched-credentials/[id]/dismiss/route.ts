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

  const record = await prisma.credentialRecord.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!record) {
    return apiError('Credential not found', 404);
  }
  if (record.matchedClaimantProfileId || record.dismissedAt) {
    return apiError('This credential has already been resolved', 409);
  }

  const updated = await prisma.credentialRecord.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { dismissedAt: new Date(), dismissedByUserId: session!.user.id },
  });
  if (updated.count === 0) {
    return apiError('This credential has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_DISMISSED',
    targetEntity: 'CredentialRecord',
    targetId: params.id,
    metadata: { note },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
