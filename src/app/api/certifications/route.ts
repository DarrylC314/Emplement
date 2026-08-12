import { prisma } from '@/lib/prisma';
import { weeklyCertificationSchema } from '@/lib/validation/certification';
import { evaluateCertification } from '@/lib/decisionEngine';
import { writeAuditLog } from '@/lib/audit';

export async function POST(req: Request) {
  const body = await req.json();
  const { claimId, ...rest } = body;
  const parsed = weeklyCertificationSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { claimant: true },
  });
  if (!claim) {
    return Response.json({ error: 'Claim not found' }, { status: 404 });
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
