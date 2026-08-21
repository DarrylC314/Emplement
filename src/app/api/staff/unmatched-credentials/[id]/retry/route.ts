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

  const record = await prisma.credentialRecord.findUnique({
    where: { id: params.id },
    select: { id: true, ssnHash: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!record) {
    return apiError('Credential not found', 404);
  }
  if (record.matchedClaimantProfileId || record.dismissedAt) {
    return apiError('This credential has already been resolved', 409);
  }
  // Should be unreachable: every unmatched CredentialRecord in this queue
  // came from the proactive path, which always sets ssnHash. Guarded
  // anyway since the column is nullable at the schema level.
  if (!record.ssnHash) {
    return apiError('This credential has no SSN on file to retry matching against', 404);
  }

  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash: record.ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    return apiError('No claimant found for this credential yet', 404);
  }

  const updated = await prisma.credentialRecord.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { matchedClaimantProfileId: matchedClaimant.id },
  });
  if (updated.count === 0) {
    return apiError('This credential has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_MANUALLY_MATCHED',
    targetEntity: 'CredentialRecord',
    targetId: params.id,
    metadata: { via: 'retry' },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
