import { prisma } from '@/lib/prisma';
import { decryptSSN } from '@/lib/encryption';
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

  const body = await parseJson<{ reason?: string }>(req);
  if (!body) return invalidBody();

  const { reason } = body;
  if (!reason) {
    return apiError('reason is required', 400);
  }

  const profile = await prisma.claimantProfile.findUnique({ where: { id: params.id } });
  if (!profile?.ssnEncrypted) {
    return apiError('No SSN on file for this claimant', 404);
  }

  const ssn = decryptSSN(profile.ssnEncrypted);

  await writeAuditLog({
    // Actor is always the verified session's caseworker, never a client-supplied
    // id — otherwise an authenticated caseworker could attribute a reveal to a
    // colleague in the audit trail.
    actorUserId: session!.user.id,
    action: 'SSN_REVEALED',
    targetEntity: 'ClaimantProfile',
    targetId: params.id,
    metadata: { reason },
  });

  return Response.json({ ssn }, { status: 200 });
}
