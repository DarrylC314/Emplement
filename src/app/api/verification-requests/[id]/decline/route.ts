import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole, requireOwnership } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const request = await prisma.credentialVerificationRequest.findUnique({
    where: { id: params.id },
    select: { id: true, claimantProfileId: true, status: true },
  });
  if (!request) {
    return apiError('Request not found', 404);
  }

  const owns = requireOwnership(session, request.claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }
  if (request.status !== 'PENDING_AUTHORIZATION') {
    return apiError('This request is not awaiting authorization', 409);
  }

  const updated = await prisma.credentialVerificationRequest.updateMany({
    where: { id: params.id, status: 'PENDING_AUTHORIZATION' },
    data: { status: 'DECLINED', declinedAt: new Date() },
  });
  if (updated.count === 0) {
    return apiError('This request is not awaiting authorization', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_VERIFICATION_DECLINED',
    targetEntity: 'CredentialVerificationRequest',
    targetId: params.id,
  });

  return Response.json({ id: params.id }, { status: 200 });
}
