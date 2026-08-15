# Employer Marketplace — First Slice (Claimant Job-Placement) Design

## Purpose

Builds the first vertical slice of "Phase 3: employer marketplace" — one of two later
phases the original product vision deferred when Phase 1 (unemployment-claims core) was
scoped. This slice is a job-placement marketplace limited to existing claimants and
verified employers, ending in an employer-initiated hire that automatically creates an
`EmploymentEvent` and restricts the claimant's claim — closing the loop between "found
work" and "benefits change" without waiting on a caseworker to notice.

## Background / relationship to existing work

The original product vision (`docs/superpowers/specs/2026-08-11-emplement-claims-core-design.md`)
named a job-placement marketplace as "Phase 3," deferred alongside "Phase 4: post-hire
workplace monitoring," neither built. This spec covers the first sub-project of Phase 3
only — full Phase 3 scope (see Roadmap below) needs several more spec/plan/build cycles.

This slice deliberately does **not** reuse the existing `POST /api/employer/events`
route (the manual SSN-entry hire-reporting flow built for the Employer Portal
claims-response phase). That route exists for employers who report a hire/separation
without already knowing whether the person is a claimant — it has to hash a submitted
SSN and search for a match. Here, the system already knows exactly which claimant is
involved (the employer is hiring a specific `JobApplication`'s candidate), so there's
nothing to search for — the hire path is more direct, described below.

## Scope

**In scope:**

- `CandidateProfile`: a claimant opts in by creating one (headline, skills, bio,
  availability), gated on having already completed identity verification
- `JobPosting`: a verified employer creates postings (title, description, location)
- Two-directional connection: a claimant browses postings and applies; an employer
  browses candidate profiles and reaches out — both produce the same `JobApplication`
  record, differing only in `initiatedBy`
- Employer reviews a posting's applications and can Hire or Reject each
- Hiring one application automatically: rejects the posting's other pending
  applications, marks the posting `FILLED`, creates a matched `EmploymentEvent` with no
  SSN re-entry, moves every currently-`ACTIVE` claim for that claimant to `RESTRICTED`,
  and sends the claimant an automatic message explaining why — all in one transaction

**Out of scope for this slice (deferred to later Phase 3 sub-projects — see Roadmap):**

- Automated candidate/posting ranking or matching algorithms
- Live interview scheduling
- Editing or withdrawing a posting once published (create-only for v1)
- Any job-seeking surface for non-claimants (the marketplace is claimant-only, per an
  explicit product decision — a general-purpose job board is a different, larger
  product and was not chosen)
- Any change to the existing manual SSN-based hire-reporting flow

## Data model

```prisma
model CandidateProfile {
  id                String          @id @default(cuid())
  claimantProfileId String          @unique
  claimantProfile   ClaimantProfile @relation(fields: [claimantProfileId], references: [id])
  headline          String
  skills            String
  bio               String?
  availability      String
  createdAt         DateTime        @default(now())

  applications JobApplication[]
}

enum JobPostingStatus {
  OPEN
  FILLED
}

model JobPosting {
  id          String            @id @default(cuid())
  employerId  String
  employer    EmployerProfile   @relation(fields: [employerId], references: [id])
  title       String
  description String
  location    String
  status      JobPostingStatus  @default(OPEN)
  createdAt   DateTime          @default(now())

  applications JobApplication[]
}

enum ApplicationInitiator {
  CANDIDATE
  EMPLOYER
}

enum ApplicationStatus {
  PENDING
  HIRED
  REJECTED
}

model JobApplication {
  id                 String                @id @default(cuid())
  jobPostingId       String
  jobPosting         JobPosting            @relation(fields: [jobPostingId], references: [id])
  candidateProfileId String
  candidateProfile   CandidateProfile      @relation(fields: [candidateProfileId], references: [id])
  initiatedBy        ApplicationInitiator
  status             ApplicationStatus     @default(PENDING)
  createdAt          DateTime              @default(now())
}
```

`EmployerProfile` gains a `jobPostings: JobPosting[]` back-relation; `ClaimantProfile`
gains a `candidateProfile: CandidateProfile?` back-relation. No changes to
`EmploymentEvent`, `Claim`, or `Message` schemas — the hire flow writes to all three
using fields that already exist.

**Why `CandidateProfile` creation requires identity verification:** this isn't only a
safety gate. `ClaimantProfile.ssnHash` is only populated once identity verification
completes, and the hire flow (below) needs a non-null `ssnHash` to create a valid
`EmploymentEvent` without asking the employer to re-enter an SSN. Requiring
verification first guarantees that precondition holds by construction, rather than
needing a runtime null-check with an awkward failure mode at hire time.

## Flows

### Claimant: candidate profile and applying

1. A verified claimant creates a `CandidateProfile` (one per claimant, enforced by the
   `@unique` constraint on `claimantProfileId`).
2. The claimant browses `JobPosting`s with `status: OPEN` and applies to one, creating a
   `JobApplication` with `initiatedBy: CANDIDATE`. For this slice, browsing is a plain
   list, most-recent-first — no search or filtering, matching the YAGNI posture of
   this app's other simple list views (e.g. the unmatched-events queue).

### Employer: postings and outreach

1. A verified employer (same FEIN-verification gate as every other employer route)
   creates a `JobPosting`.
2. The employer can also browse candidate profiles — an explicit, PII-minimal `select`
   returning only `headline`/`skills`/`bio`/`availability` (never SSN, DOB, mailing
   address, or anything else on the underlying `ClaimantProfile`) — and reach out to one
   directly, creating a `JobApplication` with `initiatedBy: EMPLOYER` against one of
   their own open postings. Same as the candidate-facing browse above, this is a plain
   list for this slice — no search/filtering.
3. The employer reviews a posting's `JobApplication`s and can Reject an individual one,
   or Hire one.

### The hire transaction

Hiring a `JobApplication` runs as a single `prisma.$transaction` — this app's
established pattern for genuine multi-row atomicity (mirroring `src/lib/signup.ts`'s
use of the same pattern for User+Profile creation). This qualifies for it: it's a
coordinated business event touching four tables, not a simple check-then-write, and a
partial failure here (e.g. the claim update failing after the `EmploymentEvent`
already committed) would be a real, consequential data-integrity problem, not a
narrow, self-correcting race.

Inside the transaction:
1. The target `JobApplication.status → HIRED`.
2. Every other `PENDING` `JobApplication` on the same `JobPosting` → `REJECTED`.
3. `JobPosting.status → FILLED`.
4. A new `EmploymentEvent` is created with `type: HIRE`, `employeeName` from the
   claimant's `legalName`, `ssnHash` copied directly from the claimant's own
   `ClaimantProfile.ssnHash` (no new hashing, no SSN re-entry — the system already
   knows who this is), and `matchedClaimantProfileId` set immediately.
5. Every `Claim` currently `ACTIVE` for that claimant → `RESTRICTED`. (If none are
   `ACTIVE` — e.g. the claimant's only claim was already `CLOSED` or `DENIED` — this is
   a no-op; nothing else in the transaction depends on a claim actually changing.)
6. A `Message` is created (existing model, `caseworkerId: null` for a system-generated
   message) to the claimant, explaining that their claim status changed because they
   were hired through the marketplace.
7. An `AuditLog` row records the whole action, attributed to the acting employer's
   session — automatic and audit-logged are not in tension; every other
   status-affecting write in this app is audited the same way, this one just skips the
   human-review step that normally precedes the write.

## Security & RBAC

- `CandidateProfile` routes: `requireRole(['CLAIMANT'])` + `requireOwnership` — a
  claimant only ever sees or edits their own.
- `JobPosting` creation/browse: `requireRole(['EMPLOYER'])`, gated on
  `verificationStatus === 'VERIFIED'`, mirroring every existing employer route.
- Employer's candidate-browse route explicitly selects only marketplace-relevant
  fields — never PII the marketplace doesn't need.
- The hire action is restricted to the `JobPosting`'s own employer (ownership check
  comparing the posting's `employerId` to the acting session's `employerProfileId`,
  the same FEIN-ownership-style pattern already established for employer wage-record
  routes).
- Actor identity for every write, including the automatic hire cascade, is always
  derived from the acting employer's session — never client input.

## Error handling

- Hiring an application that's already `HIRED` or `REJECTED`, or whose posting is
  already `FILLED` — 409, consistent with the "already resolved" pattern used
  elsewhere in this app (e.g. the unmatched-events queue's retry/match/dismiss
  routes).
- Creating a second `CandidateProfile` for an already-profiled claimant — 409 (the
  `@unique` constraint backs this).
- Applying to a `JobPosting` that isn't `OPEN` — 400.

## Testing

- Integration: candidate profile creation (including the identity-verification gate
  rejecting an unverified claimant); job posting creation (including the FEIN
  verification gate); both application-initiation directions; the full hire
  transaction (asserting all four side effects — application/posting status,
  `EmploymentEvent` with correct `ssnHash`/`matchedClaimantProfileId`, claim status,
  message, audit log — happen together); the "other pending applications rejected"
  side effect specifically; RBAC/ownership rejections; the 409/400 error cases above.
- E2E: full flow — claimant creates a profile → employer posts a job → claimant
  applies → employer hires → claimant's dashboard reflects the `RESTRICTED` status and
  the new message → claimant's case-detail page (staff view) shows the new
  `EmploymentEvent`.
- Accessibility: new pages scanned by the existing axe-core E2E gate.

## Success criteria

A claimant can build a candidate profile and apply to open postings; a verified
employer can post jobs and independently reach out to candidates; either path produces
the same reviewable application. An employer hiring an applicant needs no SSN re-entry
and no caseworker involvement — the claimant's claim is automatically restricted, a
message explains why, and the hire is visible on the claimant's case file exactly like
any other reported employment event.

## Roadmap (Phase 3, full scope — not built in this slice)

This slice is the first of several Phase 3 sub-projects. In rough dependency order:

1. **This slice** — candidate profiles, job postings, two-directional applications,
   employer-initiated hire with automatic claim restriction.
2. **Automated candidate/posting ranking** — surfacing likely-fit candidates to
   employers and likely-fit postings to candidates, instead of requiring manual browse
   for both directions.
3. **Live interview scheduling** — once an application is under active consideration,
   letting employer and candidate coordinate an interview inside the product rather
   than off-platform.
4. Anything beyond those three remains unscoped until each is brainstormed in turn,
   the same way this slice was.

Phase 4 (post-hire workplace monitoring) is a separate phase entirely, not part of
this roadmap.
