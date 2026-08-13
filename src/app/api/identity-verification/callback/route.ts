import { prisma } from '@/lib/prisma';
import { identityVerificationSchema } from '@/lib/validation/identity';
import { encryptSSN } from '@/lib/encryption';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  // Spec: basic rate limiting on the identity-verification endpoints.
  const limit = checkRateLimit(rateLimitKey(req, 'idv-callback', session!.user.id));
  if (!limit.allowed) {
    return apiError('Too many verification attempts. Please try again in a minute.', 429);
  }

  const body = await parseJson<{ claimantProfileId?: string } & Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const { claimantProfileId, ...rest } = body;
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }

  const owns = requireOwnership(session, claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
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
