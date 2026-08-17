import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { credentialRequestCreateSchema } from '@/lib/validation/credential';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = credentialRequestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const isClaimant = session!.user.role === 'CLAIMANT';
  // A CLAIMANT session always requests for themselves — any client-supplied
  // claimantProfileId is ignored, never trusted. A CASEWORKER/ADMIN session
  // must explicitly name the claimant they're requesting on behalf of.
  const claimantProfileId = isClaimant ? session!.user.claimantProfileId : parsed.data.claimantProfileId;
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }
  if (!isClaimant) {
    const claimantExists = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId }, select: { id: true } });
    if (!claimantExists) {
      return apiError('Claimant not found', 404);
    }
  }

  const organization = await prisma.employerProfile.findUnique({
    where: { id: parsed.data.organizationId },
    select: { verificationStatus: true },
  });
  if (!organization || organization.verificationStatus !== 'VERIFIED') {
    return apiError('The target organization is not verified', 400);
  }

  // Requesting your own credential is itself the authorization — no
  // separate approval step for a CLAIMANT-initiated request. A
  // caseworker-initiated one requires the claimant's explicit approval
  // before the organization ever sees it.
  const now = new Date();
  const request = await prisma.credentialVerificationRequest.create({
    data: {
      claimantProfileId,
      organizationId: parsed.data.organizationId,
      credentialType: parsed.data.credentialType,
      requestedTitle: parsed.data.requestedTitle,
      requestedByUserId: session!.user.id,
      status: isClaimant ? 'AUTHORIZED' : 'PENDING_AUTHORIZATION',
      authorizedAt: isClaimant ? now : null,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_VERIFICATION_REQUESTED',
    targetEntity: 'CredentialVerificationRequest',
    targetId: request.id,
    metadata: { claimantProfileId, organizationId: parsed.data.organizationId, credentialType: parsed.data.credentialType },
  });

  return Response.json({ id: request.id }, { status: 201 });
}

export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const isClaimant = session!.user.role === 'CLAIMANT';
  let claimantProfileId: string | null | undefined;
  if (isClaimant) {
    claimantProfileId = session!.user.claimantProfileId;
  } else {
    const url = new URL(req.url);
    claimantProfileId = url.searchParams.get('claimantProfileId');
  }
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }

  const requests = await prisma.credentialVerificationRequest.findMany({
    where: { claimantProfileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      credentialType: true,
      requestedTitle: true,
      status: true,
      authorizedAt: true,
      declinedAt: true,
      respondedAt: true,
      responseNote: true,
      resultingCredentialRecordId: true,
      createdAt: true,
      organization: { select: { companyName: true } },
    },
  });

  return Response.json(requests);
}
