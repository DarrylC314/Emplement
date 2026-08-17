import { prisma } from '@/lib/prisma';
import type { Prisma, TriggerSource } from '@prisma/client';

export const FIXED_TERM_SEPARATION_REASON = 'Fixed-term/seasonal employment concluded';
const SYSTEM_ACTOR_EMAIL = 'system@emplement.internal';

// Thrown from inside processDueEvent's transaction to force a full rollback
// when a concurrent runEmploymentExpirationCheck invocation has already
// claimed this due event (stamped its separationTriggeredAt) between this
// run's SELECT and this event's own transaction. Never caught anywhere
// except the outer loop below, which treats it as a benign skip — not a
// failure. Mirrors ApplicationAlreadyResolvedError in
// src/app/api/employer/job-applications/[id]/hire/route.ts.
class AlreadyClaimedError extends Error {}

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

// Durable, audit-trail-only proof that the RESTRICTED -> REEVALUATION_REQUIRED
// -> ACTIVE sequencing invariant was actually followed for a given outcome —
// makes it provable from the AuditLog alone, without having to trust that the
// code that produced it enforced the sequencing (which it does; see
// processDueEvent below).
const STATUS_PATHS: Record<ExpirationOutcome, string[]> = {
  REACTIVATED: ['RESTRICTED', 'REEVALUATION_REQUIRED', 'ACTIVE'],
  REEVALUATION_REQUIRED: ['RESTRICTED', 'REEVALUATION_REQUIRED'],
  RETAINED_RESTRICTED: ['RESTRICTED'],
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

async function processDueEvent(
  dueEvent: DueEvent,
  trigger: Trigger,
  now: Date,
  actorUserId: string
): Promise<ExpirationCheckResult> {
  const result = await prisma.$transaction(async (tx) => {
    // Re-check (and atomically claim) the precondition the outer SELECT
    // already filtered on. This is the first write in the transaction, and
    // it happens before the SEPARATION event is created, so a lost race
    // against a concurrent runEmploymentExpirationCheck invocation (e.g. a
    // scheduled run overlapping a manually-triggered one) never leaves a
    // duplicate SEPARATION record behind — the whole transaction rolls back.
    const claim = await tx.employmentEvent.updateMany({
      where: { id: dueEvent.id, separationTriggeredAt: null },
      data: { separationTriggeredAt: now },
    });
    if (claim.count === 0) {
      throw new AlreadyClaimedError();
    }

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

    let resultData: ExpirationCheckResult;

    const claimantProfileId = dueEvent.matchedClaimantProfileId;
    if (!claimantProfileId) {
      resultData = { employmentEventId: separationEvent.id, claimantProfileId: null, outcome: null, reasons: [] };
    } else {
      const restrictedClaims = await tx.claim.findMany({
        where: { claimantId: claimantProfileId, status: 'RESTRICTED' },
      });
      if (restrictedClaims.length === 0) {
        resultData = { employmentEventId: separationEvent.id, claimantProfileId, outcome: null, reasons: [] };
      } else {
        // "Other active employment": walk every one of this claimant's
        // EmploymentEvent rows chronologically (across every employer,
        // including this one), tracking an open-HIRE *count* per employer
        // rather than a boolean — a claimant can have two separate HIRE
        // events at the same employer (e.g. two distinct fixed-term
        // postings there), and one SEPARATION should only close the oldest
        // of them, not the employer as a whole. Only the specific due
        // event's own id and the id of the SEPARATION just created above are
        // excluded; every other event, including other events at this same
        // employer, is counted.
        const claimantEvents = await tx.employmentEvent.findMany({
          where: {
            matchedClaimantProfileId: claimantProfileId,
            id: { notIn: [dueEvent.id, separationEvent.id] },
          },
          select: { employerId: true, type: true, eventDate: true, employer: { select: { companyName: true } } },
          orderBy: { eventDate: 'asc' },
        });
        const openHireCounts = new Map<string, number>();
        const employerNames = new Map<string, string | null>();
        for (const event of claimantEvents) {
          employerNames.set(event.employerId, event.employer.companyName);
          const openCount = openHireCounts.get(event.employerId) ?? 0;
          openHireCounts.set(event.employerId, event.type === 'HIRE' ? openCount + 1 : Math.max(0, openCount - 1));
        }
        const firstOpenEmployer = [...openHireCounts.entries()].find(([, count]) => count > 0);

        let outcome: ExpirationOutcome;
        let reasons: string[];

        if (firstOpenEmployer) {
          const [openEmployerId] = firstOpenEmployer;
          const otherEmployerName = employerNames.get(openEmployerId);
          outcome = 'RETAINED_RESTRICTED';
          reasons = [`Still employed at ${otherEmployerName ?? 'another employer'}`];
        } else {
          const claimant = await tx.claimantProfile.findUniqueOrThrow({
            where: { id: claimantProfileId },
            select: { identityVerificationStatus: true },
          });

          let allReactivated = true;
          const failureReasons = new Set<string>();
          for (const restrictedClaim of restrictedClaims) {
            await tx.claim.update({ where: { id: restrictedClaim.id }, data: { status: 'REEVALUATION_REQUIRED' } });
            const checkFailures = evaluateStructuralEligibility(restrictedClaim, claimant, now);
            if (checkFailures.length === 0) {
              await tx.claim.update({ where: { id: restrictedClaim.id }, data: { status: 'ACTIVE' } });
            } else {
              allReactivated = false;
              checkFailures.forEach((f) => failureReasons.add(f));
            }
          }
          outcome = allReactivated ? 'REACTIVATED' : 'REEVALUATION_REQUIRED';
          // REACTIVATED has no failure reasons by definition (that's what
          // "all reactivated" means) — give it its own explanatory reason so
          // the claimant timeline's detail line doesn't fall back to
          // silently repeating the "Claim reactivated" title verbatim.
          reasons = allReactivated ? ['Structural eligibility requirements met'] : [...failureReasons];
        }

        await tx.message.create({
          data: {
            claimantId: claimantProfileId,
            caseworkerId: null,
            subject: MESSAGE_SUBJECTS[outcome],
            body: buildMessageBody(outcome, dueEvent.employer.companyName, reasons),
          },
        });

        resultData = { employmentEventId: separationEvent.id, claimantProfileId, outcome, reasons };
      }
    }

    // Written via tx (not the standalone writeAuditLog helper) so the audit
    // record is atomic with the SEPARATION event, the separationTriggeredAt
    // stamp, and any claim/message writes above: either all of it commits
    // together, or none of it does. A post-commit audit write risks a real,
    // legally-consequential claim status change existing with zero
    // corresponding AuditLog row if the write failed after commit — and
    // since separationTriggeredAt would already be set, the due-event SELECT
    // would never re-select it for a retry.
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
        targetEntity: 'EmploymentEvent',
        targetId: resultData.employmentEventId,
        metadata: {
          outcome: resultData.outcome,
          reasons: resultData.reasons,
          triggerSource: trigger.source,
          ...(resultData.outcome ? { statusPath: STATUS_PATHS[resultData.outcome] } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    return resultData;
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
      const result = await processDueEvent(dueEvent, trigger, now, actorUserId);
      summary.separationsCreated += 1;
      summary.results.push(result);

      if (result.outcome === 'RETAINED_RESTRICTED') summary.claimsRetainedRestricted += 1;
      else if (result.outcome === 'REEVALUATION_REQUIRED') summary.claimsSentToReevaluation += 1;
      else if (result.outcome === 'REACTIVATED') summary.claimsReactivated += 1;
    } catch (err) {
      if (err instanceof AlreadyClaimedError) {
        // A concurrent invocation already claimed this due event between
        // our SELECT and this event's own transaction — not a failure,
        // just skip it. That other run is (or already has) fully processed
        // it, including its own audit log entry.
        continue;
      }
      summary.failures.push({
        employmentEventId: dueEvent.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return summary;
}
