# Employment Expiration Design

## Purpose

Phase 3's marketplace hire flow auto-restricts a claimant's active claim the
moment they're hired, but nothing ever reverses that. A claimant hired into
a fixed-term or seasonal position stays `RESTRICTED` forever after their
term ends, even though they may be eligible to resume benefits. This spec
(Phase 4, sub-project C of the founding design's deferred "employment
expiration" item) adds automated tracking of fixed-term end dates and a
scheduled process that separates expired employment and re-evaluates the
affected claim — driven by a real background job, never by a page load,
because the state changes involved are legally consequential.

## Background

`JobPosting` and `EmploymentEvent` currently have no concept of a term end
date — every marketplace hire is treated as open-ended. The hire route
(`src/app/api/employer/job-applications/[id]/hire/route.ts`) creates a
`HIRE` `EmploymentEvent` and flips the claimant's `ACTIVE` claim to
`RESTRICTED` in one transaction. `SEPARATION` events already exist as a type
on `EmploymentEvent` but currently have zero automated side effects — they're
informational only, created solely through the employer-reported-events
route (`src/app/api/employer/events/route.ts`), which never touches claim
status at all.

The only existing eligibility logic in the codebase,
`evaluateCertification()` in `src/lib/decisionEngine.ts`, evaluates a
specific week's certification answers (able-and-available, worked-this-week,
earnings, refused-work, job-search count) — inputs a claimant supplies on
submission. It cannot run unattended inside a background job, so this
feature introduces a separate, narrower set of structural eligibility
checks purpose-built for expiration processing.

## Scope

**In scope:**

- An optional fixed-term end date on `JobPosting`, propagated to the
  `EmploymentEvent` created at marketplace hire time.
- A shared, framework-agnostic function that finds due fixed-term
  employments, creates the matching `SEPARATION` event, and re-evaluates
  the claimant's claim.
- A new `REEVALUATION_REQUIRED` claim status as a mandatory intermediate
  state — expiration never flips `RESTRICTED` straight to `ACTIVE`.
- Two callers of that shared function: a scheduled Render Cron Job (the
  real, unattended trigger) and a role-gated manual "run expiration check"
  control on the staff dashboard (for demos and administrative recovery
  after a missed/failed scheduled run).
- Explicit trigger-source and separation-reason attribution on every
  generated record.
- Explicit Central Time interpretation of fixed-term end dates, with all
  storage and comparison in UTC.
- An administrative results summary returned by the manual control.

**Out of scope:**

- Employer-reported (`/api/employer/events`) `HIRE` events. That route
  never restricts a claim in the first place, so there's nothing for
  expiration to reverse; adding fixed-term tracking there is a separate,
  later decision if ever needed.
- A staff-facing queue/list of claims currently in `REEVALUATION_REQUIRED`.
  Today a caseworker finds one only by looking up that specific claimant
  (`/staff/claimants/[id]` already shows the status via `StatusBadge` and
  will show the outcome on the case timeline). A dedicated queue view is a
  reasonable future addition, not built here.
- Any change to how `WeeklyCertification` submission evaluates eligibility
  (`evaluateCertification()` is untouched).
- Sub-projects A (vehicle/desk photo capture), B (belongings disbursal), and
  D (meeting scheduling) — separate Phase 4 sub-projects, brainstormed and
  built independently.

**Non-goal, stated plainly:** the structural eligibility checks below are
system-verifiable facts (benefit year validity, identity verification
status, other active employment), not a legal determination of benefit
eligibility. This is a demo/pilot system — per the founding spec's own
Non-Goals section, it is not a substitute for real unemployment-law
compliance review, and a `REEVALUATION_REQUIRED` claim that fails a
structural check is deliberately left for a human caseworker rather than
denied automatically.

## Data model

```prisma
enum ClaimStatus {
  ACTIVE
  RESTRICTED
  REEVALUATION_REQUIRED
  DENIED
  CLOSED
}

enum TriggerSource {
  SYSTEM_SCHEDULED
  SYSTEM_MANUAL_CHECK
  STAFF
}

model JobPosting {
  // ...existing fields...
  expectedEndDate DateTime?
}

model EmploymentEvent {
  // ...existing fields...
  expectedEndDate       DateTime?
  separationTriggeredAt DateTime?
  reason                String?
  triggerSource         TriggerSource?
  triggeredByUserId     String?
  // Named relation: EmploymentEvent already has one User? relation
  // (dismissedBy), so a second needs an explicit name to disambiguate.
  triggeredByUser       User?          @relation("EmploymentEventTriggeredBy", fields: [triggeredByUserId], references: [id])
}
```

- `JobPosting.expectedEndDate`: set optionally by the employer when creating
  or editing a posting ("this is a fixed-term or seasonal position, ending
  on..."). `null` means open-ended, the current behavior for every existing
  posting.
- `EmploymentEvent.expectedEndDate`: copied from the posting at hire time.
  Only ever set on marketplace-originated `HIRE` events; employer-reported
  events never populate it, so they're never selected for expiration
  processing.
- `EmploymentEvent.separationTriggeredAt`: stamped the moment a `HIRE`
  event's expiration has been processed. Makes the check idempotent — a
  `HIRE` event is only ever eligible while this is `null`.
- `EmploymentEvent.reason`: free-text separation reason, populated as
  exactly `"Fixed-term/seasonal employment concluded"` on the generated
  `SEPARATION` event. `null` on every other event (manually reported events
  carry no structured reason today, and this feature doesn't retrofit one).
- `EmploymentEvent.triggerSource` / `triggeredByUserId`: provenance of the
  generated `SEPARATION` event. `SYSTEM_SCHEDULED` for the unattended cron
  run, `SYSTEM_MANUAL_CHECK` for a staff-triggered run of the same
  algorithm (the specific staff member is separately captured on the
  `AuditLog` row for that run — see below), `STAFF` reserved for a future
  flow where a caseworker directly records a separation outside this
  algorithm (no code path in this feature produces `STAFF`; documented here
  rather than left as a silent gap). `triggeredByUserId` is only populated
  when `triggerSource = STAFF`.

**Migration note:** all four new `EmploymentEvent` fields are nullable —
existing rows need no backfill, matching this codebase's established
additive-migration pattern (e.g. the guided-demo-scenario `ssnHash`
backfill was written to be non-clobbering for the same reason).

## Central Time handling

Fixed-term end dates are a business concept ("this seasonal role ends
November 30") that a Missouri-based caseworker or employer thinks about in
Central Time, not UTC. All storage and comparison stays in UTC — only the
*interpretation* of a calendar date as an instant is Central-Time-aware,
done once, at write time:

- New helper `src/lib/centralTime.ts`, exporting
  `centralTimeEndOfDayToUtc(dateOnly: string): Date` — given a
  `YYYY-MM-DD` calendar date, returns the UTC instant corresponding to
  `23:59:59.999` in `America/Chicago` on that date (correctly accounting
  for whichever of CST/CDT applies to that specific date). Validates its
  input and throws (rather than returning an invalid `Date`) when
  `dateOnly` isn't a well-formed `YYYY-MM-DD` string.
- The employer's posting form calls this once, when saving
  `JobPosting.expectedEndDate`. The value copied to
  `EmploymentEvent.expectedEndDate` at hire time is already the correct UTC
  instant — no further timezone math needed anywhere else.
- The expiration check's "is this due" test is a plain UTC comparison:
  `expectedEndDate <= now()`. Because the Central-Time interpretation
  already happened at write time, this is correct regardless of what
  timezone the cron job or the caseworker's browser happens to run in.
- Mirrors this codebase's existing `formatInterviewTime.ts` precedent
  (explicit `timeZone: 'America/Chicago'`, verified output before being
  written into source) — same principle applied to the write side instead
  of the display side.

## Business logic: `runEmploymentExpirationCheck()`

New module `src/lib/employmentExpiration.ts`. Signature:

```ts
type ExpirationOutcome = 'REACTIVATED' | 'REEVALUATION_REQUIRED' | 'RETAINED_RESTRICTED';

type ExpirationCheckResult = {
  employmentEventId: string;
  claimantProfileId: string;
  outcome: ExpirationOutcome;
  reasons: string[];
};

type ExpirationCheckSummary = {
  recordsEvaluated: number;
  separationsCreated: number;
  claimsRetainedRestricted: number;
  claimsSentToReevaluation: number;
  claimsReactivated: number;
  failures: { employmentEventId: string; error: string }[];
  results: ExpirationCheckResult[];
};

async function runEmploymentExpirationCheck(
  trigger: { source: TriggerSource; userId?: string }
): Promise<ExpirationCheckSummary>;
```

**Selection:** all `EmploymentEvent` rows where `type = HIRE`,
`expectedEndDate` is not `null`, `expectedEndDate <= now()`, and
`separationTriggeredAt IS NULL`. This is `recordsEvaluated`.

**Per due event, in its own transaction** (one event's failure doesn't
abort the batch — caught individually and recorded under `failures`):

1. Create the `SEPARATION` `EmploymentEvent`: same `employerId`,
   `employeeName`, `ssnHash`, `matchedClaimantProfileId` as the original
   `HIRE` event; `eventDate` = the original `expectedEndDate`;
   `reason` = `"Fixed-term/seasonal employment concluded"`;
   `triggerSource` / `triggeredByUserId` from the `trigger` argument.
2. Stamp `separationTriggeredAt = now()` on the original `HIRE` event.
3. Check whether the claimant has any `RESTRICTED` claim at all. If not,
   nothing further to do — record the event but no outcome to report beyond
   the separation itself (this can happen if a caseworker already manually
   changed the claim's status for an unrelated reason). A claimant could in
   principle have more than one `RESTRICTED` claim (separate benefit years);
   steps 4–5 apply uniformly to all of the claimant's `RESTRICTED` claims via
   a single `updateMany`, the same pattern the hire route already uses
   against `status: 'ACTIVE'`.
4. **Check for other active employment:** walk every one of this claimant's
   `EmploymentEvent` rows chronologically (across every employer, including
   this one), excluding only the due `HIRE` event's own id and the
   `SEPARATION` event just created, tracking an open-`HIRE` *count* per
   employer (incremented on `HIRE`, decremented on `SEPARATION`). This is
   deliberately a per-employer balance rather than a blanket "exclude this
   whole employer" check: a claimant can have two separate `HIRE` events at
   the same employer (e.g. two distinct fixed-term postings there), and one
   `SEPARATION` should only close the oldest of them, not the employer as a
   whole. If any employer — including possibly this same employer, via a
   second still-open hire there — has a positive open-`HIRE` count after the
   walk:
   - Outcome: `RETAINED_RESTRICTED`. Claim status is untouched (stays
     `RESTRICTED`). `reasons` records the other employer's name.
5. **If this was the final active employment:** the claim *always* moves
   through `REEVALUATION_REQUIRED` first — expiration never sets `ACTIVE`
   directly, regardless of how clean the structural checks look:
   - Update claim status `RESTRICTED → REEVALUATION_REQUIRED`.
   - Run the structural eligibility checks against the claim/claimant as
     they stand *after* that transition:
     - Benefit year hasn't ended (`claim.benefitYearEnd >= now()`).
     - Identity verification is still `VERIFIED`
       (`claimantProfile.identityVerificationStatus === 'VERIFIED'`).
   - **All pass:** update claim status `REEVALUATION_REQUIRED → ACTIVE`.
     Outcome: `REACTIVATED`.
   - **Any fail:** claim stays `REEVALUATION_REQUIRED`. Outcome:
     `REEVALUATION_REQUIRED`. `reasons` lists which check(s) failed, for a
     caseworker reviewing the claimant's page to act on.
6. Write a `Message` to the claimant summarizing the outcome in plain
   language (three variants matching the three outcomes above).
7. Write one `AuditLog` entry, `action: 'EMPLOYMENT_EXPIRATION_PROCESSED'`,
   `targetEntity: 'EmploymentEvent'`, `targetId` = the new `SEPARATION`
   event's id, `metadata: { outcome, reasons, triggerSource, statusPath }`.
   `statusPath` records the claim status transition path actually taken —
   `['RESTRICTED', 'REEVALUATION_REQUIRED', 'ACTIVE']` for `REACTIVATED`,
   `['RESTRICTED', 'REEVALUATION_REQUIRED']` for `REEVALUATION_REQUIRED`, and
   `['RESTRICTED']` (unchanged) for `RETAINED_RESTRICTED` — so an auditor can
   confirm the mandatory intermediate-state sequencing from the `AuditLog`
   alone, without having to trust the code that produced it. Omitted when
   there's no outcome to report (no matched claimant, or no `RESTRICTED`
   claim to act on). `reasons` is non-empty for every outcome, including
   `REACTIVATED` (`['Structural eligibility requirements met']`) — it's
   never an empty array. `actorUserId`
   is the real caseworker's session id for `SYSTEM_MANUAL_CHECK` runs (the
   route is already session-gated), or a seeded system service account
   (`system@emplement.internal`, added to `prisma/seed.ts` alongside the
   other fixture accounts) for unattended `SYSTEM_SCHEDULED` runs — needed
   because `AuditLog.actorUserId` is a required foreign key to `User` and a
   cron run has no session to attribute to otherwise.

**Aggregation:** the summary's counts and `results` array are built up as
each event is processed; `failures` collects `{ employmentEventId, error }`
for any event whose transaction threw, without stopping the loop.

## Two callers, one function

- **`prisma/checkEmploymentExpirations.ts`** (script, same convention as
  `prisma/seed.ts`): calls `runEmploymentExpirationCheck({ source:
  'SYSTEM_SCHEDULED' })`, logs the summary, exits. Wired as
  `npm run check:employment-expirations`.
- **`render.yaml`**: adds a Cron Job service running that script on a daily
  schedule. This defines the service as code, but connecting/enabling it in
  the Render dashboard is a manual step outside this repo (the same kind of
  one-time operational action the original Neon/Render provisioning was).
- **`POST /api/staff/employment-expirations/run-check`**:
  `requireRole(session, ['CASEWORKER', 'ADMIN'])`, calls
  `runEmploymentExpirationCheck({ source: 'SYSTEM_MANUAL_CHECK', userId:
  session.user.id })`, returns the `ExpirationCheckSummary` as JSON.
- **Staff dashboard button:** "Run expiration check now" on
  `src/app/staff/dashboard/page.tsx`, calling the route above. On response,
  renders the results plainly: records evaluated, separations created,
  claims retained as Restricted, claims sent for reevaluation (broken down
  into reactivated vs. still pending), and any failures with their error
  messages — the full `ExpirationCheckSummary`, not a collapsed
  success/failure toast.

## Corollaries to existing behavior

- **`POST /api/certifications`**: currently blocks only `DENIED`/`CLOSED`
  claims from accepting a new weekly certification (`RESTRICTED` is
  allowed). Adding `REEVALUATION_REQUIRED` to that block — a claim actively
  pending reevaluation shouldn't accept a new certification until it's
  resolved one way or the other.
- **`StatusBadge`**: new `REEVALUATION_REQUIRED` entry ("Reevaluation
  required"), new status color tokens alongside the existing
  active/restricted/denied set.
- **`buildClaimantTimeline`**: the `SEPARATION` event already renders as
  "Separated" (existing `TimelineEmploymentEvent` handling). This adds a
  second, synthesized entry alongside it, one of three variants matching
  the outcome: "Claim reactivated", "Reevaluation required — <failing
  check(s)>", or "Claim remains restricted — still employed at
  <other employer>". Mirrors the existing "Claim automatically restricted"
  synthesized-entry pattern.

## Error handling

- A due `HIRE` event whose transaction throws (e.g. an unexpected data
  inconsistency) is caught individually, recorded in `failures` with its
  error message, and does not stop the rest of the batch from processing.
- `POST /api/staff/employment-expirations/run-check` (there is no `GET` on
  this route) returns a normal 200 with the summary even when some records
  failed — `failures` being non-empty is informational, not an HTTP-level
  error. A total failure to run at all (e.g. a database connection error)
  surfaces as a normal 500.
- The staff dashboard renders a failed fetch of the run-check route with
  the same inline-error pattern used elsewhere in the app, and does not
  clear or hide the previous run's results.

## Testing

- Unit: `centralTimeEndOfDayToUtc()` — known dates on both sides of the
  Central Time DST boundary, verified against known correct UTC instants.
- Unit: `runEmploymentExpirationCheck()` — covers all three outcomes
  (reactivated, reevaluation-required-and-failed, retained-restricted-due-
  to-other-employment), the idempotency guarantee (a second run against the
  same data processes zero records), a failing individual record not
  blocking the rest of the batch, and correct `triggerSource`/
  `triggeredByUserId` attribution for both callers.
- Integration: `POST /api/staff/employment-expirations/run-check` — role
  gate (`CASEWORKER`/`ADMIN` only), correct summary shape, correct
  `AuditLog` attribution to the calling caseworker.
- Integration: `POST /api/certifications` — `REEVALUATION_REQUIRED` claims
  are rejected the same way `DENIED`/`CLOSED` claims are today.
- Component: staff dashboard's "Run expiration check now" button renders
  the full summary breakdown, including a non-empty `failures` list.
- E2E: seed a fixed-term hire with an already-past `expectedEndDate`,
  trigger the manual check from the staff dashboard, and confirm the
  claimant's case page timeline shows the new "Separated" and outcome
  entries, and the claim's `StatusBadge` reflects the resulting status.

## Success criteria

A fixed-term hire's end date passes; without any user loading any page, the
scheduled job (or, for a demo, the staff "run expiration check now" button)
creates the separation record with an explicit reason and trigger
attribution, moves the claim through `REEVALUATION_REQUIRED`, and either
reactivates it or leaves it for a caseworker with a clear reason recorded —
never skipping the intermediate state, never silently reactivating a claim
that shouldn't be.
