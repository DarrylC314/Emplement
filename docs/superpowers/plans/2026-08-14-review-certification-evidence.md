# Review Certification Evidence & Wage Confirmation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Caseworker Review Certification page to show the full evidence behind a flagged certification (answers, job-search contacts, the specific flagging rule, employer/wage records, conflicting-data flags, certification history, case notes, payment consequences, supporting documents), backed by a new claimant-facing wage-record confirmation step that replaces a dead-end freeform field.

**Architecture:** Additive to the existing Next.js 14 App Router / Prisma / PostgreSQL codebase. Three new Prisma models (`WageRecord`, `Payment`, `Document`) and three new nullable columns on `WeeklyCertification`. A mocked wage-record lookup (same pattern as the existing `MockIDProof` identity verification) generates deterministic simulated employer/wage data. The claimant confirms/corrects it through a new page before their claim proceeds to the dashboard. The caseworker's review page fetches all of this plus existing data (case notes, certification history) through one new `GET` endpoint and renders it read-only above the unchanged decision form.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, PostgreSQL via Prisma, NextAuth.js, Zod, Vitest, Playwright + axe-core. No new dependencies — file upload uses the App Router's native `req.formData()`, not a new multipart-parsing library.

## Global Constraints

- Follow every existing convention exactly: `requireRole`/`requireOwnership` at the top of every API route, never trusting client-supplied identifiers (e.g. `caseworkerId`, `actorUserId` always come from `session.user.id`).
- Zod validation schemas in `src/lib/validation/`, shared shape between client and server; server is the source of truth.
- Every PII read/write, file upload/download, and status-affecting action writes an `AuditLog` row via `writeAuditLog`.
- API routes use `apiError`/`invalidBody`/`parseJson` from `src/lib/apiRequest.ts`; Zod failures return `{ errors: parsed.error.flatten() }`, everything else `{ error: string }`.
- Prisma `select` blocks are always explicit — never `include: { user: true }` or any nested include that would ship unused PII/password hashes to the client.
- WCAG 2.2 AA: semantic HTML, every status/warning uses icon + text + color (never color alone, matching `StatusBadge`'s existing pattern), every form field has a visible label and `aria-describedby` error association, `role="alert"` for errors and warnings, `role="status"` for confirmations.
- axe-core scans every route in `tests/e2e/accessibility.spec.ts` — a new or changed page must pass it.
- **Deviation from the design spec, decided during planning:** `WeeklyCertification.autoDecisionReason` is kept, not replaced. The spec's literal text called for replacing it with structured fields; actually doing that would touch 9 existing test files that construct certifications with a manual `autoDecisionReason` string (`certifications.test.ts`, `claim-detail.test.ts`, `review-action.test.ts`, `staff-claimants.test.ts`, `staff-queue.test.ts`, `accessibility.spec.ts`, `caseworker-flow.spec.ts`, plus two API routes and two pages that read it). Adding three new nullable columns (`autoDecisionRuleId`, `autoDecisionThreshold`, `autoDecisionActualValue`) alongside the existing column delivers the same structured-rule display with zero blast radius to working tests — every existing call site keeps compiling and passing unchanged, and the review page falls back to the plain `autoDecisionReason` string when the new columns are null (e.g. for certifications created before this plan).
- **Deviation from the design spec, decided during planning:** the design spec described the claim being created only after all wage records are confirmed. That would require `WageRecord` to exist before a `Claim` does, which the spec's own schema (a required `claimId` foreign key) doesn't support. This plan keeps claim creation exactly where it is today (`POST /api/claims`, immediately from reason + benefit year start) and inserts the wage-confirmation step as a new page the claimant is redirected to right after, mirroring the existing two-step identity-verification pattern (`/claim/verify-identity` → `/claim/verify-identity/callback`). The observable outcome — a claimant doesn't reach their dashboard with unconfirmed wage data — is unchanged.

---

## Task 1: Schema — WageRecord, Payment, Document models

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `WageRecord`, `Payment`, `Document`; enums `PaymentStatus` (`PAID` | `WITHHELD`), `EmployerVerifiedStatus` (`UNVERIFIED`); new nullable columns on `WeeklyCertification`: `autoDecisionRuleId: String?`, `autoDecisionThreshold: String?`, `autoDecisionActualValue: String?`. Back-relations `Claim.wageRecords`, `Claim.payments`, `Claim.documents`, `WeeklyCertification.payments`, `WeeklyCertification.documents`, `User.uploadedDocuments`.

- [ ] **Step 1: Add the new enums, models, and columns to the schema**

Add these enums near the existing ones at the top of `prisma/schema.prisma` (after `enum ReviewActionType`):

```prisma
enum PaymentStatus {
  PAID
  WITHHELD
}

enum EmployerVerifiedStatus {
  UNVERIFIED
}
```

Add these three nullable columns to the existing `WeeklyCertification` model, immediately after `autoDecisionReason String`:

```prisma
  autoDecisionRuleId       String?
  autoDecisionThreshold    String?
  autoDecisionActualValue  String?
```

Add these back-relations: on `Claim`, after `caseNotes CaseNote[]`, add `wageRecords WageRecord[]`, `payments Payment[]`, `documents Document[]`. On `WeeklyCertification`, after `reviewActions ClaimReviewAction[]`, add `payments Payment[]`, `documents Document[]`. On `User`, after `auditLogs AuditLog[]`, add `uploadedDocuments Document[] @relation("DocumentUploader")`.

Add these three new models at the end of the file:

```prisma
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
  source                 String
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
  uploadedBy            User                 @relation("DocumentUploader", fields: [uploadedByUserId], references: [id])
  filename              String
  storedPath            String
  uploadedAt            DateTime             @default(now())
}
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add_wage_payment_document_models`
Expected: Completes with no errors; a new migration directory appears under `prisma/migrations/`; Prisma Client regenerates.

- [ ] **Step 3: Write failing schema smoke tests**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block, after the existing `it('can create and read back a User', ...)` test:

```ts
  it('can create and read back a WageRecord, Payment, and Document tied to a claim', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-wage-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    const cert = await prisma.weeklyCertification.create({
      data: {
        claimId: claim.id,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'APPROVED',
        autoDecisionReason: 'All eligibility criteria met.',
        autoDecisionRuleId: 'ALL_CRITERIA_MET',
      },
    });

    const wageRecord = await prisma.wageRecord.create({
      data: {
        claimId: claim.id,
        employerName: 'Acme Manufacturing LLC',
        fein: '43-1234567',
        workLocation: 'Jefferson City, MO',
        jobTitle: 'Machinist',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 22.5,
        hoursPerWeek: 40,
        separationReason: 'Laid off — reduction in force',
        source: 'Simulated state wage database lookup',
      },
    });
    expect(wageRecord.employerVerifiedStatus).toBe('UNVERIFIED');
    expect(wageRecord.claimantConfirmed).toBe(false);

    const payment = await prisma.payment.create({
      data: {
        claimId: claim.id,
        weeklyCertificationId: cert.id,
        amount: 320,
        status: 'PAID',
      },
    });
    expect(payment.status).toBe('PAID');

    const document = await prisma.document.create({
      data: {
        claimId: claim.id,
        weeklyCertificationId: cert.id,
        uploadedByUserId: user.id,
        filename: 'proof.pdf',
        storedPath: '/tmp/whatever.pdf',
      },
    });
    expect(document.filename).toBe('proof.pdf');

    await prisma.document.delete({ where: { id: document.id } });
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.wageRecord.delete({ where: { id: wageRecord.id } });
    await prisma.weeklyCertification.delete({ where: { id: cert.id } });
    await prisma.claim.delete({ where: { id: claim.id } });
    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS (this test doesn't need pre-implementation since the migration already created the tables — this step is verification, not TDD-red).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/schema.test.ts
git commit -m "Add WageRecord, Payment, and Document models"
```

---

## Task 2: Decision engine structured rule metadata (additive)

**Files:**
- Modify: `src/lib/decisionEngine.ts`
- Modify: `src/app/api/certifications/route.ts`
- Modify: `tests/unit/decisionEngine.test.ts`
- Modify: `tests/integration/certifications.test.ts`

**Interfaces:**
- Consumes: nothing new (pure refactor of an existing pure function).
- Produces: `DecisionResult` now includes `ruleId: string`, `threshold?: string`, `actualValue?: string` alongside the existing `decision` and `reason`. Later tasks (7, 9) read `ruleId`/`threshold`/`actualValue` off a persisted `WeeklyCertification` to render the structured "why this was flagged" section.

- [ ] **Step 1: Write the failing test for structured rule metadata**

Replace the full contents of `tests/unit/decisionEngine.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateCertification, type CertificationInput } from '@/lib/decisionEngine';

const baseline: CertificationInput = {
  ableAndAvailable: true,
  workedThisWeek: false,
  earnings: 0,
  refusedWork: false,
  jobSearchActivityCount: 3,
};

describe('evaluateCertification', () => {
  it('approves a clean baseline week', () => {
    const result = evaluateCertification(baseline);
    expect(result).toEqual({
      decision: 'APPROVED',
      reason: 'All eligibility criteria met.',
      ruleId: 'ALL_CRITERIA_MET',
    });
  });

  it('denies when not able/available to work', () => {
    const result = evaluateCertification({ ...baseline, ableAndAvailable: false });
    expect(result.decision).toBe('DENIED');
    expect(result.reason).toMatch(/able.*available/i);
    expect(result.ruleId).toBe('ABLE_AND_AVAILABLE');
  });

  it('flags when work was refused', () => {
    const result = evaluateCertification({ ...baseline, refusedWork: true });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/refus/i);
    expect(result.ruleId).toBe('WORK_REFUSAL');
  });

  it('flags when earnings are reported', () => {
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: true,
      earnings: 150,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
    expect(result.ruleId).toBe('EARNED_INCOME');
  });

  it('flags reported earnings even when workedThisWeek is false', () => {
    // Regression: the rule used to require BOTH workedThisWeek AND earnings > 0,
    // so a claimant reporting earnings while answering "No" to "did you work
    // this week" fell through to APPROVED — a silent overpayment path. The spec
    // flags earned income unconditionally.
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: false,
      earnings: 150,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
    expect(result.ruleId).toBe('EARNED_INCOME');
  });

  it('flags reported work even when earnings are zero', () => {
    const result = evaluateCertification({
      ...baseline,
      workedThisWeek: true,
      earnings: 0,
    });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/earn/i);
    expect(result.ruleId).toBe('EARNED_INCOME');
  });

  it('flags when fewer than 3 job-search contacts are reported, with threshold/actualValue set', () => {
    const result = evaluateCertification({ ...baseline, jobSearchActivityCount: 2 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.reason).toMatch(/job.search/i);
    expect(result.ruleId).toBe('JOB_SEARCH_MINIMUM');
    expect(result.threshold).toBe('3 contacts');
    expect(result.actualValue).toBe('2 contacts');
  });

  it('denies (not flags) when both not-able/available AND under job-search minimum apply — first match wins', () => {
    const result = evaluateCertification({
      ...baseline,
      ableAndAvailable: false,
      jobSearchActivityCount: 0,
    });
    expect(result.decision).toBe('DENIED');
    expect(result.ruleId).toBe('ABLE_AND_AVAILABLE');
  });

  it('defaults to FLAGGED for a negative job-search count (malformed input, fail-safe)', () => {
    const result = evaluateCertification({ ...baseline, jobSearchActivityCount: -1 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.ruleId).toBe('INVALID_INPUT');
  });

  it('defaults to FLAGGED for negative earnings (malformed input, fail-safe)', () => {
    const result = evaluateCertification({ ...baseline, earnings: -50 });
    expect(result.decision).toBe('FLAGGED');
    expect(result.ruleId).toBe('INVALID_INPUT');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/decisionEngine.test.ts`
Expected: FAIL — `result.ruleId` is `undefined` (the current `DecisionResult` type has no `ruleId` field).

- [ ] **Step 3: Update the decision engine to return structured metadata**

Replace the full contents of `src/lib/decisionEngine.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/decisionEngine.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Persist the structured fields when a certification is created**

In `src/app/api/certifications/route.ts`, update the `prisma.weeklyCertification.create` call to also persist the new fields. Change:

```ts
      autoDecision: decision.decision,
      autoDecisionReason: decision.reason,
```

to:

```ts
      autoDecision: decision.decision,
      autoDecisionReason: decision.reason,
      autoDecisionRuleId: decision.ruleId,
      autoDecisionThreshold: decision.threshold,
      autoDecisionActualValue: decision.actualValue,
```

- [ ] **Step 6: Add an integration assertion that the structured fields persist**

Append to `tests/integration/certifications.test.ts`, inside the existing `describe('POST /api/certifications', ...)` block, after the existing `it('flags a certification with fewer than 3 job-search contacts', ...)` test:

```ts
  it('persists structured rule metadata alongside the plain-language reason', async () => {
    const req = new Request('http://localhost/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        weekEndingDate: '2026-08-29',
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        jobSearchActivities: [
          { employerName: 'Acme', contactMethod: 'Online', contactDate: '2026-08-26', position: 'Machinist' },
        ],
      }),
    });
    const res = await POST(req);
    const cert = await res.json();
    expect(cert.autoDecisionRuleId).toBe('JOB_SEARCH_MINIMUM');
    expect(cert.autoDecisionThreshold).toBe('3 contacts');
    expect(cert.autoDecisionActualValue).toBe('1 contacts');
    certificationIds.push(cert.id);
  });
```

- [ ] **Step 7: Run the full test file and verify it passes**

Run: `npx vitest run tests/integration/certifications.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS — every existing test that reads `autoDecisionReason` (a plain string) is unaffected since that column and its value are unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/lib/decisionEngine.ts src/app/api/certifications/route.ts tests/unit/decisionEngine.test.ts tests/integration/certifications.test.ts
git commit -m "Add structured rule metadata to the decision engine"
```

---

## Task 3: Mock wage-record lookup generator

**Files:**
- Create: `src/lib/mockWageLookup.ts`
- Test: `tests/unit/mockWageLookup.test.ts`

**Interfaces:**
- Produces: `generateMockWageRecords(claimId: string): MockWageRecordResult[]`, where `MockWageRecordResult` is `{ employerName: string; fein: string; workLocation: string; jobTitle: string; wageRate: number; hoursPerWeek: number; separationReason: string; firstDayWorked: Date; lastDayWorked: Date | null; recallDate: Date | null }`. Consumed by Task 4's `POST /api/wage-lookup` route.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mockWageLookup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateMockWageRecords } from '@/lib/mockWageLookup';

describe('generateMockWageRecords', () => {
  it('is deterministic: the same claimId always returns the same result', () => {
    const first = generateMockWageRecords('claim-abc-123');
    const second = generateMockWageRecords('claim-abc-123');
    expect(first).toEqual(second);
  });

  it('returns realistic, non-empty employer/wage fields when records are found', () => {
    // Sample many ids; at least one should produce a non-empty result with
    // complete fields (the generator is allowed to return zero records for
    // some ids — the "no records found" state is a real, handled outcome —
    // so this asserts on the non-empty branch specifically).
    const withRecords = Array.from({ length: 20 }, (_, i) => generateMockWageRecords(`claim-${i}`)).find(
      (r) => r.length > 0
    );
    expect(withRecords).toBeDefined();
    const record = withRecords![0]!;
    expect(record.employerName.length).toBeGreaterThan(0);
    expect(record.fein).toMatch(/^\d{2}-\d{7}$/);
    expect(record.wageRate).toBeGreaterThan(0);
    expect(record.hoursPerWeek).toBeGreaterThan(0);
    expect(record.firstDayWorked).toBeInstanceOf(Date);
  });

  it('can return zero records for some claims — a valid, handled state', () => {
    const withNoRecords = Array.from({ length: 20 }, (_, i) => generateMockWageRecords(`claim-${i}`)).find(
      (r) => r.length === 0
    );
    expect(withNoRecords).toBeDefined();
  });

  it('produces two distinct employer templates across a large sample', () => {
    const employerNames = new Set(
      Array.from({ length: 30 }, (_, i) => generateMockWageRecords(`sample-${i}`))
        .filter((r) => r.length > 0)
        .map((r) => r[0]!.employerName)
    );
    expect(employerNames.size).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/mockWageLookup.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mockWageLookup'`.

- [ ] **Step 3: Implement the generator**

Create `src/lib/mockWageLookup.ts`:

```ts
// A deterministic, simulated wage-record lookup — no real external call, no
// real payroll/wage integration (that's a later-phase subsystem). Follows
// the same shape of decision as the existing mocked identity verification
// (MockIDProof): stable output for a given input so demos and tests are
// reproducible, rather than random data that changes every run.

export type MockWageRecordResult = {
  employerName: string;
  fein: string;
  workLocation: string;
  jobTitle: string;
  wageRate: number;
  hoursPerWeek: number;
  separationReason: string;
  firstDayWorked: Date;
  lastDayWorked: Date | null;
  recallDate: Date | null;
};

type Template = {
  employerName: string;
  fein: string;
  workLocation: string;
  jobTitle: string;
  wageRate: number;
  hoursPerWeek: number;
  separationReason: string;
  daysAgoFirstWorked: number;
  daysAgoLastWorked: number | null; // null = no separation on file (still active)
  daysUntilRecall: number | null; // null = no recall date on file
};

const TEMPLATES: Template[] = [
  {
    employerName: 'Acme Manufacturing LLC',
    fein: '43-1234567',
    workLocation: 'Jefferson City, MO',
    jobTitle: 'Machinist',
    wageRate: 22.5,
    hoursPerWeek: 40,
    separationReason: 'Laid off — reduction in force',
    daysAgoFirstWorked: 730,
    daysAgoLastWorked: 14,
    daysUntilRecall: null,
  },
  {
    employerName: 'Riverbend Logistics Inc.',
    fein: '61-9876543',
    workLocation: 'Columbia, MO',
    jobTitle: 'Warehouse Associate',
    wageRate: 18.75,
    hoursPerWeek: 32,
    separationReason: 'Seasonal layoff',
    daysAgoFirstWorked: 400,
    daysAgoLastWorked: 21,
    daysUntilRecall: 60,
  },
];

/**
 * Simulated per-claim wage-record lookup. Roughly a third of claims (by hash
 * bucket) return no records at all — "no wage records found" is a real,
 * handled outcome the confirmation UI and review page must both cope with,
 * not just a theoretical edge case.
 */
export function generateMockWageRecords(claimId: string): MockWageRecordResult[] {
  const bucket = hashToIndex(claimId, 3);
  if (bucket === 2) return [];

  const template = TEMPLATES[bucket]!;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  return [
    {
      employerName: template.employerName,
      fein: template.fein,
      workLocation: template.workLocation,
      jobTitle: template.jobTitle,
      wageRate: template.wageRate,
      hoursPerWeek: template.hoursPerWeek,
      separationReason: template.separationReason,
      firstDayWorked: daysAgo(template.daysAgoFirstWorked),
      lastDayWorked: template.daysAgoLastWorked === null ? null : daysAgo(template.daysAgoLastWorked),
      recallDate: template.daysUntilRecall === null ? null : daysFromNow(template.daysUntilRecall),
    },
  ];
}

function hashToIndex(input: string, modulus: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % modulus;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/mockWageLookup.test.ts`
Expected: PASS (4 tests). If "produces two distinct employer templates" is flaky because the 30-sample loop happened not to hit both buckets, increase the sample size to 60 — this should not occur with 30 given the hash distribution, but is a legitimate fix if observed rather than a symptom of a real bug.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mockWageLookup.ts tests/unit/mockWageLookup.test.ts
git commit -m "Add deterministic mock wage-record lookup generator"
```

---

## Task 4: Wage-record API routes

**Files:**
- Create: `src/lib/validation/wageRecord.ts`
- Create: `src/app/api/wage-lookup/route.ts`
- Create: `src/app/api/wage-records/[id]/route.ts`
- Test: `tests/integration/wage-lookup.test.ts`
- Test: `tests/integration/wage-records.test.ts`

**Interfaces:**
- Consumes: `generateMockWageRecords` from Task 3; `requireOwnership`/`requireRole` from `@/lib/rbac`; `writeAuditLog` from `@/lib/audit`.
- Produces: `POST /api/wage-lookup` (body `{ claimId }`, CLAIMANT-only, idempotent — returns existing records if already looked up, otherwise generates and creates them) and `PATCH /api/wage-records/[id]` (body `{ confirmed: boolean, disputeNote?: string, ...correction fields }`, CLAIMANT-only, ownership-checked). Both consumed by Task 5's wage-confirmation page.

- [ ] **Step 1: Write the validation schema**

Create `src/lib/validation/wageRecord.ts`:

```ts
import { z } from 'zod';

export const wageRecordUpdateSchema = z.object({
  confirmed: z.boolean(),
  disputeNote: z.string().min(1).optional(),
  employerName: z.string().min(1).optional(),
  fein: z.string().min(1).optional(),
  workLocation: z.string().min(1).optional(),
  jobTitle: z.string().min(1).optional(),
  wageRate: z.number().min(0).optional(),
  hoursPerWeek: z.number().min(0).optional(),
  separationReason: z.string().min(1).optional(),
  firstDayWorked: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid date')
    .optional(),
  lastDayWorked: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid date')
    .nullable()
    .optional(),
  recallDate: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid date')
    .nullable()
    .optional(),
});

export type WageRecordUpdateInput = z.infer<typeof wageRecordUpdateSchema>;
```

- [ ] **Step 2: Write the failing test for POST /api/wage-lookup**

Create `tests/integration/wage-lookup.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/wage-lookup/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/wage-lookup', () => {
  let userId: string;
  let claimantProfileId: string;
  let claimId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `wage-lookup-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    claimantProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;
  });

  it('creates wage records for a claim and writes an audit log', async () => {
    const req = new Request('http://localhost/api/wage-lookup', {
      method: 'POST',
      body: JSON.stringify({ claimId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const records = await res.json();
    expect(Array.isArray(records)).toBe(true);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Claim', targetId: claimId, action: 'WAGE_LOOKUP_PERFORMED' },
    });
    expect(log).not.toBeNull();
  });

  it('is idempotent: a second lookup returns the same records instead of creating duplicates', async () => {
    const before = await prisma.wageRecord.count({ where: { claimId } });
    const req = new Request('http://localhost/api/wage-lookup', {
      method: 'POST',
      body: JSON.stringify({ claimId }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const after = await prisma.wageRecord.count({ where: { claimId } });
    expect(after).toBe(before);
  });

  it('rejects a lookup for a claim the caller does not own', async () => {
    const otherUser = await prisma.user.create({
      data: { email: `wage-lookup-other-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const otherProfile = await prisma.claimantProfile.create({ data: { userId: otherUser.id } });
    const otherClaim = await prisma.claim.create({
      data: {
        claimantId: otherProfile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });

    const req = new Request('http://localhost/api/wage-lookup', {
      method: 'POST',
      body: JSON.stringify({ claimId: otherClaim.id }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);

    await prisma.claim.delete({ where: { id: otherClaim.id } });
    await prisma.claimantProfile.delete({ where: { id: otherProfile.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'Claim', targetId: claimId } });
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/wage-lookup.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/wage-lookup/route'`.

- [ ] **Step 4: Implement POST /api/wage-lookup**

Create `src/app/api/wage-lookup/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { generateMockWageRecords } from '@/lib/mockWageLookup';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ claimId?: string }>(req);
  if (!body) return invalidBody();

  const { claimId } = body;
  if (!claimId) {
    return apiError('claimId is required', 400);
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return apiError('Claim not found', 404);
  }

  const owns = requireOwnership(session, claim.claimantId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  const existing = await prisma.wageRecord.findMany({ where: { claimId } });
  if (existing.length > 0) {
    return Response.json(existing, { status: 200 });
  }

  const mockRecords = generateMockWageRecords(claimId);
  const created = await Promise.all(
    mockRecords.map((r) =>
      prisma.wageRecord.create({
        data: {
          claimId,
          employerName: r.employerName,
          fein: r.fein,
          workLocation: r.workLocation,
          jobTitle: r.jobTitle,
          firstDayWorked: r.firstDayWorked,
          lastDayWorked: r.lastDayWorked,
          wageRate: r.wageRate,
          hoursPerWeek: r.hoursPerWeek,
          separationReason: r.separationReason,
          recallDate: r.recallDate,
          source: 'Simulated state wage database lookup',
        },
      })
    )
  );

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'WAGE_LOOKUP_PERFORMED',
    targetEntity: 'Claim',
    targetId: claimId,
    metadata: { recordCount: created.length },
  });

  return Response.json(created, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/wage-lookup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing test for PATCH /api/wage-records/[id]**

Create `tests/integration/wage-records.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { PATCH } from '@/app/api/wage-records/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('PATCH /api/wage-records/[id]', () => {
  let userId: string;
  let claimantProfileId: string;
  let claimId: string;
  let recordId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `wage-record-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    claimantProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const record = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'Acme Manufacturing LLC',
        fein: '43-1234567',
        workLocation: 'Jefferson City, MO',
        jobTitle: 'Machinist',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 22.5,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    recordId = record.id;
  });

  it('confirms a wage record as-is', async () => {
    const req = new Request(`http://localhost/api/wage-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true }),
    });
    const res = await PATCH(req, { params: { id: recordId } });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.claimantConfirmed).toBe(true);
    expect(updated.claimantDisputeNote).toBeNull();
  });

  it('applies a correction and dispute note', async () => {
    const req = new Request(`http://localhost/api/wage-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        confirmed: true,
        disputeNote: 'This was actually part-time, 20 hours a week.',
        hoursPerWeek: 20,
      }),
    });
    const res = await PATCH(req, { params: { id: recordId } });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(Number(updated.hoursPerWeek)).toBe(20);
    expect(updated.claimantDisputeNote).toBe('This was actually part-time, 20 hours a week.');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'WageRecord', targetId: recordId, action: 'WAGE_RECORD_CORRECTED' },
    });
    expect(log).not.toBeNull();
  });

  it('rejects updating a wage record the caller does not own', async () => {
    const otherUser = await prisma.user.create({
      data: { email: `wage-record-other-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherUser.id, role: 'CLAIMANT', claimantProfileId: 'not-the-owner', email: otherUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request(`http://localhost/api/wage-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true }),
    });
    const res = await PATCH(req, { params: { id: recordId } });
    expect(res.status).toBe(403);

    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'WageRecord', targetId: recordId } });
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/integration/wage-records.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/wage-records/[id]/route'`.

- [ ] **Step 8: Implement PATCH /api/wage-records/[id]**

Create `src/app/api/wage-records/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { wageRecordUpdateSchema } from '@/lib/validation/wageRecord';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = wageRecordUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const record = await prisma.wageRecord.findUnique({
    where: { id: params.id },
    include: { claim: true },
  });
  if (!record) {
    return apiError('Wage record not found', 404);
  }

  const owns = requireOwnership(session, record.claim.claimantId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  const { confirmed, disputeNote, ...corrections } = parsed.data;

  const updated = await prisma.wageRecord.update({
    where: { id: params.id },
    data: {
      claimantConfirmed: confirmed,
      claimantDisputeNote: disputeNote ?? null,
      ...(corrections.employerName !== undefined && { employerName: corrections.employerName }),
      ...(corrections.fein !== undefined && { fein: corrections.fein }),
      ...(corrections.workLocation !== undefined && { workLocation: corrections.workLocation }),
      ...(corrections.jobTitle !== undefined && { jobTitle: corrections.jobTitle }),
      ...(corrections.wageRate !== undefined && { wageRate: corrections.wageRate }),
      ...(corrections.hoursPerWeek !== undefined && { hoursPerWeek: corrections.hoursPerWeek }),
      ...(corrections.separationReason !== undefined && {
        separationReason: corrections.separationReason,
      }),
      ...(corrections.firstDayWorked !== undefined && {
        firstDayWorked: new Date(corrections.firstDayWorked),
      }),
      ...(corrections.lastDayWorked !== undefined && {
        lastDayWorked: corrections.lastDayWorked === null ? null : new Date(corrections.lastDayWorked),
      }),
      ...(corrections.recallDate !== undefined && {
        recallDate: corrections.recallDate === null ? null : new Date(corrections.recallDate),
      }),
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: disputeNote ? 'WAGE_RECORD_CORRECTED' : 'WAGE_RECORD_CONFIRMED',
    targetEntity: 'WageRecord',
    targetId: params.id,
  });

  return Response.json(updated, { status: 200 });
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/integration/wage-records.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/validation/wageRecord.ts src/app/api/wage-lookup src/app/api/wage-records tests/integration/wage-lookup.test.ts tests/integration/wage-records.test.ts
git commit -m "Add wage-record lookup and confirm/correct API routes"
```

---

## Task 5: Claimant wage-confirmation page + claim/new flow update

**Files:**
- Create: `src/app/claim/wage-confirmation/page.tsx`
- Modify: `src/app/claim/new/page.tsx`
- Modify: `src/lib/validation/claim.ts`
- Modify: `tests/unit/validation.test.ts`
- Modify: `tests/integration/claims.test.ts`
- Modify: `tests/integration/ownership.test.ts`

**Interfaces:**
- Consumes: `POST /api/wage-lookup` and `PATCH /api/wage-records/[id]` from Task 4.
- Produces: `/claim/new` submit now redirects to `/claim/wage-confirmation?claimId=<id>` instead of `/claim/dashboard`. Consumed by Task 10's E2E flow update.

- [ ] **Step 1: Remove employmentHistory from the claim initiation schema**

Replace the full contents of `src/lib/validation/claim.ts`:

```ts
import { z } from 'zod';

export const claimInitiationSchema = z.object({
  reasonForSeparation: z.enum(['LAYOFF', 'FIRED', 'QUIT', 'CONTRACT_ENDED', 'OTHER']),
  benefitYearStart: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
});

export type ClaimInitiationInput = z.infer<typeof claimInitiationSchema>;
```

- [ ] **Step 2: Update the schema's unit tests**

In `tests/unit/validation.test.ts`, find the `describe('claimInitiationSchema', ...)` block and remove the `employmentHistory` line from both `it` blocks inside it, so the payloads read:

```ts
    const result = claimInitiationSchema.safeParse({
      reasonForSeparation: 'LAYOFF',
      benefitYearStart: '2026-08-11',
    });
```

and

```ts
    const result = claimInitiationSchema.safeParse({
      reasonForSeparation: 'MADE_UP_REASON',
      benefitYearStart: '2026-08-11',
    });
```

- [ ] **Step 3: Update the integration tests that POST to /api/claims**

In `tests/integration/claims.test.ts`, remove the `employmentHistory: 'Worked at Acme Corp for 3 years as a machinist.',` line from the request body.

In `tests/integration/ownership.test.ts`, remove the `employmentHistory: 'Attacker-supplied employment history.',` line from the request body.

- [ ] **Step 4: Run the affected tests to verify they still pass**

Run: `npx vitest run tests/unit/validation.test.ts tests/integration/claims.test.ts tests/integration/ownership.test.ts`
Expected: PASS — Zod's default behavior strips unrecognized keys from an input object, so these tests would have kept passing even unedited; this step confirms that and leaves the test payloads accurate to what the client now actually sends.

- [ ] **Step 5: Update the claim-filing page to drop the freeform field and redirect to wage confirmation**

Replace the full contents of `src/app/claim/new/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Fieldset } from '@/components/ui/Fieldset';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

const REASONS = [
  { value: 'LAYOFF', label: 'Laid off / position eliminated' },
  { value: 'FIRED', label: 'Fired' },
  { value: 'QUIT', label: 'Quit' },
  { value: 'CONTRACT_ENDED', label: 'Contract ended' },
  { value: 'OTHER', label: 'Other' },
];

export default function NewClaimPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [reasonForSeparation, setReasonForSeparation] = useState('LAYOFF');
  const [benefitYearStart, setBenefitYearStart] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const res = await fetch('/api/claims', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: session?.user.claimantProfileId,
        reasonForSeparation,
        benefitYearStart,
      }),
    });
    if (res.ok) {
      const claim = await res.json();
      router.push(`/claim/wage-confirmation?claimId=${claim.id}`);
      return;
    }
    setErrors([{ id: 'benefitYearStart', message: 'Please check your entries and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">File a new claim</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <Fieldset
          legend="Reason for separation"
          name="reasonForSeparation"
          options={REASONS}
          value={reasonForSeparation}
          onChange={setReasonForSeparation}
        />
        <TextField
          id="benefitYearStart"
          label="Benefit year start date"
          type="date"
          value={benefitYearStart}
          onChange={setBenefitYearStart}
          required
        />
        <Button type="submit">Submit claim</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Create the wage-confirmation page**

Create `src/app/claim/wage-confirmation/page.tsx`:

```tsx
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type WageRecord = {
  id: string;
  employerName: string;
  workLocation: string;
  jobTitle: string;
  wageRate: string;
  hoursPerWeek: string;
  separationReason: string;
  claimantConfirmed: boolean;
};

export default function WageConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <WageConfirmationForm />
    </Suspense>
  );
}

function WageConfirmationForm() {
  const params = useSearchParams();
  const router = useRouter();
  const claimId = params.get('claimId') ?? '';

  const [records, setRecords] = useState<WageRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');

  useEffect(() => {
    if (!claimId) return;
    fetch('/api/wage-lookup', { method: 'POST', body: JSON.stringify({ claimId }) })
      .then((res) => {
        if (!res.ok) throw new Error('lookup failed');
        return res.json();
      })
      .then(setRecords)
      .catch(() => setLoadError('We could not look up your employment records. Please try again.'));
  }, [claimId]);

  async function handleConfirm(id: string) {
    const res = await fetch(`/api/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true }),
    });
    if (res.ok) {
      const updated = await res.json();
      setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
    }
  }

  async function handleDispute(id: string) {
    if (!disputeNote.trim()) return;
    const res = await fetch(`/api/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true, disputeNote }),
    });
    if (res.ok) {
      const updated = await res.json();
      setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
      setCorrectingId(null);
      setDisputeNote('');
    }
  }

  const allConfirmed = records !== null && records.every((r) => r.claimantConfirmed);

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Confirm your employment</h1>

      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}

      {records === null && !loadError && <p>Looking up your employment records…</p>}

      {records !== null && records.length === 0 && (
        <>
          <p className="mb-6 text-text-secondary">
            We didn&apos;t find any employer or wage records on file for you. You can continue.
          </p>
          <Button onClick={() => router.push('/claim/dashboard')}>Continue to my dashboard</Button>
        </>
      )}

      {records !== null && records.length > 0 && (
        <>
          <p className="mb-6 text-text-secondary">
            We found these employers and wage records. Please confirm or correct them.
          </p>
          <ul className="space-y-4 mb-6">
            {records.map((r) => (
              <li key={r.id} className="border border-border rounded p-4">
                <p className="font-medium">{r.employerName}</p>
                <dl className="text-sm text-text-secondary grid grid-cols-2 gap-x-4 gap-y-1 my-2">
                  <dt>Work location</dt>
                  <dd>{r.workLocation}</dd>
                  <dt>Job title</dt>
                  <dd>{r.jobTitle}</dd>
                  <dt>Wage rate</dt>
                  <dd>${r.wageRate}/hr</dd>
                  <dt>Hours per week</dt>
                  <dd>{r.hoursPerWeek}</dd>
                  <dt>Separation reason</dt>
                  <dd>{r.separationReason}</dd>
                </dl>

                {r.claimantConfirmed ? (
                  <p role="status" className="text-status-active-text font-medium">
                    ✓ Confirmed
                  </p>
                ) : correctingId === r.id ? (
                  <div>
                    <TextField
                      id={`dispute-${r.id}`}
                      label="What's incorrect?"
                      value={disputeNote}
                      onChange={setDisputeNote}
                      required
                    />
                    <Button onClick={() => handleDispute(r.id)}>Submit correction</Button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button onClick={() => handleConfirm(r.id)}>Confirm</Button>
                    <Button variant="secondary" onClick={() => setCorrectingId(r.id)}>
                      This isn&apos;t right
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Button disabled={!allConfirmed} onClick={() => router.push('/claim/dashboard')}>
            Continue to my dashboard
          </Button>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, sign in as a claimant, go through Verify Identity → File a new claim, and confirm submitting the claim form lands on `/claim/wage-confirmation?claimId=...`, shows either the "no records found" state or one employer card, and that confirming (or correcting) it enables "Continue to my dashboard", which then lands on `/claim/dashboard`.
Expected: Full flow works with no console errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/claim/wage-confirmation src/app/claim/new/page.tsx src/lib/validation/claim.ts tests/unit/validation.test.ts tests/integration/claims.test.ts tests/integration/ownership.test.ts
git commit -m "Add claimant wage-confirmation step, replacing the unused employment history field"
```

---

## Task 6: File upload/download subsystem

**Files:**
- Create: `src/lib/documentStorage.ts`
- Create: `src/app/api/documents/route.ts`
- Create: `src/app/api/documents/[id]/route.ts`
- Test: `tests/integration/documents.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `POST /api/documents` (multipart form: `file`, `claimId`, optional `weeklyCertificationId`; CASEWORKER/ADMIN only) and `GET /api/documents/[id]` (streams the file; CASEWORKER/ADMIN only). Consumed by Task 9's review page.

- [ ] **Step 1: Ignore the local upload directory**

Add this line to `.gitignore`, after `/playwright-report`:

```
/uploads
```

- [ ] **Step 2: Write the storage helper**

Create `src/lib/documentStorage.ts`:

```ts
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Local disk storage, not cloud object storage: sufficient for this stage
// and avoids a new external dependency/credential. Render's free tier
// filesystem is ephemeral across redeploys, so uploaded files will not
// survive one there — an accepted limitation for a demo, not durable
// production storage.
const STORAGE_DIR = process.env.DOCUMENT_STORAGE_PATH ?? './uploads';

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export async function saveDocumentFile(file: File): Promise<string> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const ext = ALLOWED_DOCUMENT_TYPES[file.type] ?? '';
  const storedName = `${crypto.randomUUID()}${ext}`;
  const storedPath = path.join(STORAGE_DIR, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storedPath, buffer);
  return storedPath;
}

export async function readDocumentFile(storedPath: string): Promise<Buffer> {
  return fs.readFile(storedPath);
}
```

- [ ] **Step 3: Write the failing integration test**

Create `tests/integration/documents.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/documents/route';
import { GET } from '@/app/api/documents/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('document upload/download', () => {
  let caseworkerId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let documentId: string;

  beforeAll(async () => {
    const caseworker = await prisma.user.create({
      data: { email: `doc-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;

    const claimantUser = await prisma.user.create({
      data: { email: `doc-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = profile.id;
    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworker.id, role: 'CASEWORKER', email: caseworker.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('uploads a PDF and writes an audit log', async () => {
    const file = new File([Buffer.from('%PDF-1.4 fake pdf content')], 'evidence.pdf', {
      type: 'application/pdf',
    });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('claimId', claimId);

    const req = new Request('http://localhost/api/documents', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    documentId = body.id;

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Document', targetId: documentId, action: 'DOCUMENT_UPLOADED' },
    });
    expect(log).not.toBeNull();
  });

  it('rejects a disallowed file type', async () => {
    const file = new File([Buffer.from('not allowed')], 'malware.exe', {
      type: 'application/x-msdownload',
    });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('claimId', claimId);

    const req = new Request('http://localhost/api/documents', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('downloads the uploaded document and writes an audit log', async () => {
    const res = await GET(new Request('http://localhost/api/documents/x'), {
      params: { id: documentId },
    });
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.toString()).toContain('fake pdf content');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Document', targetId: documentId, action: 'DOCUMENT_DOWNLOADED' },
    });
    expect(log).not.toBeNull();
  });

  afterAll(async () => {
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (document) {
      await fs.rm(document.storedPath, { force: true });
    }
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'Document', targetId: documentId } });
    await prisma.document.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/integration/documents.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/documents/route'`.

- [ ] **Step 5: Implement POST /api/documents**

Create `src/app/api/documents/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';
import { saveDocumentFile, MAX_DOCUMENT_SIZE_BYTES, ALLOWED_DOCUMENT_TYPES } from '@/lib/documentStorage';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError('Invalid request body', 400);
  }

  const file = formData.get('file');
  const claimId = formData.get('claimId');
  const weeklyCertificationId = formData.get('weeklyCertificationId');

  if (!(file instanceof File)) {
    return apiError('A file is required', 400);
  }
  if (typeof claimId !== 'string' || !claimId) {
    return apiError('claimId is required', 400);
  }
  if (!(file.type in ALLOWED_DOCUMENT_TYPES)) {
    return apiError('Only PDF, PNG, or JPEG files are allowed', 400);
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return apiError('File exceeds the 10MB size limit', 400);
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return apiError('Claim not found', 404);
  }

  const storedPath = await saveDocumentFile(file);

  const document = await prisma.document.create({
    data: {
      claimId,
      weeklyCertificationId:
        typeof weeklyCertificationId === 'string' && weeklyCertificationId ? weeklyCertificationId : null,
      uploadedByUserId: session!.user.id,
      filename: file.name,
      storedPath,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'DOCUMENT_UPLOADED',
    targetEntity: 'Document',
    targetId: document.id,
    metadata: { claimId },
  });

  return Response.json(
    { id: document.id, filename: document.filename, uploadedAt: document.uploadedAt },
    { status: 201 }
  );
}
```

- [ ] **Step 6: Implement GET /api/documents/[id]**

Create `src/app/api/documents/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';
import { readDocumentFile } from '@/lib/documentStorage';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const document = await prisma.document.findUnique({ where: { id: params.id } });
  if (!document) {
    return apiError('Document not found', 404);
  }

  const buffer = await readDocumentFile(document.storedPath);

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'DOCUMENT_DOWNLOADED',
    targetEntity: 'Document',
    targetId: document.id,
  });

  const safeFilename = document.filename.replace(/[^\w.-]/g, '_');
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    },
  });
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/integration/documents.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add .gitignore src/lib/documentStorage.ts src/app/api/documents tests/integration/documents.test.ts
git commit -m "Add local-disk file upload/download for supporting documents"
```

---

## Task 7: Conflicting-data helper + Review evidence GET route

**Files:**
- Create: `src/lib/conflictingData.ts`
- Test: `tests/unit/conflictingData.test.ts`
- Modify: `src/app/api/certifications/[id]/review/route.ts`
- Test: `tests/integration/review-evidence.test.ts`

**Interfaces:**
- Produces: `findConflictingWageRecords(certification, wageRecords): ConflictFlag[]`, `GET /api/certifications/[id]/review` returning the full `ReviewEvidence` shape. Consumed by Task 9's review page.

- [ ] **Step 1: Write the failing test for the conflicting-data helper**

Create `tests/unit/conflictingData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findConflictingWageRecords } from '@/lib/conflictingData';

const weekEndingDate = new Date('2026-08-15');

describe('findConflictingWageRecords', () => {
  it('returns no flags when the claimant reported working this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: true, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: null }]
    );
    expect(flags).toEqual([]);
  });

  it('returns no flags when the claimant reported earnings this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 100, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: null }]
    );
    expect(flags).toEqual([]);
  });

  it('flags an active job with no separation and no recall date, when the claimant reported no work/earnings', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: null }]
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.wageRecordId).toBe('w1');
  });

  it('does not flag a job that separated before this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: new Date('2026-08-01'), recallDate: null }]
    );
    expect(flags).toEqual([]);
  });

  it('does not flag an active job with a recall date after this week (approved layoff)', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: new Date('2026-09-01') }]
    );
    expect(flags).toEqual([]);
  });

  it('flags an active job whose recall date has already passed this week', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [{ id: 'w1', lastDayWorked: null, recallDate: new Date('2026-08-01') }]
    );
    expect(flags).toHaveLength(1);
  });

  it('evaluates multiple wage records independently', () => {
    const flags = findConflictingWageRecords(
      { workedThisWeek: false, earnings: 0, weekEndingDate },
      [
        { id: 'w1', lastDayWorked: new Date('2026-08-01'), recallDate: null },
        { id: 'w2', lastDayWorked: null, recallDate: null },
      ]
    );
    expect(flags.map((f) => f.wageRecordId)).toEqual(['w2']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/conflictingData.test.ts`
Expected: FAIL — `Cannot find module '@/lib/conflictingData'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/conflictingData.ts`:

```ts
export type WageRecordForConflictCheck = {
  id: string;
  lastDayWorked: Date | null;
  recallDate: Date | null;
};

export type ConflictFlag = { wageRecordId: string; message: string };

/**
 * Flags a wage record as conflicting with a certification's self-report when
 * the claimant reported no work/earnings for the week, but the wage record
 * indicates the job was still active during that week — no separation on
 * file, and either no recall date or one that has already passed (an
 * approved-layoff recall date still in the future is NOT a conflict: the
 * claimant isn't due back yet).
 */
export function findConflictingWageRecords(
  certification: { workedThisWeek: boolean; earnings: number; weekEndingDate: Date },
  wageRecords: WageRecordForConflictCheck[]
): ConflictFlag[] {
  if (certification.workedThisWeek || certification.earnings > 0) return [];

  const flags: ConflictFlag[] = [];
  for (const record of wageRecords) {
    const stillActive =
      record.lastDayWorked === null || record.lastDayWorked >= certification.weekEndingDate;
    const onApprovedLayoffThisWeek =
      record.recallDate !== null && record.recallDate > certification.weekEndingDate;
    if (stillActive && !onApprovedLayoffThisWeek) {
      flags.push({
        wageRecordId: record.id,
        message:
          'Claimant reported no work or earnings this week, but this employer record shows an active job with no approved layoff covering this week.',
      });
    }
  }
  return flags;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/conflictingData.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for GET /api/certifications/[id]/review**

Create `tests/integration/review-evidence.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET } from '@/app/api/certifications/[id]/review/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('GET /api/certifications/[id]/review', () => {
  let caseworkerId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let certId: string;
  let wageRecordId: string;

  beforeAll(async () => {
    const caseworker = await prisma.user.create({
      data: { email: `evidence-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;

    const claimantUser = await prisma.user.create({
      data: { email: `evidence-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'Evidence Test Claimant' },
    });
    claimantProfileId = profile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const cert = await prisma.weeklyCertification.create({
      data: {
        claimId,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'FLAGGED',
        autoDecisionReason: 'Fewer than 3 job-search contacts.',
        autoDecisionRuleId: 'JOB_SEARCH_MINIMUM',
        autoDecisionThreshold: '3 contacts',
        autoDecisionActualValue: '1 contacts',
        jobSearchActivities: {
          create: [
            { employerName: 'Acme', contactMethod: 'Online', contactDate: new Date('2026-08-12'), position: 'Machinist' },
          ],
        },
      },
    });
    certId = cert.id;

    await prisma.caseNote.create({
      data: { claimId, caseworkerId: caseworker.id, note: 'Called claimant, left voicemail.' },
    });

    const wageRecord = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'Acme Manufacturing LLC',
        fein: '43-1234567',
        workLocation: 'Jefferson City, MO',
        jobTitle: 'Machinist',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 22.5,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    wageRecordId = wageRecord.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworker.id, role: 'CASEWORKER', email: caseworker.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('returns the full evidence bundle including a computed conflict', async () => {
    const res = await GET(new Request('http://localhost/api/certifications/x/review'), {
      params: { id: certId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.certification.autoDecisionRuleId).toBe('JOB_SEARCH_MINIMUM');
    expect(body.jobSearchActivities).toHaveLength(1);
    expect(body.claim.claimantName).toBe('Evidence Test Claimant');
    expect(body.caseNotes).toHaveLength(1);
    expect(body.wageRecords).toHaveLength(1);
    expect(body.wageRecords[0].id).toBe(wageRecordId);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].wageRecordId).toBe(wageRecordId);
    expect(Number(body.paymentPreview.approve)).toBe(320);
  });

  it('rejects a claimant session', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'x@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await GET(new Request('http://localhost/api/certifications/x/review'), {
      params: { id: certId },
    });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.caseNote.deleteMany({ where: { claimId } });
    await prisma.jobSearchActivity.deleteMany({ where: { weeklyCertificationId: certId } });
    await prisma.weeklyCertification.delete({ where: { id: certId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/integration/review-evidence.test.ts`
Expected: FAIL — `GET` is not exported from the route file yet.

- [ ] **Step 7: Add the GET handler to the review route**

In `src/app/api/certifications/[id]/review/route.ts`, add these imports at the top, alongside the existing ones:

```ts
import { findConflictingWageRecords } from '@/lib/conflictingData';
```

Add this `GET` export to the file, above the existing `POST` export:

```ts
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
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/integration/review-evidence.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — the existing `POST` export in this file is untouched.

- [ ] **Step 10: Commit**

```bash
git add src/lib/conflictingData.ts src/app/api/certifications/[id]/review/route.ts tests/unit/conflictingData.test.ts tests/integration/review-evidence.test.ts
git commit -m "Add conflicting-data detection and a GET evidence endpoint for certification review"
```

---

## Task 8: Payment ledger write on review decision

**Files:**
- Modify: `src/app/api/certifications/[id]/review/route.ts`
- Modify: `tests/integration/review-action.test.ts`

**Interfaces:**
- Consumes: `Payment` model from Task 1.
- Produces: every successful `POST /api/certifications/[id]/review` now writes one `Payment` row. Consumed by Task 9's review page (which reads `paymentPreview`, already wired in Task 7) and by later sub-project B (claimant payment history), out of scope here.

- [ ] **Step 1: Write the failing assertions**

In `tests/integration/review-action.test.ts`, add these assertions to the existing tests. In `'approves a flagged certification and reactivates the claim'`, after the existing `expect(log).not.toBeNull();` line, add:

```ts

    const payment = await prisma.payment.findFirst({ where: { weeklyCertificationId: certId } });
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('PAID');
    expect(Number(payment?.amount)).toBe(320);
```

In `'denies a flagged certification and sets the claim status to DENIED'`, after the existing `expect(claim?.status).toBe('DENIED');` line, add:

```ts

    const payment = await prisma.payment.findFirst({ where: { weeklyCertificationId: deniedCertId } });
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('WITHHELD');
```

In `'flags a certification for fraud and restricts the claim'`, after the existing `expect(claim?.status).toBe('RESTRICTED');` line, add:

```ts

    const payment = await prisma.payment.findFirst({ where: { weeklyCertificationId: fraudCertId } });
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('WITHHELD');
```

In `'adjusts the weekly benefit amount and records the previous value'`, after the existing `expect(claim?.status).toBe('ACTIVE');` line, add:

```ts

    const payment = await prisma.payment.findFirst({ where: { weeklyCertificationId: amountCertId } });
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('PAID');
    expect(Number(payment?.amount)).toBe(410);
```

- [ ] **Step 2: Update afterAll for the new FK**

In `tests/integration/review-action.test.ts`, in the `afterAll` block, add this line before `await prisma.claimReviewAction.deleteMany(...)`:

```ts
    await prisma.payment.deleteMany({ where: { weeklyCertificationId: { in: allCertIds } } });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/review-action.test.ts`
Expected: FAIL — the new `payment` lookups return `null` since no `Payment` rows are created yet.

- [ ] **Step 4: Write the payment ledger logic**

In `src/app/api/certifications/[id]/review/route.ts`, in the existing `POST` handler, after the `await prisma.claim.update({...})` call and before `await writeAuditLog({...})`, add:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/review-action.test.ts`
Expected: PASS (all tests, including the new payment assertions).

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/certifications/[id]/review/route.ts tests/integration/review-action.test.ts
git commit -m "Record a payment ledger entry on every certification review decision"
```

---

## Task 9: Review Certification page UI rebuild

**Files:**
- Modify: `src/app/staff/certifications/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `GET /api/certifications/[id]/review` from Task 7, `POST /api/documents` from Task 6. The existing `POST /api/certifications/[id]/review` decision-submission behavior is unchanged.

- [ ] **Step 1: Replace the page with the evidence-rich version**

Replace the full contents of `src/app/staff/certifications/[id]/review/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fieldset } from '@/components/ui/Fieldset';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

const ACTIONS = [
  { value: 'APPROVED', label: 'Approve' },
  { value: 'DENIED', label: 'Deny' },
  { value: 'FLAGGED_FOR_FRAUD', label: 'Flag for fraud investigation' },
  { value: 'AMOUNT_ADJUSTED', label: 'Adjust weekly benefit amount' },
];

type ReviewEvidence = {
  certification: {
    id: string;
    weekEndingDate: string;
    ableAndAvailable: boolean;
    workedThisWeek: boolean;
    earnings: string;
    refusedWork: boolean;
    autoDecision: string;
    autoDecisionReason: string;
    autoDecisionRuleId: string | null;
    autoDecisionThreshold: string | null;
    autoDecisionActualValue: string | null;
  };
  jobSearchActivities: {
    id: string;
    employerName: string;
    contactMethod: string;
    contactDate: string;
    position: string;
  }[];
  claim: { id: string; status: string; weeklyBenefitAmount: string; claimantName: string | null };
  certificationHistory: {
    id: string;
    weekEndingDate: string;
    autoDecision: string;
    autoDecisionReason: string;
  }[];
  caseNotes: { id: string; note: string; createdAt: string }[];
  wageRecords: {
    id: string;
    employerName: string;
    fein: string;
    workLocation: string;
    jobTitle: string;
    firstDayWorked: string;
    lastDayWorked: string | null;
    wageRate: string;
    hoursPerWeek: string;
    separationReason: string;
    recallDate: string | null;
    employerVerifiedStatus: string;
    source: string;
    claimantConfirmed: boolean;
    claimantDisputeNote: string | null;
  }[];
  documents: { id: string; filename: string; uploadedAt: string }[];
  conflicts: { wageRecordId: string; message: string }[];
  paymentPreview: { approve: string; deny: string };
};

export default function ReviewCertificationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [evidence, setEvidence] = useState<ReviewEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [action, setAction] = useState('APPROVED');
  const [reason, setReason] = useState('');
  const [newValue, setNewValue] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [newValueError, setNewValueError] = useState<string | undefined>();

  async function loadEvidence() {
    const res = await fetch(`/api/certifications/${params.id}/review`);
    if (!res.ok) {
      setEvidenceError('We could not load the evidence for this certification.');
      return;
    }
    setEvidence(await res.json());
  }

  useEffect(() => {
    loadEvidence();
    // Loaded once per certification id; loadEvidence is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    if (!evidence) return;
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('claimId', evidence.claim.id);
    formData.append('weeklyCertificationId', evidence.certification.id);

    setUploading(true);
    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    setUploading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setUploadError(body?.error ?? 'We could not upload that file. Please try again.');
      return;
    }
    form.reset();
    loadEvidence();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setReasonError(undefined);
    setNewValueError(undefined);

    const summary: { id: string; message: string }[] = [];
    if (!reason.trim()) {
      const message = 'Enter a reason for this decision.';
      setReasonError(message);
      summary.push({ id: 'reason', message });
    }
    if (action === 'AMOUNT_ADJUSTED' && !(Number(newValue) > 0)) {
      const message = 'Enter the new weekly benefit amount as a number greater than zero.';
      setNewValueError(message);
      summary.push({ id: 'newValue', message });
    }
    if (summary.length > 0) {
      setErrors(summary);
      return;
    }

    // No caseworkerId is sent: the server derives the acting caseworker from
    // the verified session and ignores client-supplied attribution.
    const res = await fetch(`/api/certifications/${params.id}/review`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        reason,
        newValue: action === 'AMOUNT_ADJUSTED' ? newValue : undefined,
      }),
    });
    if (res.ok) {
      router.push('/staff/dashboard');
      return;
    }

    const body = await res.json().catch(() => null);
    const fieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (fieldErrors?.reason?.[0]) {
      setReasonError(fieldErrors.reason[0]);
      setErrors([{ id: 'reason', message: fieldErrors.reason[0] }]);
      return;
    }
    if (fieldErrors?.newValue?.[0]) {
      setNewValueError(fieldErrors.newValue[0]);
      setErrors([{ id: 'newValue', message: fieldErrors.newValue[0] }]);
      return;
    }
    setErrors([
      {
        id: 'reason',
        message: body?.error ?? 'We could not record that decision. Please try again.',
      },
    ]);
  }

  const reasonErrorId = 'reason-error';

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Review certification</h1>

      {evidenceError && (
        <p role="alert" className="mb-4 text-error-text">
          {evidenceError}
        </p>
      )}
      {!evidence && !evidenceError && <p className="mb-4">Loading evidence…</p>}

      {evidence && (
        <>
          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">
              Certification answers — week ending{' '}
              {new Date(evidence.certification.weekEndingDate).toLocaleDateString()}
            </h2>
            <dl className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
              <dt>Able and available</dt>
              <dd>{evidence.certification.ableAndAvailable ? 'Yes' : 'No'}</dd>
              <dt>Worked this week</dt>
              <dd>{evidence.certification.workedThisWeek ? 'Yes' : 'No'}</dd>
              <dt>Earnings</dt>
              <dd>${evidence.certification.earnings}</dd>
              <dt>Refused work</dt>
              <dd>{evidence.certification.refusedWork ? 'Yes' : 'No'}</dd>
            </dl>
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Job-search contacts this week</h2>
            {evidence.jobSearchActivities.length === 0 ? (
              <p className="text-sm text-text-secondary">No job-search contacts were logged.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {evidence.jobSearchActivities.map((a) => (
                  <li key={a.id}>
                    {a.employerName} — {a.position} ({a.contactMethod},{' '}
                    {new Date(a.contactDate).toLocaleDateString()})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Why this was flagged</h2>
            {evidence.certification.autoDecisionRuleId ? (
              <p className="text-sm">
                <strong>{evidence.certification.autoDecisionRuleId.replace(/_/g, ' ')}</strong>
                {evidence.certification.autoDecisionThreshold &&
                  evidence.certification.autoDecisionActualValue && (
                    <>
                      : required {evidence.certification.autoDecisionThreshold}, claimant reported{' '}
                      {evidence.certification.autoDecisionActualValue}
                    </>
                  )}
              </p>
            ) : (
              <p className="text-sm">{evidence.certification.autoDecisionReason}</p>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Employer and wage records</h2>
            {evidence.wageRecords.length === 0 ? (
              <p className="text-sm text-text-secondary">No wage records were found for this claim.</p>
            ) : (
              <ul className="space-y-3">
                {evidence.wageRecords.map((w) => {
                  const conflict = evidence.conflicts.find((c) => c.wageRecordId === w.id);
                  return (
                    <li key={w.id} className="border-t border-border pt-2 text-sm">
                      <p className="font-medium">
                        {w.employerName} (FEIN {w.fein})
                      </p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 my-1">
                        <dt>Work location</dt>
                        <dd>{w.workLocation}</dd>
                        <dt>Job title</dt>
                        <dd>{w.jobTitle}</dd>
                        <dt>First/last day worked</dt>
                        <dd>
                          {new Date(w.firstDayWorked).toLocaleDateString()} –{' '}
                          {w.lastDayWorked ? new Date(w.lastDayWorked).toLocaleDateString() : 'ongoing'}
                        </dd>
                        <dt>Wage rate</dt>
                        <dd>
                          ${w.wageRate}/hr, {w.hoursPerWeek} hrs/week
                        </dd>
                        <dt>Separation reason</dt>
                        <dd>{w.separationReason}</dd>
                        <dt>Recall date</dt>
                        <dd>{w.recallDate ? new Date(w.recallDate).toLocaleDateString() : 'None on file'}</dd>
                        <dt>Employer-verified status</dt>
                        <dd>Unverified — no employer response system available yet</dd>
                        <dt>Source</dt>
                        <dd>{w.source}</dd>
                      </dl>
                      {w.claimantDisputeNote && (
                        <p role="alert" className="text-error-text">
                          Claimant dispute: {w.claimantDisputeNote}
                        </p>
                      )}
                      {conflict && (
                        <p role="alert" className="text-error-text">
                          ⚠ Conflict: {conflict.message}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Certification history</h2>
            {evidence.certificationHistory.length === 0 ? (
              <p className="text-sm text-text-secondary">No prior certifications on this claim.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {evidence.certificationHistory.map((c) => (
                  <li key={c.id}>
                    {new Date(c.weekEndingDate).toLocaleDateString()} — {c.autoDecision}:{' '}
                    {c.autoDecisionReason}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Case notes</h2>
            {evidence.caseNotes.length === 0 ? (
              <p className="text-sm text-text-secondary">No case notes on this claim.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {evidence.caseNotes.map((n) => (
                  <li key={n.id}>
                    {n.note}
                    <span className="block text-text-secondary">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Payment consequence</h2>
            <p className="text-sm">
              Approving records a ${evidence.paymentPreview.approve} payment for this week. Denying or
              flagging for fraud withholds it.
            </p>
          </section>

          <section className="border border-border rounded p-4 mb-6">
            <h2 className="font-medium mb-2">Supporting documents</h2>
            {evidence.documents.length === 0 ? (
              <p className="text-sm text-text-secondary mb-3">No documents submitted.</p>
            ) : (
              <ul className="space-y-1 text-sm mb-3">
                {evidence.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/documents/${d.id}`} className="text-link underline">
                      {d.filename}
                    </a>{' '}
                    <span className="text-text-secondary">
                      ({new Date(d.uploadedAt).toLocaleDateString()})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {uploadError && (
              <p role="alert" className="mb-2 text-error-text">
                {uploadError}
              </p>
            )}
            <form onSubmit={handleUpload}>
              <label htmlFor="file" className="block font-medium mb-1">
                Attach a supporting document (PDF, PNG, or JPEG, up to 10MB)
              </label>
              <input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" className="mb-2" />
              <Button type="submit" disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
            </form>
          </section>
        </>
      )}

      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <Fieldset legend="Decision" name="action" options={ACTIONS} value={action} onChange={setAction} />
        {action === 'AMOUNT_ADJUSTED' && (
          <TextField
            id="newValue"
            label="New weekly benefit amount ($)"
            type="number"
            value={newValue}
            onChange={setNewValue}
            error={newValueError}
            required
          />
        )}
        <div className="mb-4">
          <label htmlFor="reason" className="block font-medium mb-1">
            Reason (required for every decision)
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? reasonErrorId : undefined}
            className={`w-full rounded border px-3 py-2 ${
              reasonError ? 'border-error-border' : 'border-border'
            }`}
          />
          {reasonError && (
            <p id={reasonErrorId} className="mt-1 text-error-text text-sm" role="alert">
              {reasonError}
            </p>
          )}
        </div>
        <Button type="submit">Submit decision</Button>
      </form>
    </main>
  );
}
```

Note: the decision form at the bottom renders unconditionally, regardless of whether `evidence` has loaded — a caseworker is never blocked from submitting a decision by a slow or failed evidence fetch, even though in practice they'll wait to review it first.

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in as a caseworker, open a flagged certification's review page. Confirm every section renders (certification answers, job-search contacts, why-flagged, employer/wage records or "No wage records were found", certification history, case notes, payment consequence, supporting documents), the decision form still works exactly as before, and uploading a PDF adds it to the documents list without a page reload.
Expected: No console errors; all sections populated correctly for a certification created via the seed script or a prior manual test.

- [ ] **Step 3: Run the unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/staff/certifications/[id]/review/page.tsx
git commit -m "Rebuild the Review Certification page to show the full evidence set"
```

---

## Task 10: E2E test updates

**Files:**
- Modify: `tests/e2e/claimant-flow.spec.ts`
- Modify: `tests/e2e/caseworker-flow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1–9.

- [ ] **Step 1: Update the claimant flow to go through wage confirmation**

In `tests/e2e/claimant-flow.spec.ts`, replace this block:

```ts
  await expect(page).toHaveURL(/\/claim\/new/);
  await waitForHydration(page);
  await page.getByLabel(/employment history/i).fill('Worked at Acme Corp for 3 years.');
  await page.getByLabel('Laid off / position eliminated').check();
  await page.getByLabel(/benefit year start date/i).fill('2026-08-11');
  await page.getByRole('button', { name: /submit claim/i }).click();

  await expect(page).toHaveURL(/\/claim\/dashboard/);
  await expect(page.getByText('Active')).toBeVisible();
```

with:

```ts
  await expect(page).toHaveURL(/\/claim\/new/);
  await waitForHydration(page);
  await page.getByLabel('Laid off / position eliminated').check();
  await page.getByLabel(/benefit year start date/i).fill('2026-08-11');
  await page.getByRole('button', { name: /submit claim/i }).click();

  await expect(page).toHaveURL(/\/claim\/wage-confirmation/);
  await waitForHydration(page);

  // The mock wage lookup can deterministically return either an employer
  // record to confirm or an empty "no records found" state, depending on
  // the generated claim id — the flow must complete correctly either way.
  const confirmButton = page.getByRole('button', { name: 'Confirm' }).first();
  const continueButton = page.getByRole('button', { name: /continue to my dashboard/i });
  await expect(confirmButton.or(continueButton)).toBeVisible({ timeout: 10_000 });

  while (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click();
  }
  await continueButton.click();

  await expect(page).toHaveURL(/\/claim\/dashboard/);
  await expect(page.getByText('Active')).toBeVisible();
```

- [ ] **Step 2: Update the claimant-flow teardown for the new tables**

In `tests/e2e/claimant-flow.spec.ts`, in `test.afterAll`, add this line right after `await prisma.weeklyCertification.deleteMany({ where: { claimId: { in: claimIds } } });`:

```ts
    await prisma.wageRecord.deleteMany({ where: { claimId: { in: claimIds } } });
```

- [ ] **Step 3: Update the caseworker-flow teardown for the new Payment table**

In `tests/e2e/caseworker-flow.spec.ts`, in `test.afterAll`, add this line before `await prisma.claimReviewAction.deleteMany({ where: { weeklyCertificationId: certificationId } });`:

```ts
  await prisma.payment.deleteMany({ where: { weeklyCertificationId: certificationId } });
```

- [ ] **Step 4: Add the wage-confirmation route and updated review page to the accessibility suite**

In `tests/e2e/accessibility.spec.ts`, inside `test.describe('claimant pages', ...)`, add this test after the existing `/claim/dashboard` test:

```ts
  test('/claim/wage-confirmation has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/claim/wage-confirmation?claimId=${claimId}`);
    await expect(page.getByRole('heading', { name: /confirm your employment/i })).toBeVisible();
    await waitForHydration(page);
    // The mock lookup can return either state; both must render accessibly.
    await expect(
      page
        .getByRole('button', { name: 'Confirm' })
        .first()
        .or(page.getByText(/didn't find any employer or wage records/i))
    ).toBeVisible({ timeout: 10_000 });
    await expectNoViolations(page);
  });
```

Note: `waitForHydration` must already be imported in this file — confirm the existing `import { waitForHydration } from './helpers';` line is present (it is, per the current file).

- [ ] **Step 5: Update the accessibility suite's teardown for the new tables**

In `tests/e2e/accessibility.spec.ts`, in `test.afterAll`, add this line before the existing claim/certification cleanup (check the current teardown order and insert immediately before the `weeklyCertification`/`claim` deletions, matching the FK-safe ordering already used elsewhere in this file):

```ts
  await prisma.wageRecord.deleteMany({ where: { claimId } });
```

- [ ] **Step 6: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`

(If this hits the recurring OneDrive/Windows `.next` `EINVAL: invalid argument, readlink` build error, run `rm -rf .next && npm run build` first, then start the server manually with `npm run start` in the background, then re-run `npx playwright test --reporter=list` — Playwright will reuse the already-listening server locally rather than trying to build again.)

Expected: All tests pass — the claimant flow, caseworker flow, and every accessibility scan including the new wage-confirmation route and the rebuilt review page.

- [ ] **Step 7: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 8: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 9: Commit**

```bash
git add tests/e2e/claimant-flow.spec.ts tests/e2e/caseworker-flow.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "Update E2E tests for wage confirmation, payment ledger, and the rebuilt review page"
```
