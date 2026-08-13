import { prisma } from '@/lib/prisma';
import { identityVerificationSchema } from '@/lib/validation/identity';
import { encryptSSN } from '@/lib/encryption';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const body = await req.json();
  const { claimantProfileId, ...rest } = body;

  const user = session!.user;
  if (user.role === 'CLAIMANT' && user.claimantProfileId !== claimantProfileId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = identityVerificationSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.claimantProfile.update({
    where: { id: claimantProfileId },
    data: {
      legalName: parsed.data.legalName,
      dateOfBirth: new Date(parsed.data.dateOfBirth),
      ssnEncrypted: encryptSSN(parsed.data.ssn),
      phone: parsed.data.phone,
      mailingAddress: parsed.data.mailingAddress,
      identityVerificationStatus: 'VERIFIED',
    },
  });

  await prisma.identityVerificationAttempt.updateMany({
    where: { claimantId: claimantProfileId, status: 'PENDING' },
    data: { status: 'VERIFIED', verifiedAt: new Date() },
  });

  await writeAuditLog({
    actorUserId: profile.userId,
    action: 'IDENTITY_VERIFIED',
    targetEntity: 'ClaimantProfile',
    targetId: claimantProfileId,
  });

  return Response.json({ status: 'VERIFIED' }, { status: 200 });
}
