import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { proactiveCredentialReportSchema, parseCredentialDetails } from '@/lib/validation/credential';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const limit = checkRateLimit(rateLimitKey(req, 'employer-credentials', session!.user.employerProfileId));
  if (!limit.allowed) {
    return apiError('Too many credentials reported. Please try again in a minute.', 429);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = proactiveCredentialReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const detailsResult = parseCredentialDetails(parsed.data.type, parsed.data.details);
  if (!detailsResult.success) {
    return Response.json({ errors: detailsResult.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { verificationStatus: true, credentialReportingAgreement: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED') {
    return apiError('Employer account is not verified', 403);
  }
  if (!employerProfile.credentialReportingAgreement) {
    return apiError('This organization does not have a proactive credential-reporting agreement on file', 403);
  }

  const ssnHash = hashSSN(parsed.data.ssn);
  // Same never-reveal-match handling as employer/events: whether a match
  // was found is never distinguishable to the caller beyond the created
  // record's own (never-returned) matchedClaimantProfileId.
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });

  const record = await prisma.credentialRecord.create({
    data: {
      organizationId: session!.user.employerProfileId,
      type: parsed.data.type,
      title: parsed.data.title,
      eventDate: new Date(parsed.data.eventDate),
      details: detailsResult.data as Prisma.InputJsonValue,
      detailsSchemaVersion: detailsResult.data.schemaVersion,
      ssnHash,
      matchedClaimantProfileId: matchedClaimant?.id,
      reportedVia: 'PROACTIVE_AGREEMENT',
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_REPORTED',
    targetEntity: 'CredentialRecord',
    targetId: record.id,
    metadata: { type: parsed.data.type, matched: Boolean(matchedClaimant) },
  });

  return Response.json({ id: record.id }, { status: 201 });
}
