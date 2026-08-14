export type CertificationInput = {
  ableAndAvailable: boolean;
  workedThisWeek: boolean;
  earnings: number;
  refusedWork: boolean;
  jobSearchActivityCount: number;
};

export type DecisionResult = {
  decision: 'APPROVED' | 'FLAGGED' | 'DENIED';
  reason: string;
  ruleId: string;
  threshold?: string;
  actualValue?: string;
};

const MIN_JOB_SEARCH_CONTACTS = 3;

/**
 * Evaluates a weekly certification against the fixed rule set, in order.
 * First matching rule wins. Malformed input (negative counts/amounts) is
 * treated as unresolvable and defaults to FLAGGED — never silent approval.
 *
 * Each branch now returns a `ruleId` (and, where a numeric comparison drives
 * the rule, `threshold`/`actualValue`) alongside the existing plain-language
 * `reason`, so callers can render a structured "why this was flagged"
 * explanation instead of only a hardcoded sentence. The rule order and
 * decisions themselves are unchanged from the original spec.
 */
export function evaluateCertification(input: CertificationInput): DecisionResult {
  if (input.earnings < 0 || input.jobSearchActivityCount < 0) {
    return {
      decision: 'FLAGGED',
      reason: 'Certification contains invalid data and requires manual review.',
      ruleId: 'INVALID_INPUT',
    };
  }

  if (!input.ableAndAvailable) {
    return {
      decision: 'DENIED',
      reason: 'Claimant reported not able and available for work this week.',
      ruleId: 'ABLE_AND_AVAILABLE',
    };
  }

  if (input.refusedWork) {
    return {
      decision: 'FLAGGED',
      reason: 'Claimant reported refusing an offer of work — requires review.',
      ruleId: 'WORK_REFUSAL',
    };
  }

  // Either signal alone is enough to flag. Requiring BOTH (the previous `&&`)
  // silently auto-approved a claimant who reported earnings but answered "No"
  // to "did you work this week" — an overpayment/fraud path. The spec states
  // "Earned income reported → Flagged for review" unconditionally.
  if (input.workedThisWeek || input.earnings > 0) {
    return {
      decision: 'FLAGGED',
      reason:
        'Claimant reported work or earnings this week — requires manual benefit calculation.',
      ruleId: 'EARNED_INCOME',
    };
  }

  if (input.jobSearchActivityCount < MIN_JOB_SEARCH_CONTACTS) {
    return {
      decision: 'FLAGGED',
      reason: `Claimant reported fewer than ${MIN_JOB_SEARCH_CONTACTS} job-search contacts.`,
      ruleId: 'JOB_SEARCH_MINIMUM',
      threshold: `${MIN_JOB_SEARCH_CONTACTS} contacts`,
      actualValue: `${input.jobSearchActivityCount} contacts`,
    };
  }

  return { decision: 'APPROVED', reason: 'All eligibility criteria met.', ruleId: 'ALL_CRITERIA_MET' };
}
