import { prisma } from '@/lib/prisma';
import { weeklyCertificationSchema } from '@/lib/validation/certification';
import { evaluateCertification } from '@/lib/decisionEngine';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ claimId?: string } & Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const { claimId, ...rest } = body;
  if (!claimId) {
    return apiError('claimId is required', 400);
  }

  const parsed = weeklyCertificationSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { claimant: true },
  });
  if (!claim) {
    return apiError('Claim not found', 404);
  }

  const owns = requireOwnership(session, claim.claimantId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  // A closed or denied claim is terminal: accepting a new weekly certification
  // against one would let a claimant certify weeks on a claim that is no longer
  // payable, and would silently flip its status back to ACTIVE/RESTRICTED below.
  if (claim.status === 'DENIED' || claim.status === 'CLOSED') {
    return apiError(
      `This claim is ${claim.status.toLowerCase()} and can no longer accept weekly certifications.`,
      409
    );
  }

  const decision = evaluateCertification({
    ableAndAvailable: parsed.data.ableAndAvailable,
    workedThisWeek: parsed.data.workedThisWeek,
    earnings: parsed.data.earnings,
    refusedWork: parsed.data.refusedWork,
    jobSearchActivityCount: parsed.data.jobSearchActivities.length,
  });

  const certification = await prisma.weeklyCertification.create({
    data: {
      claimId,
      weekEndingDate: new Date(parsed.data.weekEndingDate),
      ableAndAvailable: parsed.data.ableAndAvailable,
      workedThisWeek: parsed.data.workedThisWeek,
      earnings: parsed.data.earnings,
      refusedWork: parsed.data.refusedWork,
      autoDecision: decision.decision,
      autoDecisionReason: decision.reason,
      autoDecisionRuleId: decision.ruleId,
      autoDecisionThreshold: decision.threshold,
      autoDecisionActualValue: decision.actualValue,
      jobSearchActivities: {
        create: parsed.data.jobSearchActivities.map((a) => ({
          employerName: a.employerName,
          contactMethod: a.contactMethod,
          contactDate: new Date(a.contactDate),
          position: a.position,
        })),
      },
    },
  });

  if (decision.decision === 'DENIED') {
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'DENIED' } });
  } else if (decision.decision === 'FLAGGED') {
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'RESTRICTED' } });
  }

  await writeAuditLog({
    actorUserId: claim.claimant.userId,
    action: 'CERTIFICATION_SUBMITTED',
    targetEntity: 'WeeklyCertification',
    targetId: certification.id,
    metadata: { autoDecision: decision.decision },
  });

  return Response.json(certification, { status: 201 });
}
