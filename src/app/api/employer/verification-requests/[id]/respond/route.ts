import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { credentialResponseSchema, parseCredentialDetails } from '@/lib/validation/credential';

// Thrown from inside the transaction to force a full rollback, mirroring
// src/app/api/employer/job-applications/[id]/hire/route.ts's
// ApplicationAlreadyResolvedError.
class RequestAlreadyRespondedError extends Error {}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = credentialResponseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const request = await prisma.credentialVerificationRequest.findUnique({
    where: { id: params.id },
    select: { id: true, organizationId: true, status: true, claimantProfileId: true, credentialType: true },
  });
  if (!request) {
    return apiError('Request not found', 404);
  }
  if (request.organizationId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (request.status !== 'AUTHORIZED') {
    return apiError('This request is not awaiting a response', 409);
  }

  if (parsed.data.confirmed) {
    const detailsResult = parseCredentialDetails(request.credentialType, parsed.data.details);
    if (!detailsResult.success) {
      return Response.json({ errors: detailsResult.error.flatten() }, { status: 400 });
    }
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.credentialVerificationRequest.updateMany({
        where: { id: params.id, status: 'AUTHORIZED' },
        data: {
          status: parsed.data.confirmed ? 'CONFIRMED' : 'NO_RECORD_FOUND',
          respondedAt: now,
          respondedByUserId: session!.user.id,
          responseNote: parsed.data.confirmed ? null : (parsed.data.responseNote ?? null),
        },
      });
      if (updated.count === 0) {
        throw new RequestAlreadyRespondedError();
      }

      let credentialRecordId: string | null = null;
      if (parsed.data.confirmed) {
        const record = await tx.credentialRecord.create({
          data: {
            organizationId: request.organizationId,
            type: request.credentialType,
            title: parsed.data.title,
            eventDate: new Date(parsed.data.eventDate),
            details: parsed.data.details,
            matchedClaimantProfileId: request.claimantProfileId,
            reportedVia: 'REQUEST_RESPONSE',
          },
        });
        credentialRecordId = record.id;
        await tx.credentialVerificationRequest.update({
          where: { id: params.id },
          data: { resultingCredentialRecordId: record.id },
        });
      }

      // Written inside the same transaction as the state change it
      // describes — see this task's brief for why.
      await tx.auditLog.create({
        data: {
          actorUserId: session!.user.id,
          action: parsed.data.confirmed ? 'CREDENTIAL_VERIFICATION_CONFIRMED' : 'CREDENTIAL_VERIFICATION_NO_RECORD_FOUND',
          targetEntity: 'CredentialVerificationRequest',
          targetId: params.id,
          metadata: { credentialRecordId },
        },
      });

      return { credentialRecordId };
    });
  } catch (err) {
    if (err instanceof RequestAlreadyRespondedError) {
      return apiError('This request is not awaiting a response', 409);
    }
    throw err;
  }

  return Response.json({ id: params.id, credentialRecordId: result.credentialRecordId }, { status: 200 });
}
