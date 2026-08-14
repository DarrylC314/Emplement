# Employer Portal (Claims-Response) — Design

## Purpose

Gives employers a way to respond to the unemployment-claims system directly: confirm or
dispute the wage records already collected for their FEIN, and proactively report hire/
separation events that get matched to claimant records. This is the first of two employer-
facing sub-projects identified during an earlier backlog triage (the second, a hiring/job-
marketplace portal, is a separate product surface — the original prototype's "Phase 3:
employer marketplace" — deferred to its own future brainstorm).

This closes a real, already-visible gap: `WageRecord.employerVerifiedStatus` has existed
since the Review Certification evidence work shipped, but is permanently `UNVERIFIED` — the
caseworker review page literally renders the string *"Unverified — no employer response
system available yet."* This sub-project is that system.

## Background / relationship to existing work

Builds on the Review Certification evidence feature (merged `2026-08-14`): `WageRecord` rows
already exist, tied to an employer by `fein`, with a `claimantConfirmed`/`claimantDisputeNote`
pair the claimant already uses. This adds the employer's side of that same confirmation
model, plus a new employer-initiated event stream.

## Scope

**In scope:**

- A new `EMPLOYER` role and self-registration flow (mirrors claimant signup), gated behind a
  mocked FEIN-verification step (mirrors the existing mocked identity verification)
- Employer dashboard: every `WageRecord` on file for the employer's FEIN, with Confirm /
  Dispute actions — extends `employerVerifiedStatus` from a single always-`UNVERIFIED` value
  to a real `UNVERIFIED | VERIFIED | DISPUTED` state, plus an `employerDisputeNote` field
  mirroring the claimant side
- Employer-reported hire/separation events (`EmploymentEvent`), matched to an existing
  `ClaimantProfile` by a new deterministic SSN hash — surfaced on the caseworker's staff
  case-detail page for the matched claimant
- The caseworker Review Certification page swaps its hardcoded "Unverified — no employer
  response system available yet" string for the real value

**Out of scope (explicitly deferred):**

- The hiring/job-marketplace portal (candidate profiles, job postings, hiring) — a separate
  future sub-project
- Real FEIN verification against an actual business registry — mocked, same posture as
  identity verification and wage lookups elsewhere in this app
- Multi-user employer accounts (one login per company for this phase, matching the
  claimant/caseworker precedent of one `User` : one profile)
- Any UI for *unmatched* hire/separation events (no claimant match found) — stored, not
  surfaced; a future phase's concern if it turns out to matter
- Employer-initiated messaging/notifications to claimants or caseworkers (case notes and
  messages already exist caseworker-side; wiring an employer into that is future scope)

## Data model

New Prisma additions:

```prisma
enum EmploymentEventType {
  HIRE
  SEPARATION
}

model EmployerProfile {
  id                 String             @id @default(cuid())
  userId             String             @unique
  user               User               @relation(fields: [userId], references: [id])
  fein               String             @unique
  companyName        String
  verificationStatus VerificationStatus @default(PENDING)
  createdAt          DateTime           @default(now())

  employmentEvents EmploymentEvent[]
}

model EmploymentEvent {
  id                     String              @id @default(cuid())
  employerId             String
  employer               EmployerProfile     @relation(fields: [employerId], references: [id])
  type                   EmploymentEventType
  employeeName           String
  ssnHash                String
  eventDate              DateTime
  matchedClaimantProfileId String?
  matchedClaimantProfile  ClaimantProfile?   @relation(fields: [matchedClaimantProfileId], references: [id])
  createdAt              DateTime            @default(now())
}
```

`VerificationStatus` (`PENDING | VERIFIED | FAILED`) already exists — reused as-is, same
enum `ClaimantProfile.identityVerificationStatus` uses.

Changed:

```prisma
enum EmployerVerifiedStatus {
  UNVERIFIED
  VERIFIED
  DISPUTED
}
```

(Currently just `UNVERIFIED`.) `WageRecord` gains `employerDisputeNote String?`, mirroring
the existing `claimantDisputeNote`.

`ClaimantProfile` gains `ssnHash String? @unique` and `matchedEmploymentEvents EmploymentEvent[]`
(the required back-relation for `EmploymentEvent.matchedClaimantProfile` above — Prisma
requires both sides of a relation to be declared). `ssnHash` is a deterministic HMAC-SHA256 of the
plaintext SSN (a static server-side secret as the HMAC key, distinct from `SSN_ENCRYPTION_KEY`
since encryption and matching are different security properties and shouldn't share a key).
Computed once at identity verification, alongside the existing `encryptSSN` call. Existing
claimant rows need a one-time backfill migration: decrypt each `ssnEncrypted` once, compute
its hash, write it back — a bounded, one-shot script, not a runtime cost.

**Why a hash and not the existing encryption:** `encryptSSN` uses a random IV per call
(confirmed by reading `src/lib/encryption.ts`), so the same SSN produces different ciphertext
every time — it cannot be used for equality lookups. A deterministic keyed hash is the
standard pattern for "encrypted at rest but matchable" data; it's one-way (unlike encryption,
never reversed) and reveals nothing beyond "does this SSN match this other SSN," which is
exactly the operation this feature needs.

## Flows

### Employer: registration & verification

1. Sign up (email/password) — new `POST /api/employer/signup`, deliberately separate from
   the existing `/api/signup` (which is hardcoded to `role: 'CLAIMANT'` specifically to
   prevent self-provisioning any other role — extending it would weaken that guarantee)
2. `/employer/verify-fein` — enter FEIN + company name; `POST /api/employer/verify-fein`
   calls a new `MockFEINVerify` provider (same shape as `MockIDProof`: deterministic,
   always succeeds for a well-formed FEIN matching `\d{2}-\d{7}$`) and creates the
   `EmployerProfile` with `verificationStatus: VERIFIED`
3. `/employer/dashboard` — accessible only once verified

### Employer: confirm/dispute wage records

1. Dashboard lists every `WageRecord` where `fein` matches the employer's own FEIN (the
   RBAC ownership check for this role, keyed on FEIN rather than a profile id)
2. Confirm → `employerVerifiedStatus: VERIFIED`. Dispute (with a required note) →
   `employerVerifiedStatus: DISPUTED`, `employerDisputeNote` set — same two-action UI pattern
   as the claimant wage-confirmation page, via a new `PATCH /api/employer/wage-records/[id]`
   (a separate route from the claimant's existing `PATCH /api/wage-records/[id]`, since the
   two roles' ownership models and allowed transitions are different enough that entangling
   them in one handler would hurt clarity more than it saves)

### Employer: report a hire/separation event

1. Dashboard form: employee name, SSN, event type, event date → `POST /api/employer/events`
2. Server hashes the submitted SSN with the same deterministic method, looks up a
   `ClaimantProfile` by `ssnHash`. Match found → `matchedClaimantProfileId` set, event becomes
   visible on that claimant's staff case-detail page (`/staff/claimants/[id]`) under a new
   "Employer-reported events" section. No match → event is stored with `matchedClaimantProfileId: null`
   and is not surfaced anywhere in this phase (per Scope)

### Caseworker: consuming employer input (no new pages — existing pages gain data)

- Review Certification page: `employerVerifiedStatus` and `employerDisputeNote` render for
  real instead of the hardcoded placeholder string
- Staff case-detail page: matched `EmploymentEvent`s for this claimant appear in a new
  section, read-only

## Security & RBAC

- New `EMPLOYER` value added to the `Role` enum
- `requireRole(session, ['EMPLOYER'])` on every employer route; ownership check compares the
  request's target `WageRecord.fein` against `session.user.employerProfileId`'s FEIN (looked
  up server-side, never trusted from the client) — the same "derive from session, verify
  server-side" discipline used throughout this codebase
- SSN submitted during event reporting is hashed immediately server-side and never persisted
  in plaintext or logged; only `ssnHash` is stored on `EmploymentEvent`
- Every employer confirm/dispute/event-report action writes an `AuditLog` row, consistent
  with every other status-affecting write in this app

## Error handling

- Mocked FEIN verification failure path: a malformed FEIN (doesn't match the expected
  format) fails validation before ever reaching the mock provider — consistent with existing
  Zod-first validation
- An `EmploymentEvent` with no claimant match is a normal, silently-accepted outcome (not an
  error) — the employer isn't told whether a match was found, since that would leak whether a
  given SSN belongs to any claimant in the system

## Testing

- Unit: `ssnHash` determinism (same SSN → same hash, always); `MockFEINVerify`
- Integration: employer signup/FEIN-verification RBAC and ownership on both new wage-record
  and event routes; the backfill migration script against a seeded set of claimant rows
- E2E: employer signup → verify → dashboard → confirm a wage record; a caseworker then seeing
  the updated `employerVerifiedStatus` on the review page
- Accessibility: new employer pages scanned by the existing axe-core E2E gate, same as every
  other route

## Success criteria

An employer can register, get verified, see the wage records on file for their company,
confirm or dispute them, and report a hire/separation event that — when it matches an
existing claimant — becomes visible to the caseworker reviewing that claimant's case. The
Review Certification page's employer-verification placeholder is replaced with real data.
