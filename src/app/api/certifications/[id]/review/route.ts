import { prisma } from '@/lib/prisma';
import { reviewActionSchema } from '@/lib/validation/review';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const body = await req.json();
  const { caseworkerId, ...rest } = body;
  if (!caseworkerId) {
    return Response.json({ error: 'caseworkerId is required' }, { status: 400 });
  }

  const parsed = reviewActionSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === 'AMOUNT_ADJUSTED') {
    const amount = Number(parsed.data.newValue);
    if (!parsed.data.newValue || !Number.isFinite(amount) || amount <= 0) {
      return Response.json(
        { error: 'A valid positive newValue is required when action is AMOUNT_ADJUSTED' },
        { status: 400 }
      );
    }
  }

  const certification = await prisma.weeklyCertification.findUnique({
    where: { id: params.id },
    include: { claim: true },
  });
  if (!certification) {
    return Response.json({ error: 'Certification not found' }, { status: 404 });
  }

  const reviewAction = await prisma.claimReviewAction.create({
    data: {
      weeklyCertificationId: params.id,
      caseworkerId,
      action: parsed.data.action,
      reason: parsed.data.reason,
      previousValue:
        parsed.data.action === 'AMOUNT_ADJUSTED'
          ? certification.claim.weeklyBenefitAmount.toString()
          : undefined,
      newValue: parsed.data.newValue,
    },
  });

  let nextStatus: 'ACTIVE' | 'DENIED' | 'RESTRICTED' = certification.claim.status as
    | 'ACTIVE'
    | 'DENIED'
    | 'RESTRICTED';
  if (parsed.data.action === 'APPROVED') nextStatus = 'ACTIVE';
  if (parsed.data.action === 'DENIED') nextStatus = 'DENIED';
  if (parsed.data.action === 'FLAGGED_FOR_FRAUD') nextStatus = 'RESTRICTED';

  await prisma.claim.update({
    where: { id: certification.claimId },
    data: {
      status: nextStatus,
      ...(parsed.data.action === 'AMOUNT_ADJUSTED' && parsed.data.newValue
        ? { weeklyBenefitAmount: Number(parsed.data.newValue) }
        : {}),
    },
  });

  await writeAuditLog({
    actorUserId: caseworkerId,
    action: 'CLAIM_REVIEWED',
    targetEntity: 'ClaimReviewAction',
    targetId: reviewAction.id,
    metadata: { certificationId: params.id, decision: parsed.data.action },
  });

  return Response.json(reviewAction, { status: 201 });
}
