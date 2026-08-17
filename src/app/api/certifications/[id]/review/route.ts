import type { ClaimStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { reviewActionSchema } from '@/lib/validation/review';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { findConflictingWageRecords } from '@/lib/conflictingData';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const certification = await prisma.weeklyCertification.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      weekEndingDate: true,
      ableAndAvailable: true,
      workedThisWeek: true,
      earnings: true,
      refusedWork: true,
      autoDecision: true,
      autoDecisionReason: true,
      autoDecisionRuleId: true,
      autoDecisionThreshold: true,
      autoDecisionActualValue: true,
      jobSearchActivities: {
        select: { id: true, employerName: true, contactMethod: true, contactDate: true, position: true },
      },
      claim: {
        select: {
          id: true,
          status: true,
          weeklyBenefitAmount: true,
          claimant: { select: { legalName: true } },
          certifications: {
            orderBy: { weekEndingDate: 'desc' },
            select: { id: true, weekEndingDate: true, autoDecision: true, autoDecisionReason: true },
          },
          caseNotes: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, note: true, createdAt: true },
          },
          wageRecords: {
            select: {
              id: true,
              employerName: true,
              fein: true,
              workLocation: true,
              jobTitle: true,
              firstDayWorked: true,
              lastDayWorked: true,
              wageRate: true,
              hoursPerWeek: true,
              separationReason: true,
              recallDate: true,
              employerVerifiedStatus: true,
              employerDisputeNote: true,
              source: true,
              claimantConfirmed: true,
              claimantDisputeNote: true,
            },
          },
          documents: {
            orderBy: { uploadedAt: 'desc' },
            select: { id: true, filename: true, uploadedAt: true },
          },
        },
      },
    },
  });

  if (!certification) {
    return apiError('Certification not found', 404);
  }

  const conflicts = findConflictingWageRecords(
    {
      workedThisWeek: certification.workedThisWeek,
      earnings: Number(certification.earnings),
      weekEndingDate: certification.weekEndingDate,
    },
    certification.claim.wageRecords.map((r) => ({
      id: r.id,
      lastDayWorked: r.lastDayWorked,
      recallDate: r.recallDate,
    }))
  );

  return Response.json({
    certification: {
      id: certification.id,
      weekEndingDate: certification.weekEndingDate,
      ableAndAvailable: certification.ableAndAvailable,
      workedThisWeek: certification.workedThisWeek,
      earnings: certification.earnings,
      refusedWork: certification.refusedWork,
      autoDecision: certification.autoDecision,
      autoDecisionReason: certification.autoDecisionReason,
      autoDecisionRuleId: certification.autoDecisionRuleId,
      autoDecisionThreshold: certification.autoDecisionThreshold,
      autoDecisionActualValue: certification.autoDecisionActualValue,
    },
    jobSearchActivities: certification.jobSearchActivities,
    claim: {
      id: certification.claim.id,
      status: certification.claim.status,
      weeklyBenefitAmount: certification.claim.weeklyBenefitAmount,
      claimantName: certification.claim.claimant.legalName,
    },
    certificationHistory: certification.claim.certifications.filter((c) => c.id !== certification.id),
    caseNotes: certification.claim.caseNotes,
    wageRecords: certification.claim.wageRecords,
    documents: certification.claim.documents,
    conflicts,
    paymentPreview: {
      approve: certification.claim.weeklyBenefitAmount,
      deny: certification.claim.weeklyBenefitAmount,
    },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  // caseworkerId, if sent, is ignored — attribution always comes from the
  // verified session, never client input.
  const { caseworkerId: _ignoredCaseworkerId, ...rest } = body;

  const parsed = reviewActionSchema.safeParse(rest);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === 'AMOUNT_ADJUSTED') {
    const amount = Number(parsed.data.newValue);
    if (!parsed.data.newValue || !Number.isFinite(amount) || amount <= 0) {
      return apiError(
        'A valid positive newValue is required when action is AMOUNT_ADJUSTED',
        400
      );
    }
  }

  const certification = await prisma.weeklyCertification.findUnique({
    where: { id: params.id },
    include: { claim: true },
  });
  if (!certification) {
    return apiError('Certification not found', 404);
  }

  // An APPROVED review normally flips the claim straight to ACTIVE, but that
  // is only safe when the claim's CURRENT status is one this route already
  // understands as a plain approve/deny cycle. If the claim has since moved
  // to REEVALUATION_REQUIRED (e.g. the employment-expiration check ran in
  // the meantime) or CLOSED, approving a — possibly stale — flagged
  // certification must not silently clear that status: REEVALUATION_REQUIRED
  // exists specifically so a claim only ever reaches ACTIVE through the
  // structural-eligibility sequencing in src/lib/employmentExpiration.ts, not
  // through an unrelated route that predates that state. Checked before any
  // writes (mirrors the 404 check above), so a rejected request leaves no
  // partial ClaimReviewAction/Payment/AuditLog rows behind.
  if (
    parsed.data.action === 'APPROVED' &&
    (certification.claim.status === 'REEVALUATION_REQUIRED' || certification.claim.status === 'CLOSED')
  ) {
    return apiError(
      `This claim is ${certification.claim.status.toLowerCase()} and cannot be approved back to Active through a certification review.`,
      409
    );
  }

  const reviewAction = await prisma.claimReviewAction.create({
    data: {
      weeklyCertificationId: params.id,
      caseworkerId: session!.user.id,
      action: parsed.data.action,
      reason: parsed.data.reason,
      previousValue:
        parsed.data.action === 'AMOUNT_ADJUSTED'
          ? certification.claim.weeklyBenefitAmount.toString()
          : undefined,
      newValue: parsed.data.newValue,
    },
  });

  let nextStatus: ClaimStatus = certification.claim.status;
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

  // Payment ledger: records the amount paid/withheld for this decision — no
  // real money moves (matching the Phase 1 spec's non-goal of no real
  // disbursement), this only tracks what the decision implies. An
  // AMOUNT_ADJUSTED decision is treated as an approval at the corrected
  // amount, since "adjust weekly benefit amount" is itself the caseworker's
  // resolution of this week's certification, not a separate approve/deny step.
  let paymentStatus: 'PAID' | 'WITHHELD' | null = null;
  let paymentAmount = Number(certification.claim.weeklyBenefitAmount);
  if (parsed.data.action === 'APPROVED') {
    paymentStatus = 'PAID';
  } else if (parsed.data.action === 'DENIED' || parsed.data.action === 'FLAGGED_FOR_FRAUD') {
    paymentStatus = 'WITHHELD';
  } else if (parsed.data.action === 'AMOUNT_ADJUSTED') {
    paymentStatus = 'PAID';
    paymentAmount = Number(parsed.data.newValue);
  }

  if (paymentStatus) {
    await prisma.payment.create({
      data: {
        claimId: certification.claimId,
        weeklyCertificationId: params.id,
        amount: paymentAmount,
        status: paymentStatus,
      },
    });
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CLAIM_REVIEWED',
    targetEntity: 'ClaimReviewAction',
    targetId: reviewAction.id,
    metadata: { certificationId: params.id, decision: parsed.data.action },
  });

  return Response.json(reviewAction, { status: 201 });
}
