import { prisma } from '@/lib/prisma';
import { claimInitiationSchema } from '@/lib/validation/claim';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

const DEFAULT_WEEKLY_BENEFIT = 320.0;

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
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

  const parsed = claimInitiationSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
  if (!profile || profile.identityVerificationStatus !== 'VERIFIED') {
    return apiError('Identity must be verified before filing a claim.', 403);
  }

  const start = new Date(parsed.data.benefitYearStart);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);

  const claim = await prisma.claim.create({
    data: {
      claimantId: claimantProfileId,
      status: 'ACTIVE',
      benefitYearStart: start,
      benefitYearEnd: end,
      weeklyBenefitAmount: DEFAULT_WEEKLY_BENEFIT,
    },
  });

  await writeAuditLog({
    actorUserId: profile.userId,
    action: 'CLAIM_OPENED',
    targetEntity: 'Claim',
    targetId: claim.id,
  });

  return Response.json(claim, { status: 201 });
}

export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const url = new URL(req.url);
  const claimantProfileId = url.searchParams.get('claimantProfileId');
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }

  const owns = requireOwnership(session, claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  const claims = await prisma.claim.findMany({
    where: { claimantId: claimantProfileId },
    orderBy: { openedDate: 'desc' },
  });
  return Response.json(claims);
}
