# Review Certification Evidence & Wage Confirmation — Design

## Purpose

The Caseworker Review Certification page (`/staff/certifications/[id]/review`) is currently
just a bare decision form — approve/deny/flag/adjust, with a required reason — and shows the
caseworker none of the evidence the decision is supposed to be based on. This is the most
serious usability/trust gap in the current app: a caseworker is asked to make a determination
affecting someone's benefit payment with no visibility into what they reported, why the system
flagged it, their history, or any employer/wage data on file.

This spec covers the fix: a rebuilt review page that surfaces the full evidence set, plus a new
claimant-facing step (wage-record confirmation, replacing a dead-end freeform field) that gives
the review page real employer/wage data to show.

## Relationship to the larger backlog

This is sub-project **A** of a larger set of enhancements the product owner requested. The full
set was triaged into:

- **Near-term (buildable now, this phase and its immediate successors):** A (this spec) —
  Review Certification evidence; B — claimant dashboard restriction explanation & claim detail;
  C — weekly certification UX (default job-search entries, configurable minimum-contacts rule);
  D — shared status/progress design components.
- **Later phases (each needs its own dedicated brainstorm + spec):** Employer Portal, employer
  employee-list sync / "Employment Event Network" / hire-separation events / payroll-wage
  integration, employer claim responses, verified career profile, verified education &
  licenses, reemployment matching, a live interview space, continuous return-to-work detection,
  a generalized explainable eligibility rules engine, full appeal & hearing management, full
  benefit payments processing, fraud-evidence analysis.

Sub-project A intentionally pulls forward two pieces from that later-phase list in lightweight
form, because the review page's evidence is incomplete without them:

- A **payment ledger** (recording amounts, not real disbursement — no money moves, matching the
  Phase 1 spec's non-goals) rather than the full benefit-payments subsystem.
- **Structured rule metadata** in the decision engine (rule id, threshold, actual value) rather
  than the full generalized/configurable rules engine — the fixed rule set and order are
  unchanged; only their internal representation becomes explicit instead of baked into a
  sentence. Making the job-search minimum configurable per claimant is sub-project C, which
  builds on this same structured shape.

Employer-verified status (see Data model) is deliberately left `UNVERIFIED` for every record:
there is no Employer Portal yet for an employer to actually confirm anything. That dependency is
named explicitly rather than faked.

## Scope

**In scope:**

- A new claimant-facing wage-record confirmation step, replacing the existing freeform
  "Employment history" field on `/claim/new` (which is validated today but never actually
  persisted — a pre-existing gap this closes as a side effect)
- A mocked wage-record lookup provider, following the existing mocked identity-verification
  pattern (`MockIDProof`)
- A rebuilt Review Certification page showing: this week's certification answers, job-search
  contacts, the structured flagging rule, wage records with claimant confirmations/disputes,
  computed conflicting-data flags, certification history, case notes, a payment-consequence
  preview, and supporting documents
- A lightweight payment ledger (`Payment` model), written to on every review decision
- Basic file upload/attachment for supporting documents, stored on local disk
- Decision engine refactor: structured rule metadata instead of a plain reason string

**Out of scope (explicitly deferred):**

- Any real employer-facing surface (Employer Portal, employer verification, employer disputes)
- Any real wage/payroll data integration — the lookup is simulated
- Real payment disbursement/money movement
- Cloud file storage (local disk is sufficient for this stage; Render's free tier filesystem is
  ephemeral across redeploys, which is an acceptable limitation for a demo and is called out
  here so it isn't mistaken for durable storage later)
- Configurable job-search minimum / claimant exemptions (sub-project C)
- Claim-status timeline, monetary determination, benefit-year totals (sub-project B, which
  consumes the `Payment` ledger this spec introduces)

## Data model

New Prisma models and enum, additive to the existing schema:

```prisma
enum EmployerVerifiedStatus {
  UNVERIFIED   // always this value for now — no Employer Portal exists to change it
}

enum PaymentStatus {
  PAID
  WITHHELD
}

model WageRecord {
  id                     String                 @id @default(cuid())
  claimId                String
  claim                  Claim                  @relation(fields: [claimId], references: [id])
  employerName           String
  fein                   String
  workLocation           String
  jobTitle               String
  firstDayWorked         DateTime
  lastDayWorked          DateTime?
  wageRate               Decimal                @db.Decimal(10, 2)
  hoursPerWeek           Decimal                @db.Decimal(5, 2)
  separationReason       String
  recallDate             DateTime?
  employerVerifiedStatus EmployerVerifiedStatus @default(UNVERIFIED)
  source                 String                 // e.g. "Simulated state wage database lookup"
  claimantConfirmed      Boolean                @default(false)
  claimantDisputeNote    String?
  createdAt              DateTime               @default(now())
}

model Payment {
  id                    String              @id @default(cuid())
  claimId               String
  claim                 Claim               @relation(fields: [claimId], references: [id])
  weeklyCertificationId String
  weeklyCertification   WeeklyCertification @relation(fields: [weeklyCertificationId], references: [id])
  amount                Decimal             @db.Decimal(10, 2)
  status                PaymentStatus
  recordedAt            DateTime            @default(now())
}

model Document {
  id                    String               @id @default(cuid())
  claimId               String
  claim                 Claim                @relation(fields: [claimId], references: [id])
  weeklyCertificationId String?
  weeklyCertification   WeeklyCertification? @relation(fields: [weeklyCertificationId], references: [id])
  uploadedByUserId      String
  uploadedBy            User                 @relation(fields: [uploadedByUserId], references: [id])
  filename              String
  storedPath            String
  uploadedAt            DateTime             @default(now())
}
```

`Claim` and `WeeklyCertification` gain the obvious back-relations (`wageRecords`, `payments`,
`documents`).

### Decision engine

`DecisionResult` changes from:

```ts
{ decision: 'APPROVED' | 'FLAGGED' | 'DENIED'; reason: string }
```

to:

```ts
{
  decision: 'APPROVED' | 'FLAGGED' | 'DENIED';
  ruleId: string;            // e.g. 'JOB_SEARCH_MINIMUM'
  description: string;       // e.g. 'Job-search minimum'
  threshold?: string;        // e.g. '3 contacts'
  actualValue?: string;      // e.g. '1 contact'
}
```

`WeeklyCertification.autoDecisionReason` is replaced by `autoDecisionRuleId` plus the threshold/
actual-value pair needed to reconstruct the sentence for display; existing rule logic and order
are unchanged, only the return shape. Every existing call site that reads `.reason` is updated to
render it from the structured fields, so the caseworker-visible text is equivalent to today's,
just sourced from data instead of a hardcoded string.

## Flows

### Claimant: filing a claim (revised)

1. Reason for separation + benefit year start (unchanged)
2. Submit triggers the mocked wage-record lookup (`MockWageLookup`, same shape as
   `MockIDProof`) — returns 1+ simulated `WageRecord`s tied to this claimant
3. Claimant sees: *"We found these employers and wage records. Please confirm or correct
   them."* — each record shown with its fields, a **Confirm** action and a **This isn't right**
   action that opens an editable correction form + free-text dispute note
4. Claim is created once every record has been confirmed or corrected; `WageRecord`s persist
   with `claimantConfirmed` and any `claimantDisputeNote` set

### Caseworker: reviewing a flagged certification (revised)

The existing decision form is unchanged in behavior (same actions, same required reason, same
audit logging via `ClaimReviewAction`). Above it, the page now renders, read-only:

1. This week's certification answers (able/available, worked, earnings, refused work)
2. Job-search contacts logged this week
3. The structured flagging rule, rendered as e.g. *"Job-search minimum: required 3 contacts,
   claimant reported 1"*
4. Wage records for this claim (confirmed/corrected), each showing `employerVerifiedStatus:
   Unverified — no employer response system available yet` so the caseworker isn't misled into
   thinking it's been independently checked
5. Conflicting-data flags — computed at render time, not stored:
   - Claimant reported $0 earnings / did not work this week, but a wage record indicates the
     job was still active during that week — i.e. `lastDayWorked` is null, or falls on/after
     the certification's `weekEndingDate`, and (if a `recallDate` is set) the `weekEndingDate`
     is not before the `recallDate` → flagged
   - A wage record's `claimantDisputeNote` is present → surfaced as a flag, not just buried in
     the record
6. Certification history for this claim (past weeks, decision, outcome)
7. Case notes (existing `CaseNote` data, now also shown here for in-context review)
8. Payment-consequence preview: *"Approving records a $320 payment for this week. Denying
   withholds it."* — computed from the claim's `weeklyBenefitAmount`, not yet written; the
   actual `Payment` row is written when the caseworker submits their decision
9. Supporting documents — list of existing `Document`s for this claim/certification, plus an
   upload control

## File storage

Uploaded files are written to a local directory (path from an env var,
`DOCUMENT_STORAGE_PATH`, defaulting to `./uploads`, gitignored) with a generated filename;
`Document.storedPath` records the relative path, `Document.filename` the original name for
display. Downloads go through an authenticated route
(`GET /api/documents/[id]`) that re-checks RBAC/ownership before streaming the file — never a
static/public path. Upload size is capped (10MB) and content-type is restricted to a small
allowlist (PDF, PNG, JPEG) rejected server-side, not just via the file picker's `accept`
attribute.

Noted limitation carried into this spec deliberately: Render's free tier has an ephemeral
filesystem, so uploaded files will not survive a redeploy in the current hosting setup. Fine for
demo purposes; flagged here so it isn't silently assumed to be durable.

## Security & RBAC

- All new routes follow the existing pattern: `requireRole`/`requireOwnership` checks at the API
  layer, never trusting client-supplied identifiers
- `WageRecord` creation/correction is claimant-owned (their own claim only); reads are available
  to the claimant (their own) and caseworkers/admins (any, for review)
- `Document` upload/download re-checks ownership per request; no direct filesystem path is ever
  returned to the client
- Every `Payment` write, `Document` upload, and wage-record correction is audit-logged
  (`writeAuditLog`), consistent with existing SSN/claim-status logging

## Error handling

- The mocked wage lookup, correction form, and file upload all follow the existing Zod
  client+server validation pattern and the shared `apiError` response shape
- A wage lookup that (in the mock) returns zero records is a valid, handled state — the
  claimant proceeds with an empty confirmation list rather than hitting a dead end
- File upload failures (size/type rejected) surface as an inline field error, not a generic
  submission failure

## Testing

- **Unit**: decision engine's new structured return shape (existing rule-order test cases
  updated, not reduced); conflicting-data computation given constructed wage-record/certification
  inputs
- **Integration**: wage lookup + confirm/correct API routes (including RBAC/ownership
  enforcement matching existing patterns); Payment row written correctly per decision type;
  Document upload/download RBAC enforcement
- **E2E**: claim filing flow updated to cover the new confirm/correct step; review page scanned
  by the existing axe-core accessibility gate like every other route
- Accessibility: new page sections (evidence panels, conflict flags, file upload control) meet
  the same WCAG 2.2 AA bar as the rest of the app — status/warning patterns use icon + text +
  color, matching the existing Restricted-status convention already in place

## Success criteria

A caseworker opening the Review Certification page sees, without navigating anywhere else,
everything needed to make an informed decision: what the claimant reported, why the system
flagged it, their wage/employer data and any disputes, their certification history, case notes,
what the decision will cost/withhold, and any supporting documents — and a claimant filing a
claim confirms or corrects real (simulated) wage data instead of typing free text into a field
that silently went nowhere.
