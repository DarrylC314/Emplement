import { prisma } from '@/lib/prisma';
import { decryptSSN } from '@/lib/encryption';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { caseworkerId, reason } = await req.json();
  if (!caseworkerId || !reason) {
    return Response.json({ error: 'caseworkerId and reason are required' }, { status: 400 });
  }

  const profile = await prisma.claimantProfile.findUnique({ where: { id: params.id } });
  if (!profile?.ssnEncrypted) {
    return Response.json({ error: 'No SSN on file for this claimant' }, { status: 404 });
  }

  const ssn = decryptSSN(profile.ssnEncrypted);

  await writeAuditLog({
    actorUserId: caseworkerId,
    action: 'SSN_REVEALED',
    targetEntity: 'ClaimantProfile',
    targetId: params.id,
    metadata: { reason },
  });

  return Response.json({ ssn }, { status: 200 });
}
