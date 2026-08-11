# Emplement Claims Core — Phase 1 Design

## Purpose

A modernized, accessible rebuild of the unemployment-claims portion of Emplement (originally
designed 2018/2019), intended as a proof-of-concept replacement for Missouri's UInteract
unemployment insurance system. This is **Phase 1** of a larger, phased rebuild of the full
original Emplement platform.

## Background

The original Emplement prototype (built in UXPin, reviewed in full — all 67 pages) bundled
three largely independent subsystems into one sitemap:

1. A job-placement marketplace (candidate profiles, employer accounts, job postings,
   applicant ranking, interview scheduling, hiring)
2. Post-hire workplace monitoring features (vehicle/desk check-ins, conference calls,
   employment expiration)
3. Unemployment insurance claims (weekly benefit certification, claim submission, approval)

Only subsystem 3 maps directly to the stated goal of replacing UInteract. This spec covers
that subsystem as a standalone, well-scoped Phase 1. Subsystems 1 and 2 are deferred to
later phases (Phase 3: employer marketplace, Phase 4: post-hire workplace features), each to
get its own spec/plan/build cycle. Phase 2 (job-search compliance tracking) is a near-term
extension of this phase, not a separate rebuild.

The original prototype also had specific, documented UX/trust problems that this rebuild
deliberately corrects: SSN collected as the very first field on the sign-up form (ahead of
name/email), no visible security/trust signaling on the payment/identity forms, disabled-
looking input styling, a decorative background photo rendered behind functional UI reducing
legibility, inconsistent unexplained color-coding, and competing/redundant calls to action
(Save vs. Submit vs. "Click here to Continue").

## Non-goals / explicit boundary

- This is **not** FedRAMP/StateRAMP authorized, has **not** been penetration tested, and is
  **not** a substitute for a real state InfoSec review, legal/compliance sign-off, or data
  processing agreements. It is built with realistic, reasonable security engineering
  practices for a pilot/demo — not certified for production handling of real citizens' SSNs
  and benefit data at scale.
- No real identity-proofing integration (no live ID.me/Login.gov connection) — the identity
  verification step is realistically modeled but mocked.
- No real payment/benefit disbursement — claim approval determines eligibility status only;
  no money moves.
- No partial-benefit calculation logic (claimant reporting earned income routes to
  caseworker review rather than an automated partial-benefit formula) — flagged as a Phase 2
  candidate.
- No employer marketplace, no workplace monitoring features (Phases 3/4).

## Format & delivery

Full-stack web application:

- **Next.js 14+ (App Router)**, TypeScript throughout, single codebase for frontend + API
  routes
- **PostgreSQL** via Prisma ORM (typed schema, migrations)
- **NextAuth.js** for session-based auth (credentials provider); the mocked identity-proofing
  step is a distinct flow from login/signup
- **Tailwind CSS** on top of a small custom design-token layer, so contrast ratios, spacing,
  and focus states are centrally controlled rather than ad hoc per component
- Local dev via `docker-compose` for Postgres — `docker compose up` + `npm run dev`, no cloud
  dependency required to run it locally

## Project structure

```
emplement-demo/                                    ← main repo
  .claude/worktrees/emplement-claims-core/          ← this phase's isolated worktree
    docs/superpowers/specs/2026-08-11-emplement-claims-core-design.md
    docs/superpowers/plans/2026-08-11-emplement-claims-core.md
    (app source)
```

Two route groups sharing one database and most base components:

- `/claim` — claimant-facing, linear form-wizard UI
- `/staff` — caseworker-facing, nav/table-dense UI

Chosen over a separate backend/frontend split to avoid duplicated auth/validation logic at
this scope; can be split out later if the employer marketplace (Phase 3) needs to scale
independently.

## Data model

Prisma schema, PostgreSQL:

- **User** — id, email, passwordHash, role (`CLAIMANT` | `CASEWORKER` | `ADMIN`), createdAt
- **ClaimantProfile** — userId, legalName, DOB, SSN (encrypted at rest, application-level
  AES-256; masked to last-4 in all UI by default), phone, mailing address,
  identityVerificationStatus
- **IdentityVerificationAttempt** — claimantId, mockProvider, status
  (pending/verified/failed), submittedAt, verifiedAt, mockReferenceId
- **Claim** — claimantId, status (`Active`/`Restricted`/`Denied`/`Closed`),
  benefitYearStart/End, weeklyBenefitAmount, openedDate
- **WeeklyCertification** — claimId, weekEndingDate, submittedAt, ableAndAvailable,
  workedThisWeek, earnings, refusedWork, autoDecision (`Approved`/`Flagged`/`Denied`),
  autoDecisionReason
- **JobSearchActivity** — weeklyCertificationId, employerName, contactMethod, contactDate,
  position (a claimant week can have several)
- **CaseNote** — claimId, caseworkerId, note, createdAt
- **ClaimReviewAction** — weeklyCertificationId, caseworkerId, action
  (`Approved`/`Denied`/`FlaggedForFraud`/`AmountAdjusted`), reason, previousValue/newValue,
  timestamp
- **Message** — claimantId, caseworkerId (nullable = system-generated), subject, body,
  sentAt, readAt
- **AuditLog** — actorUserId, action, targetEntity, targetId, timestamp, metadata — every
  read/write touching SSN or claim status is logged here

## Core user flows

### Claimant

1. **Sign up** (email/password) → email verification
2. **Identity verification** — mocked ID.me/Login.gov-style redirect/callback; a clear
   explanatory screen precedes the redirect, explaining why SSN and personal info are
   needed. This directly corrects the original prototype's SSN-first-with-no-context problem.
3. **Claim initiation** — employment history, reason for separation, benefit year setup
4. **Weekly certification** (recurring) — able/available to work, worked this week +
   earnings, refused work, job-search activity log (minimum 3 contacts/week, matching
   typical state requirements)
5. **Auto-decision**, evaluated against a visible, explainable rules set (shown to the
   claimant, not a black box). Rules are evaluated in the order listed below; the first
   matching rule determines the outcome (e.g., a claimant who is both not able/available
   AND under the job-search minimum is **Denied**, not Flagged):
   - Not able/available → **Denied**
   - Reported work refusal → **Flagged** for caseworker review
   - Earned income reported → **Flagged** for review (partial-benefit calculation deferred
     to Phase 2)
   - Fewer than 3 job-search contacts → **Flagged**
   - Otherwise → **Approved**
6. **Dashboard** — current claim status, certification history, messages
7. **Messages** — view messages/notices from caseworkers or the system

### Caseworker

1. **Staff dashboard** — queue of flagged certifications needing review, searchable/
   filterable claimant list
2. **Case detail view** — full claim history, certifications, audit trail, case notes
3. **Review action** — approve/deny/flag, adjust benefit amount (required reason, logged to
   `ClaimReviewAction`), edit claimant record fields
4. **Messaging** — send a message/notice to the claimant
5. Every action here writes to `AuditLog`

## Accessibility (WCAG 2.2 AA / Section 508)

- Semantic HTML first (`<form>`, `<fieldset>`/`<legend>`, `<button>`, `<nav>`, correct
  heading hierarchy); ARIA only to fill genuine gaps
- Every form field: visible `<label>`, programmatic error association
  (`aria-describedby`), errors announced via `aria-live`, inline + summary error listing
  (WCAG 3.3.1)
- Color contrast: minimum 4.5:1 text / 3:1 UI components, enforced via the design-token
  layer, not spot-checked
- Never color-alone: claim status shown with icon + text label + color — fixes the original
  prototype's unlabeled color-coded category tabs
- Full keyboard operability: logical tab order, visible focus rings, no keyboard traps,
  skip-to-content link
- Screen-reader-tested flows: weekly certification wizard and identity verification step
  specifically tested with NVDA/VoiceOver during build
- Usable at 200% zoom and down to 320px width without horizontal scroll or content loss
- Session timeout warnings with an extend option (WCAG 2.2.1), given the benefit-claim
  stakes
- Automated gate in CI: axe-core runs against every page in the Playwright E2E suite; a
  regression fails the build

## Security & compliance posture

- SSN encrypted at rest (application-level AES-256), masked to last-4 everywhere by
  default; full reveal is a deliberate action that writes to `AuditLog`
- Password hashing via bcrypt (NextAuth), httpOnly/secure/sameSite session cookies, CSRF
  protection (NextAuth default)
- Role-based access control enforced at the API route level — a claimant token cannot call
  a caseworker endpoint regardless of what the UI shows
- Shared Zod validation schemas between client and server; server is the source of truth
- Basic rate limiting on login and identity-verification endpoints
- Every PII read/write and claim-status change logged to `AuditLog` with actor, timestamp,
  target
- See Non-goals for the explicit boundary on what this security posture does and doesn't
  cover

## Error handling

- Client + server validation run the same Zod schemas
- API errors return a consistent shape, mapped to accessible, plain-language messages — no
  raw stack traces or DB errors reach the client
- Fail-safe default: any edge case the auto-decision engine can't cleanly resolve defaults
  to **Flagged for review**, never silent auto-approval
- Identity verification failure/timeout has a clear retry path — no dead ends

## Testing

- **Unit tests** (Vitest) — heaviest coverage on the auto-decision rules engine and all Zod
  schemas
- **Integration tests** — API routes against a seeded test Postgres instance, including RBAC
  enforcement checks
- **E2E tests** (Playwright) — full critical paths: signup → identity verification → claim →
  weekly certification → caseworker review/approval
- **Accessibility gate**: axe-core run against every page inside the Playwright E2E suite
- Manual screen-reader pass (NVDA/VoiceOver) on the weekly certification wizard and identity
  verification flow before Phase 1 is considered done

## Success criteria

Phase 1 is done when: a claimant can sign up, complete mocked identity verification, open a
claim, submit weekly certifications that are auto-decided against visible rules, and see
their status and messages — all WCAG 2.2 AA compliant end-to-end; and a caseworker can review
flagged certifications, approve/deny/adjust, and leave case notes, with every sensitive
action audit-logged.
