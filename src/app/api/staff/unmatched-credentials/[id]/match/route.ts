import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

const manualMatchSchema = z.object({
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  note: z.string().min(1, 'A note is required'),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const limit = checkRateLimit(rateLimitKey(req, 'staff-credential-match', session!.user.id));
  if (!limit.allowed) {
    return apiError('Too many match attempts. Please try again in a minute.', 429);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = manualMatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const { ssn, note } = parsed.data;

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

  const ssnHash = hashSSN(ssn);
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    await writeAuditLog({
      actorUserId: session!.user.id,
      action: 'CREDENTIAL_MATCH_ATTEMPT_FAILED',
      targetEntity: 'CredentialRecord',
      targetId: params.id,
      metadata: { note },
    });
    return apiError('No claimant found with that SSN', 404);
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
    metadata: { via: 'manual', note },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
