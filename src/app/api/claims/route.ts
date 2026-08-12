import { prisma } from '@/lib/prisma';
import { claimInitiationSchema } from '@/lib/validation/claim';
import { writeAuditLog } from '@/lib/audit';

const DEFAULT_WEEKLY_BENEFIT = 320.0;

export async function POST(req: Request) {
  const body = await req.json();
  const { claimantProfileId, ...rest } = body;
  const parsed = claimInitiationSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId } });
  if (!profile || profile.identityVerificationStatus !== 'VERIFIED') {
    return Response.json(
      { error: 'Identity must be verified before filing a claim.' },
      { status: 403 }
    );
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
  const url = new URL(req.url);
  const claimantProfileId = url.searchParams.get('claimantProfileId');
  if (!claimantProfileId) {
    return Response.json({ error: 'claimantProfileId is required' }, { status: 400 });
  }
  const claims = await prisma.claim.findMany({
    where: { claimantId: claimantProfileId },
    orderBy: { openedDate: 'desc' },
  });
  return Response.json(claims);
}
