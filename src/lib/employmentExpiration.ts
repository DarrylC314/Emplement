import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import type { TriggerSource } from '@prisma/client';

export const FIXED_TERM_SEPARATION_REASON = 'Fixed-term/seasonal employment concluded';
const SYSTEM_ACTOR_EMAIL = 'system@emplement.internal';

export type ExpirationOutcome = 'REACTIVATED' | 'REEVALUATION_REQUIRED' | 'RETAINED_RESTRICTED';

export type ExpirationCheckResult = {
  employmentEventId: string;
  claimantProfileId: string | null;
  outcome: ExpirationOutcome | null;
  reasons: string[];
};

export type ExpirationCheckSummary = {
  recordsEvaluated: number;
  separationsCreated: number;
  claimsRetainedRestricted: number;
  claimsSentToReevaluation: number;
  claimsReactivated: number;
  failures: { employmentEventId: string; error: string }[];
  results: ExpirationCheckResult[];
};

type Trigger = { source: TriggerSource; userId?: string };

const MESSAGE_SUBJECTS: Record<ExpirationOutcome, string> = {
  REACTIVATED: 'Your claim has been reactivated',
  REEVALUATION_REQUIRED: 'Your claim is under review',
  RETAINED_RESTRICTED: 'Your fixed-term employment has ended',
};

function buildMessageBody(outcome: ExpirationOutcome, employerName: string | null, reasons: string[]): string {
  const employer = employerName ?? 'your employer';
  if (outcome === 'REACTIVATED') {
    return `Your fixed-term position at ${employer} ended on its scheduled date. Your claim has been reactivated and you may resume weekly certifications.`;
  }
  if (outcome === 'REEVALUATION_REQUIRED') {
    return `Your fixed-term position at ${employer} ended on its scheduled date. Your claim has been placed under review by a caseworker before benefits can resume. You will be notified once this review is complete.`;
  }
  return `Your fixed-term position at ${employer} ended on its scheduled date. Your claim remains Restricted: ${
    reasons[0] ?? 'you are still employed elsewhere'
  }. If you believe this is incorrect, please contact your caseworker.`;
}

function evaluateStructuralEligibility(
  claim: { benefitYearEnd: Date },
  claimant: { identityVerificationStatus: string },
  now: Date
): string[] {
  const failures: string[] = [];
  if (claim.benefitYearEnd < now) failures.push('Benefit year has ended');
  if (claimant.identityVerificationStatus !== 'VERIFIED') failures.push('Identity verification is not VERIFIED');
  return failures;
}

type DueEvent = {
  id: string;
  employerId: string;
  employeeName: string;
  ssnHash: string;
  expectedEndDate: Date | null;
  matchedClaimantProfileId: string | null;
  employer: { companyName: string | null };
};

async function processDueEvent(dueEvent: DueEvent, trigger: Trigger, now: Date): Promise<ExpirationCheckResult> {
  const result = await prisma.$transaction(async (tx) => {
    const separationEvent = await tx.employmentEvent.create({
      data: {
        employerId: dueEvent.employerId,
        type: 'SEPARATION',
        employeeName: dueEvent.employeeName,
        ssnHash: dueEvent.ssnHash,
        eventDate: dueEvent.expectedEndDate!,
        matchedClaimantProfileId: dueEvent.matchedClaimantProfileId,
        reason: FIXED_TERM_SEPARATION_REASON,
        triggerSource: trigger.source,
        triggeredByUserId: trigger.source === 'STAFF' ? (trigger.userId ?? null) : null,
      },
    });

    await tx.employmentEvent.update({
      where: { id: dueEvent.id },
      data: { separationTriggeredAt: now },
    });

    const claimantProfileId = dueEvent.matchedClaimantProfileId;
    if (!claimantProfileId) {
      return { employmentEventId: separationEvent.id, claimantProfileId: null, outcome: null, reasons: [] as string[] };
    }

    const restrictedClaims = await tx.claim.findMany({
      where: { claimantId: claimantProfileId, status: 'RESTRICTED' },
    });
    if (restrictedClaims.length === 0) {
      return { employmentEventId: separationEvent.id, claimantProfileId, outcome: null, reasons: [] as string[] };
    }

    // "Other active employment": walk every other employer's events for
    // this claimant chronologically, tracking which employers are
    // currently "open" (a HIRE with no later SEPARATION at that same
    // employer). This employer's own history is excluded — we're asking
    // whether the claimant is employed *elsewhere*.
    const otherEvents = await tx.employmentEvent.findMany({
      where: { matchedClaimantProfileId: claimantProfileId, employerId: { not: dueEvent.employerId } },
      select: { employerId: true, type: true, eventDate: true, employer: { select: { companyName: true } } },
      orderBy: { eventDate: 'asc' },
    });
    const openEmployers = new Map<string, string | null>();
    for (const event of otherEvents) {
      if (event.type === 'HIRE') openEmployers.set(event.employerId, event.employer.companyName);
      else openEmployers.delete(event.employerId);
    }

    let outcome: ExpirationOutcome;
    let reasons: string[];

    if (openEmployers.size > 0) {
      const [otherEmployerName] = openEmployers.values();
      outcome = 'RETAINED_RESTRICTED';
      reasons = [`Still employed at ${otherEmployerName ?? 'another employer'}`];
    } else {
      const claimant = await tx.claimantProfile.findUniqueOrThrow({
        where: { id: claimantProfileId },
        select: { identityVerificationStatus: true },
      });

      let allReactivated = true;
      const failureReasons = new Set<string>();
      for (const claim of restrictedClaims) {
        await tx.claim.update({ where: { id: claim.id }, data: { status: 'REEVALUATION_REQUIRED' } });
        const checkFailures = evaluateStructuralEligibility(claim, claimant, now);
        if (checkFailures.length === 0) {
          await tx.claim.update({ where: { id: claim.id }, data: { status: 'ACTIVE' } });
        } else {
          allReactivated = false;
          checkFailures.forEach((f) => failureReasons.add(f));
        }
      }
      outcome = allReactivated ? 'REACTIVATED' : 'REEVALUATION_REQUIRED';
      reasons = [...failureReasons];
    }

    await tx.message.create({
      data: {
        claimantId: claimantProfileId,
        caseworkerId: null,
        subject: MESSAGE_SUBJECTS[outcome],
        body: buildMessageBody(outcome, dueEvent.employer.companyName, reasons),
      },
    });

    return { employmentEventId: separationEvent.id, claimantProfileId, outcome, reasons };
  });

  return result;
}

let cachedSystemActorUserId: string | null = null;
async function getSystemActorUserId(): Promise<string> {
  if (cachedSystemActorUserId) return cachedSystemActorUserId;
  const user = await prisma.user.findUniqueOrThrow({ where: { email: SYSTEM_ACTOR_EMAIL } });
  cachedSystemActorUserId = user.id;
  return cachedSystemActorUserId;
}

export async function runEmploymentExpirationCheck(trigger: Trigger): Promise<ExpirationCheckSummary> {
  const now = new Date();
  const actorUserId =
    trigger.source === 'SYSTEM_SCHEDULED' ? await getSystemActorUserId() : trigger.userId;
  if (!actorUserId) {
    throw new Error(`A userId is required to run an expiration check with trigger source ${trigger.source}`);
  }

  const dueEvents = await prisma.employmentEvent.findMany({
    where: { type: 'HIRE', expectedEndDate: { lte: now }, separationTriggeredAt: null },
    select: {
      id: true,
      employerId: true,
      employeeName: true,
      ssnHash: true,
      expectedEndDate: true,
      matchedClaimantProfileId: true,
      employer: { select: { companyName: true } },
    },
  });

  const summary: ExpirationCheckSummary = {
    recordsEvaluated: dueEvents.length,
    separationsCreated: 0,
    claimsRetainedRestricted: 0,
    claimsSentToReevaluation: 0,
    claimsReactivated: 0,
    failures: [],
    results: [],
  };

  for (const dueEvent of dueEvents) {
    try {
      const result = await processDueEvent(dueEvent, trigger, now);
      summary.separationsCreated += 1;
      summary.results.push(result);

      await writeAuditLog({
        actorUserId,
        action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
        targetEntity: 'EmploymentEvent',
        targetId: result.employmentEventId,
        metadata: { outcome: result.outcome, reasons: result.reasons, triggerSource: trigger.source },
      });

      if (result.outcome === 'RETAINED_RESTRICTED') summary.claimsRetainedRestricted += 1;
      else if (result.outcome === 'REEVALUATION_REQUIRED') summary.claimsSentToReevaluation += 1;
      else if (result.outcome === 'REACTIVATED') summary.claimsReactivated += 1;
    } catch (err) {
      summary.failures.push({
        employmentEventId: dueEvent.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return summary;
}
