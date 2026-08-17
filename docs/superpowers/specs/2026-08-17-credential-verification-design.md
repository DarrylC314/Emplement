# Credential Verification Design

## Purpose

Every organization already in this system as an "employer" is, in the real
world, also capable of confirming other facts about a person: a university
can confirm enrollment and a degree, a military branch can confirm service,
a police department can confirm law-enforcement service, a licensing body
can confirm a professional certification. This spec adds a general
credential-verification workflow — a claimant or caseworker requests that a
named organization confirm a specific credential, the claimant authorizes
the disclosure, and the organization responds — reusing `EmployerProfile`
as the "verifying organization" rather than inventing a parallel concept
for universities, licensing bodies, and government agencies.

This is the foundation piece of a three-part sequence: this spec (the
request/authorize/respond workflow plus display on the caseworker's case
page), followed later by marketplace trust badges on `CandidateProfile`,
followed by a more active caseworker-driven eligibility workflow built on
top of this foundation.

## Background

`EmployerProfile` already represents any organization with a verified FEIN
and company name — nothing about it is employment-specific except how it's
currently used (`EmploymentEvent`, `JobPosting`). The existing
employer-reported-events route (`src/app/api/employer/events/route.ts`)
already shows the proactive-reporting shape: a verified employer submits a
fact about a person, matched by SSN hash. This spec's primary mechanism is
different — consent-based request/response, not proactive reporting — but
reuses the same matching, audit-logging, and role-gating conventions
throughout.

The existing "unmatched events" flow
(`src/app/staff/unmatched-events/page.tsx` and its API routes) is the
precedent for how a proactively-reported record that can't be auto-matched
by SSN hash gets resolved by a caseworker — this spec's own proactive path
(see below) reuses that same shape rather than inventing a new one.

`EmploymentEvent` is not touched by this spec. It already has real,
reviewed business logic (claim restriction, expiration, unmatched-event
matching) built on it, and Employment stays exactly as it is today — this
spec adds a new, separate model for the other credential types.

## Scope

**In scope:**

- Two new models: `CredentialRecord` (a confirmed fact) and
  `CredentialVerificationRequest` (the workflow that produces one).
- Five credential types: Education, Military Service, Law Enforcement,
  Certification, and Other.
- The primary mechanism: a claimant or caseworker requests verification
  from a named organization; if a caseworker initiated it, the claimant
  must explicitly authorize it before it reaches the organization; the
  organization then confirms (with details) or reports no record found.
- A secondary mechanism: an organization with an explicit, admin-granted
  reporting agreement can proactively submit a `CredentialRecord` directly
  (mirroring the existing employer-events pattern), without a preceding
  request — matched by SSN hash, with the existing unmatched-event review
  pattern extended to cover unmatched credentials too.
- A new organization-picker endpoint (`GET /api/organizations?q=`) — no
  such search/browse endpoint exists today; every current use of
  `EmployerProfile` looks up the caller's own profile, never searches by
  name.
- Display: a "Verified credentials" section on the caseworker's existing
  claimant case page; a claimant-facing page listing their own requests
  (act on ones awaiting their authorization, see the status of others);
  an organization-facing page listing requests directed at them, with a
  respond form.

**Out of scope:**

- Marketplace trust badges on `CandidateProfile` — the second piece of the
  three-part sequence, not this one.
- A more active caseworker-driven eligibility workflow (e.g. requesting
  verification as a formal step in a benefits determination, with its own
  review/decision record) — the third piece of the sequence.
- Any dispute or appeal process for a `CONFIRMED` credential record.
- Expiration/renewal reminders for certifications — `details.expirationDate`
  is stored, but nothing automated acts on it in this pass.
- File/document upload as supporting evidence (e.g. a scanned diploma) —
  text/structured-data only.
- Self-service UI for granting an organization's proactive-reporting
  agreement — that flag is admin-set only (seed data / direct database
  access in this pass), the same kind of manual, outside-the-app
  operational step the Render Cron Job's own provisioning already is.
- Email or other out-of-band notifications — matches this app's existing
  convention of no notification system; participants see pending items
  only when they visit the relevant page.

## Data model

```prisma
enum CredentialType {
  EDUCATION
  MILITARY_SERVICE
  LAW_ENFORCEMENT
  CERTIFICATION
  OTHER
}

enum CredentialRequestStatus {
  PENDING_AUTHORIZATION
  AUTHORIZED
  CONFIRMED
  NO_RECORD_FOUND
  DECLINED
}

enum CredentialReportingMethod {
  REQUEST_RESPONSE
  PROACTIVE_AGREEMENT
}

model CredentialVerificationRequest {
  id                 String                   @id @default(cuid())
  claimantProfileId  String
  claimantProfile    ClaimantProfile          @relation(fields: [claimantProfileId], references: [id])
  organizationId     String
  organization       EmployerProfile          @relation(fields: [organizationId], references: [id])
  credentialType     CredentialType
  requestedTitle     String?
  requestedByUserId  String
  requestedByUser    User                     @relation("CredentialVerificationRequestedBy", fields: [requestedByUserId], references: [id])
  status             CredentialRequestStatus  @default(PENDING_AUTHORIZATION)
  authorizedAt       DateTime?
  declinedAt         DateTime?
  respondedAt        DateTime?
  respondedByUserId  String?
  respondedByUser    User?                    @relation("CredentialVerificationRespondedBy", fields: [respondedByUserId], references: [id])
  responseNote       String?
  resultingCredentialRecordId String?         @unique
  resultingCredentialRecord   CredentialRecord? @relation(fields: [resultingCredentialRecordId], references: [id])
  createdAt          DateTime                 @default(now())
}

model CredentialRecord {
  id                       String                     @id @default(cuid())
  organizationId           String
  organization             EmployerProfile            @relation(fields: [organizationId], references: [id])
  type                     CredentialType
  title                    String
  eventDate                DateTime
  detailsSchemaVersion     Int                        @default(1)
  details                  Json
  ssnHash                  String
  matchedClaimantProfileId String?
  matchedClaimantProfile   ClaimantProfile?           @relation(fields: [matchedClaimantProfileId], references: [id])
  reportedVia              CredentialReportingMethod
  createdAt                DateTime                   @default(now())
  dismissedAt              DateTime?
  dismissedByUserId        String?
  // Matches EmploymentEvent's own field name for the identical concept.
  dismissedBy              User?                      @relation(fields: [dismissedByUserId], references: [id])
  // Back-reference required by Prisma for the other side of
  // CredentialVerificationRequest.resultingCredentialRecord's 1:1 relation.
  sourceRequest            CredentialVerificationRequest?
}
```

- `CredentialVerificationRequest.status` starts at `AUTHORIZED` (not
  `PENDING_AUTHORIZATION`) when the claimant is the one who created it —
  requesting verification of your own credential is itself the
  authorization. It only starts at `PENDING_AUTHORIZATION` when a
  caseworker initiates it, requiring the claimant's explicit approval
  before it's visible to the organization at all.
- `title` on `CredentialRecord` is the one common, always-present
  human-readable label every credential type needs ("Bachelor of Science
  in Computer Science", "U.S. Army — Sergeant", "Certified Public
  Accountant"), kept as a real column rather than JSON so every credential
  can be listed/searched without inspecting `details`.
- `details` holds the fields specific to each `type` (major/degree for
  Education, branch/rank/discharge type for Military Service, agency/role
  for Law Enforcement, certifying detail/expiration for Certification, a
  free-text description for Other), validated against a per-type Zod
  schema before every write. `detailsSchemaVersion` is stamped on every
  record so the shape can change later without breaking old rows — a
  reader always knows which shape it's looking at.
- `CredentialRecord.matchedClaimantProfileId` is nullable and
  `dismissedAt`/`dismissedByUserId` exist only for the proactive path:
  a request-response-originated record is always matched at creation
  time (the claimant is already known from the request), but a
  proactively-reported one is matched by `ssnHash` the same way
  `EmploymentEvent` is, and can land unmatched.
- `reportedVia` distinguishes the two paths on every record, independent
  of whether a `CredentialVerificationRequest` produced it.

Both `EmployerProfile` and `ClaimantProfile` gain two new unnamed
back-relations each (`credentialRecords`, `credentialVerificationRequests`)
— unnamed is correct here since each is the only relation between that
specific model pair. `User` gains two *named* relations
(`"CredentialVerificationRequestedBy"`, `"CredentialVerificationRespondedBy"`)
since `CredentialVerificationRequest` has two separate foreign keys to
`User`.

`EmployerProfile` also gains one new field for the proactive path:

```prisma
model EmployerProfile {
  // ...existing fields...
  credentialReportingAgreement Boolean @default(false)
}
```

## The request/authorize/respond workflow

1. **Creating a request** (`POST /api/verification-requests`) — either role
   can create one. A `CLAIMANT` session always creates a request for their
   own `claimantProfileId` (ignoring any client-supplied value) and it
   starts `AUTHORIZED`. A `CASEWORKER`/`ADMIN` session supplies the target
   `claimantProfileId` explicitly and it starts `PENDING_AUTHORIZATION`.
   Both supply `organizationId` (from the new picker endpoint),
   `credentialType`, and an optional `requestedTitle` free-text hint for
   the organization (e.g. "Bachelor's degree, Computer Science, graduated
   around 2018") — helpful context, not a structured field, since the
   requester may not know the organization's exact records. The target
   `organizationId` must resolve to a `VERIFIED` `EmployerProfile`.
2. **Claimant authorization** (`POST /api/verification-requests/[id]/authorize`
   or `.../decline`) — `CLAIMANT` only, gated by `requireOwnership` against
   `claimantProfileId`, only valid while `status = PENDING_AUTHORIZATION`.
   Authorizing sets `status = AUTHORIZED`, `authorizedAt = now()`.
   Declining sets `status = DECLINED`, `declinedAt = now()` — terminal, the
   organization never sees a declined request.
3. **Organization response** (`POST /api/employer/verification-requests/[id]/respond`)
   — `EMPLOYER` only, gated by `organizationId` matching the caller's own
   `employerProfileId`, only valid while `status = AUTHORIZED`. A
   confirming response supplies `title`, `eventDate`, and `details`
   (validated against the request's `credentialType`); this creates the
   `CredentialRecord` (matched directly to `claimantProfileId`,
   `reportedVia = REQUEST_RESPONSE`), links it via
   `resultingCredentialRecordId`, and sets `status = CONFIRMED`. A
   negative response supplies only an optional `responseNote` and sets
   `status = NO_RECORD_FOUND` — no `CredentialRecord` is created.

Every transition writes an `AuditLog` entry
(`CREDENTIAL_VERIFICATION_REQUESTED`, `_AUTHORIZED`, `_DECLINED`,
`_CONFIRMED`, `_NO_RECORD_FOUND`), `targetEntity:
'CredentialVerificationRequest'`, matching this codebase's audit
convention exactly.

## The proactive path

`POST /api/employer/credentials` mirrors
`src/app/api/employer/events/route.ts` almost exactly: `EMPLOYER` role,
fresh `verificationStatus === 'VERIFIED'` check from the database, plus a
new check that `credentialReportingAgreement === true` (403 if not — an
otherwise-verified employer still can't use this path without the
agreement flag). Body: SSN, `type`, `title`, `eventDate`, `details`.
Matched by `hashSSN(ssn)` against `ClaimantProfile.ssnHash`, same
never-reveal-whether-it-matched handling as the existing route. Unmatched
records land exactly like unmatched `EmploymentEvent`s do today, and the
existing `/staff/unmatched-events` review pattern is extended to also list
and resolve unmatched `CredentialRecord`s (match/dismiss/retry, same
compare-and-swap-on-update guard against concurrent resolution).

## Display

- **Claimant** (`/claim/verification-requests`, new page): a form to
  request verification of their own credential (search organizations by
  name via `GET /api/organizations?q=`, pick a `credentialType`, optional
  context text), and a list of all their requests with status — including
  any `PENDING_AUTHORIZATION` ones a caseworker created, with
  Authorize/Decline actions inline.
- **Organization** (new section on the existing employer dashboard, or a
  new `/employer/verification-requests` page — exact placement decided at
  plan time): a list of requests directed at them with `status =
  AUTHORIZED`, each with a respond form (confirm with details, or no
  record found).
- **Caseworker** (`/staff/claimants/[id]`, existing case page): a new
  "Verified credentials" section, a sibling to the existing "Case
  timeline" section (not merged into it — credentials aren't claim-lifecycle
  events), listing the claimant's `CredentialRecord`s and their
  `CredentialVerificationRequest` statuses, plus a control to initiate a
  new request for this claimant (using the same organization picker).

## Error handling

- Requesting verification from an organization that isn't `VERIFIED`
  returns a clear `400`/`404` rather than silently creating a request no
  organization will ever see.
- Authorizing/declining/responding to a request that's already left the
  state the action requires (e.g. authorizing an already-`AUTHORIZED` or
  `DECLINED` request) returns `409`, matching the compare-and-swap pattern
  the unmatched-events routes already use for the identical class of race.
- The proactive-reporting route's `credentialReportingAgreement` check
  returns the same `403` shape as the existing `verificationStatus` check,
  not a different error format.

## Testing

- Unit: a Zod schema per `credentialType`, verifying each accepts its own
  valid shape and rejects the others' fields where they'd be nonsensical
  (e.g. Education's `details` rejecting a `branch` field).
- Integration: one test file per route, following this codebase's
  `<feature>-<action>.test.ts` convention — request creation (both
  claimant-initiated and caseworker-initiated starting states), authorize/
  decline (ownership + status-guard), organization response (both
  confirm and no-record-found paths, ownership check), the proactive
  route (verified + agreement-gated, SSN matching, unmatched landing),
  and the organization-picker search endpoint.
- Component: the claimant request page and the organization respond page,
  following the existing `useSession`-mock + `vi.stubGlobal('fetch', ...)`
  conventions.
- E2E: a full walkthrough — claimant requests verification of their own
  education credential from a seeded university-as-employer, the
  organization responds confirming it, and the resulting `CredentialRecord`
  appears on the caseworker's case page. A second walkthrough for the
  caseworker-initiated path: caseworker requests one, claimant authorizes
  it from their own page, organization responds "no record found," and the
  request's final status is visible to the caseworker.

## Success criteria

A caseworker or claimant can ask a named organization already in this
system — whether it's an employer, a university, or any other
FEIN-verified entity — to confirm a credential; the claimant's consent is
always required and always visible before an organization ever sees the
request; and the confirmed result shows up as a durable, typed record on
the claimant's case page, without touching any of the existing employment
or claim-status logic this system already depends on.
