# Employment Expiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track fixed-term/seasonal employment end dates and automatically separate + re-evaluate the affected claim when they expire, driven by a real scheduled job (never a page load), with a role-gated manual control for demos and administrative recovery.

**Architecture:** A shared, framework-agnostic function (`runEmploymentExpirationCheck`) finds due fixed-term `HIRE` events, creates the matching `SEPARATION` event with explicit reason/trigger attribution, and moves the claimant's claim through a mandatory `REEVALUATION_REQUIRED` intermediate state before reactivating (only if structural eligibility checks pass) or leaving it for a caseworker. Two callers share this one function: a Render Cron Job script and a role-gated staff API route.

**Tech Stack:** Next.js 14 App Router, Prisma 5 + PostgreSQL, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- Separation reason for every expiration-generated `SEPARATION` event is exactly `"Fixed-term/seasonal employment concluded"` — this exact string, no variation.
- `TriggerSource` values are exactly `SYSTEM_SCHEDULED`, `SYSTEM_MANUAL_CHECK`, `STAFF` (Prisma enum, uppercase).
- Fixed-term end dates are interpreted as end-of-day `America/Chicago` at write time; all storage/comparison is UTC thereafter — never re-derive a timezone at read/comparison time.
- Expiration must never set a claim directly from `RESTRICTED` to `ACTIVE`. It always passes through `REEVALUATION_REQUIRED` first, and only becomes `ACTIVE` if the structural eligibility checks pass.
- Structural eligibility checks are exactly two: the claim's `benefitYearEnd` has not passed, and the claimant's `identityVerificationStatus` is `VERIFIED`. No other checks.
- The manual "run expiration check now" route is gated `requireRole(session, ['CASEWORKER', 'ADMIN'])`, matching this codebase's existing convention (`src/lib/rbac.ts`).
- Every new Prisma field added to `EmploymentEvent`/`JobPosting` is nullable — no backfill required for existing rows.
- Follow this codebase's established API error shape (`src/lib/apiRequest.ts`: `apiError`, `invalidBody`, `parseJson`) and audit convention (`src/lib/audit.ts`: `writeAuditLog`, called after a transaction commits, never inside one).

---

### Task 1: Schema, migration, and seeded system actor

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`
- Modify: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: `ClaimStatus.REEVALUATION_REQUIRED`, `TriggerSource` enum (`SYSTEM_SCHEDULED | SYSTEM_MANUAL_CHECK | STAFF`), `JobPosting.expectedEndDate`, `EmploymentEvent.expectedEndDate`, `EmploymentEvent.separationTriggeredAt`, `EmploymentEvent.reason`, `EmploymentEvent.triggerSource`, `EmploymentEvent.triggeredByUserId`. A seeded `User` row at `system@emplement.internal` (role `ADMIN`), used by later tasks as the `AuditLog.actorUserId` for unattended runs.

- [ ] **Step 1: Edit the `ClaimStatus` enum**

In `prisma/schema.prisma`, replace lines 24–29:

```prisma
enum ClaimStatus {
  ACTIVE
  RESTRICTED
  DENIED
  CLOSED
}
```

with:

```prisma
enum ClaimStatus {
  ACTIVE
  RESTRICTED
  REEVALUATION_REQUIRED
  DENIED
  CLOSED
}
```

- [ ] **Step 2: Add the `TriggerSource` enum**

Immediately after the `EmploymentEventType` enum (current lines 49–52), insert:

```prisma
enum TriggerSource {
  SYSTEM_SCHEDULED
  SYSTEM_MANUAL_CHECK
  STAFF
}
```

- [ ] **Step 3: Add `expectedEndDate` to `JobPosting`**

Replace the current `JobPosting` model (lines 362–374):

```prisma
model JobPosting {
  id          String           @id @default(cuid())
  employerId  String
  employer    EmployerProfile  @relation(fields: [employerId], references: [id])
  title       String
  description String
  location    String
  status      JobPostingStatus @default(OPEN)
  tags        TagCategory[]    @default([])
  createdAt   DateTime         @default(now())

  applications JobApplication[]
}
```

with:

```prisma
model JobPosting {
  id              String           @id @default(cuid())
  employerId      String
  employer        EmployerProfile  @relation(fields: [employerId], references: [id])
  title           String
  description     String
  location        String
  status          JobPostingStatus @default(OPEN)
  tags            TagCategory[]    @default([])
  createdAt       DateTime         @default(now())
  // Optional fixed-term/seasonal end date, always the UTC instant
  // corresponding to 23:59:59.999 America/Chicago on the selected calendar
  // date (see src/lib/centralTime.ts). null means open-ended.
  expectedEndDate DateTime?

  applications JobApplication[]
}
```

- [ ] **Step 4: Add expiration fields to `EmploymentEvent` and name both `User` relations**

Replace the current `EmploymentEvent` model (lines 332–346):

```prisma
model EmploymentEvent {
  id                       String              @id @default(cuid())
  employerId               String
  employer                 EmployerProfile     @relation(fields: [employerId], references: [id])
  type                     EmploymentEventType
  employeeName             String
  ssnHash                  String
  eventDate                DateTime
  matchedClaimantProfileId String?
  matchedClaimantProfile   ClaimantProfile?    @relation(fields: [matchedClaimantProfileId], references: [id])
  createdAt                DateTime            @default(now())
  dismissedAt       DateTime?
  dismissedByUserId String?
  dismissedBy       User?     @relation(fields: [dismissedByUserId], references: [id])
}
```

with:

```prisma
model EmploymentEvent {
  id                       String              @id @default(cuid())
  employerId               String
  employer                 EmployerProfile     @relation(fields: [employerId], references: [id])
  type                     EmploymentEventType
  employeeName             String
  ssnHash                  String
  eventDate                DateTime
  matchedClaimantProfileId String?
  matchedClaimantProfile   ClaimantProfile?    @relation(fields: [matchedClaimantProfileId], references: [id])
  createdAt                DateTime            @default(now())
  dismissedAt       DateTime?
  dismissedByUserId String?
  // Named relation: this model has more than one User? relation once
  // triggeredByUser (below) is added, so Prisma requires both to be named.
  dismissedBy       User?     @relation("EmploymentEventDismissedBy", fields: [dismissedByUserId], references: [id])

  // Fixed-term/seasonal expiration tracking. expectedEndDate and
  // separationTriggeredAt are only ever populated on marketplace-originated
  // HIRE events. reason/triggerSource/triggeredByUserId are only ever
  // populated on the SEPARATION event the expiration check generates.
  expectedEndDate       DateTime?
  separationTriggeredAt DateTime?
  reason                String?
  triggerSource         TriggerSource?
  triggeredByUserId     String?
  triggeredByUser       User?          @relation("EmploymentEventTriggeredBy", fields: [triggeredByUserId], references: [id])
}
```

- [ ] **Step 5: Update `User`'s back-relations**

Replace line 140 (`  dismissedEmploymentEvents EmploymentEvent[]`) with:

```prisma
  dismissedEmploymentEvents EmploymentEvent[] @relation("EmploymentEventDismissedBy")
  triggeredEmploymentEvents EmploymentEvent[] @relation("EmploymentEventTriggeredBy")
```

- [ ] **Step 6: Generate and run the migration**

Run: `npx prisma migrate dev --name add_employment_expiration`
Expected: a new folder under `prisma/migrations/` and `Your database is now in sync with your schema.` No data-loss warnings (every new column is nullable, both enums are pure additions).

- [ ] **Step 7: Add the seeded system actor to `prisma/seed.ts`**

Immediately after the caseworker upsert block (ends at current line 18, right before the `claimantPasswordHash` block begins), insert:

```ts
  const systemActorPasswordHash = await bcrypt.hash(`system-actor-${Date.now()}-not-a-login`, 12);
  await prisma.user.upsert({
    where: { email: 'system@emplement.internal' },
    update: {},
    create: {
      email: 'system@emplement.internal',
      passwordHash: systemActorPasswordHash,
      role: 'ADMIN',
    },
  });
```

This account is never logged into — it exists purely so `AuditLog.actorUserId` (a required foreign key) has a real `User` row to attribute unattended, scheduled runs of `runEmploymentExpirationCheck` to (Task 6).

- [ ] **Step 8: Add a seed summary line**

After the four existing `console.log('Seed complete: ...')` lines (current lines 408–411), add:

```ts
  console.log('Seed complete: system@emplement.internal (service account for scheduled jobs, no login)');
```

- [ ] **Step 9: Run the seed script to confirm it's idempotent and non-clobbering**

Run: `npm run db:seed`
Expected: completes without error, including the new system-account line in its output. Run it a second time immediately after — the `upsert` must not error or duplicate the row.

- [ ] **Step 10: Add schema round-trip tests**

In `tests/integration/schema.test.ts`, add two new `it()` blocks inside the existing `describe('database schema', ...)`, following the file's established create-read-cleanup pattern (see the existing `'can create and read back an EmploymentEvent with dismissal fields'` test right above where these should go):

```ts
  it('can create and read back a JobPosting with a fixed-term expectedEndDate', async () => {
    const employerUser = await prisma.user.create({
      data: { email: `schema-test-employer-fixedterm-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const posting = await prisma.jobPosting.create({
      data: {
        employerId: employerProfile.id,
        title: 'Seasonal warehouse associate',
        description: 'Holiday season',
        location: 'Springfield, MO',
        expectedEndDate: new Date('2026-12-01T05:59:59.999Z'),
      },
    });
    expect(posting.expectedEndDate?.toISOString()).toBe('2026-12-01T05:59:59.999Z');

    await prisma.jobPosting.delete({ where: { id: posting.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
  });

  it('can create and read back an EmploymentEvent with expiration fields, attributed to a staff user', async () => {
    const employerUser = await prisma.user.create({
      data: { email: `schema-test-employer-expiration-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const staffUser = await prisma.user.create({
      data: { email: `schema-test-staff-expiration-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CASEWORKER' },
    });

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfile.id,
        type: 'SEPARATION',
        employeeName: 'Test Employee',
        ssnHash: `test-hash-${Date.now()}`,
        eventDate: new Date('2026-12-01T05:59:59.999Z'),
        reason: 'Fixed-term/seasonal employment concluded',
        triggerSource: 'STAFF',
        triggeredByUserId: staffUser.id,
      },
    });
    expect(event.reason).toBe('Fixed-term/seasonal employment concluded');
    expect(event.triggerSource).toBe('STAFF');
    expect(event.triggeredByUserId).toBe(staffUser.id);

    await prisma.employmentEvent.delete({ where: { id: event.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
    await prisma.user.delete({ where: { id: staffUser.id } });
  });
```

- [ ] **Step 11: Run the test suite**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: all tests pass, including the two new ones.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts tests/integration/schema.test.ts
git commit -m "feat: add employment expiration schema (REEVALUATION_REQUIRED, TriggerSource, expiration fields) and seeded system actor"
```

---

### Task 2: Central Time end-of-day conversion helper

**Files:**
- Create: `src/lib/centralTime.ts`
- Test: `tests/unit/centralTime.test.ts`

**Interfaces:**
- Produces: `centralTimeEndOfDayToUtc(dateOnly: string): Date`, used by Task 3 (posting form) and read implicitly by Task 6 (the stored value is compared as plain UTC, no further timezone logic needed there).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/centralTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { centralTimeEndOfDayToUtc } from '@/lib/centralTime';

describe('centralTimeEndOfDayToUtc', () => {
  it('converts a Standard Time (CST, UTC-6) date to its correct UTC instant', () => {
    expect(centralTimeEndOfDayToUtc('2026-11-30').toISOString()).toBe('2026-12-01T05:59:59.999Z');
  });

  it('converts a Daylight Time (CDT, UTC-5) date to its correct UTC instant', () => {
    expect(centralTimeEndOfDayToUtc('2026-06-15').toISOString()).toBe('2026-06-16T04:59:59.999Z');
  });

  it('correctly handles the day Daylight Time begins in 2026 (2026-03-08)', () => {
    expect(centralTimeEndOfDayToUtc('2026-03-08').toISOString()).toBe('2026-03-09T04:59:59.999Z');
  });

  it('correctly handles the day Standard Time resumes in 2026 (2026-11-01)', () => {
    expect(centralTimeEndOfDayToUtc('2026-11-01').toISOString()).toBe('2026-11-02T05:59:59.999Z');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/centralTime.test.ts`
Expected: FAIL — `Cannot find module '@/lib/centralTime'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/centralTime.ts`:

```ts
// Converts a YYYY-MM-DD calendar date into the UTC instant corresponding to
// 23:59:59.999 in America/Chicago on that date — correctly accounting for
// whichever of CST (UTC-6) / CDT (UTC-5) applies. The lookup is evaluated at
// UTC noon on the given date specifically because noon is never ambiguous
// across a DST transition (which always happens at 2am local), so the
// offset this reads is always the one in effect for that date's night.
//
// This is the only place in the codebase that reasons about Central Time —
// everything downstream (storage, comparison, the expiration check's "is
// this due" test) works in plain UTC against the instant this returns.
export function centralTimeEndOfDayToUtc(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const noonGuess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  });
  const offsetPart = offsetFormatter
    .formatToParts(noonGuess)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (!offsetPart) {
    throw new Error(`Could not determine America/Chicago UTC offset for ${dateOnly}`);
  }
  // e.g. "GMT-6" -> -6, "GMT-5" -> -5
  const offsetHours = Number(offsetPart.replace('GMT', ''));

  const endOfDayAsIfUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  return new Date(endOfDayAsIfUtc - offsetHours * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/centralTime.test.ts`
Expected: PASS, all 4 tests. (These exact expected values were independently verified via direct Node execution before being written here — see the design spec's Central Time section.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/centralTime.ts tests/unit/centralTime.test.ts
git commit -m "feat: add centralTimeEndOfDayToUtc helper for fixed-term end dates"
```

---

### Task 3: Fixed-term end date — JobPosting field, employer UI, hire-route propagation

**Files:**
- Modify: `src/lib/validation/jobPosting.ts`
- Modify: `src/app/api/employer/job-postings/route.ts`
- Modify: `src/app/employer/job-postings/page.tsx`
- Modify: `src/app/api/employer/job-applications/[id]/hire/route.ts`
- Modify: `tests/integration/employer-job-postings.test.ts`
- Modify: `tests/integration/employer-hire.test.ts`

**Interfaces:**
- Consumes: `centralTimeEndOfDayToUtc` from Task 2; `JobPosting.expectedEndDate` / `EmploymentEvent.expectedEndDate` from Task 1.
- Produces: an `EmploymentEvent.expectedEndDate` populated at hire time whenever the hired posting has one — this is what Task 6's `runEmploymentExpirationCheck` selects against.

- [ ] **Step 1: Extend the validation schema**

In `src/lib/validation/jobPosting.ts`, replace the whole file:

```ts
import { z } from 'zod';
import { TAG_CATEGORY_VALUES } from '@/lib/tagOptions';

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
  tags: z.array(z.enum(TAG_CATEGORY_VALUES)).optional().default([]),
  expectedEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected end date must be in YYYY-MM-DD format')
    .optional(),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
```

- [ ] **Step 2: Convert and store the end date in the POST route, and select it in GET**

In `src/app/api/employer/job-postings/route.ts`, add the import:

```ts
import { centralTimeEndOfDayToUtc } from '@/lib/centralTime';
```

Change the `GET` handler's `select` block (currently `id, title, description, location, status, tags, createdAt`) to also include `expectedEndDate: true`.

Change the `POST` handler's `prisma.jobPosting.create` call from:

```ts
  const posting = await prisma.jobPosting.create({
    data: {
      employerId: session!.user.employerProfileId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      tags: parsed.data.tags,
    },
  });
```

to:

```ts
  const posting = await prisma.jobPosting.create({
    data: {
      employerId: session!.user.employerProfileId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      tags: parsed.data.tags,
      expectedEndDate: parsed.data.expectedEndDate
        ? centralTimeEndOfDayToUtc(parsed.data.expectedEndDate)
        : null,
    },
  });
```

- [ ] **Step 3: Add the field to the employer posting form**

In `src/app/employer/job-postings/page.tsx`:

Widen the `JobPosting` type (lines 12–19) to add `expectedEndDate: string | null;` after `location: string;`.

Add state, alongside the existing field state (after `const [tags, setTags] = useState<string[]>([]);`):

```ts
  const [expectedEndDate, setExpectedEndDate] = useState('');
```

In `handleSubmit`, change the `fetch` call's body from `JSON.stringify({ title, description, location, tags })` to `JSON.stringify({ title, description, location, tags, expectedEndDate: expectedEndDate || undefined })` (an empty string is omitted entirely rather than sent, since `JSON.stringify` drops `undefined` values — sending `""` would fail the schema's regex).

In the same function's success branch, add `setExpectedEndDate('');` alongside the other `set...('')` resets.

In the form JSX, add a new field after the `CheckboxGroup` and before the submit `Button`:

```tsx
          <TextField
            id="expectedEndDate"
            label="Fixed-term or seasonal end date (optional)"
            type="date"
            value={expectedEndDate}
            onChange={setExpectedEndDate}
            error={fieldErrors.expectedEndDate}
          />
```

In the postings list rendering (inside the `<li>` for each posting, after the existing `location — status` `<p>`), add:

```tsx
                {p.expectedEndDate && (
                  <p className="text-text-secondary text-xs">
                    Ends {new Date(p.expectedEndDate).toLocaleDateString(undefined, { timeZone: 'America/Chicago' })}
                  </p>
                )}
```

- [ ] **Step 4: Propagate the end date onto the created EmploymentEvent at hire time**

In `src/app/api/employer/job-applications/[id]/hire/route.ts`, change the initial `prisma.jobApplication.findUnique`'s `select` block's `jobPosting` entry from:

```ts
      jobPosting: { select: { employerId: true } },
```

to:

```ts
      jobPosting: { select: { employerId: true, expectedEndDate: true } },
```

Add, alongside the other destructured constants right before the transaction (near `const employerProfileId = session!.user.employerProfileId;`):

```ts
  const expectedEndDate = application.jobPosting.expectedEndDate;
```

In the transaction's `tx.employmentEvent.create` call, add `expectedEndDate,` to the `data` object (after `eventDate: new Date(),`).

- [ ] **Step 5: Extend the posting-creation integration test**

In `tests/integration/employer-job-postings.test.ts`, add a new `it()` inside the `describe` block, after the existing `'creates a job posting with tags'` test:

```ts
  it('creates a job posting with an optional fixed-term end date, converted to UTC', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Seasonal warehouse associate',
        description: 'Holiday season only',
        location: 'Springfield, MO',
        expectedEndDate: '2026-11-30',
      }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.expectedEndDate).toBe('2026-12-01T05:59:59.999Z');
  });

  it('creates a job posting with no fixed-term end date when omitted', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Permanent role', description: 'Ongoing', location: 'Rolla, MO' }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.expectedEndDate).toBeNull();
  });
```

- [ ] **Step 6: Extend the hire integration test**

In `tests/integration/employer-hire.test.ts`, in the `beforeAll` block, change the `posting` creation (`prisma.jobPosting.create`) to include a fixed-term end date:

```ts
    const posting = await prisma.jobPosting.create({
      data: {
        employerId: employerProfileId,
        title: 'Hired posting',
        description: 'N/A',
        location: 'Rolla, MO',
        expectedEndDate: new Date('2026-12-01T05:59:59.999Z'),
      },
    });
```

In the first test (`'hires the application and cascades every side effect'`), add an assertion right after the existing `expect(event?.employerId).toBe(employerProfileId);` line:

```ts
    expect(event?.expectedEndDate?.toISOString()).toBe('2026-12-01T05:59:59.999Z');
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/integration/employer-job-postings.test.ts tests/integration/employer-hire.test.ts`
Expected: all pass, including the 3 new/modified assertions.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/jobPosting.ts src/app/api/employer/job-postings/route.ts src/app/employer/job-postings/page.tsx src/app/api/employer/job-applications/[id]/hire/route.ts tests/integration/employer-job-postings.test.ts tests/integration/employer-hire.test.ts
git commit -m "feat: fixed-term/seasonal end date on job postings, propagated to hire events"
```

---

### Task 4: REEVALUATION_REQUIRED display (StatusBadge, tokens, Tailwind, literal unions)

**Files:**
- Modify: `src/styles/tokens.ts`
- Modify: `tailwind.config.ts`
- Modify: `src/components/ui/StatusBadge.tsx`
- Modify: `src/app/staff/claimants/[id]/page.tsx`
- Modify: `src/app/claim/dashboard/page.tsx`
- Modify: `tests/unit/components.test.tsx`

**Interfaces:**
- Consumes: `ClaimStatus.REEVALUATION_REQUIRED` from Task 1.
- Produces: `StatusBadge` accepting `status="REEVALUATION_REQUIRED"`, used by Task 7's claimant-detail page path (already imports `StatusBadge`; no further change needed there beyond this task's type widening).

- [ ] **Step 1: Add color tokens**

In `src/styles/tokens.ts`, add two new entries to the `colors` object, in the "status colors" group, after `statusDeniedText`:

```ts
  statusReevaluationBg: '#EDE9FE',
  statusReevaluationText: '#5B21B6', // 7.1:1 on statusReevaluationBg
```

(Contrast verified: `#5B21B6` on `#EDE9FE` is 7.1:1, exceeding the file's stated 4.5:1 AA minimum, matching the pattern of every other status color's inline contrast comment.)

- [ ] **Step 2: Expose the tokens to Tailwind**

In `tailwind.config.ts`, add two entries after `'status-denied-text': colors.statusDeniedText,`:

```ts
        'status-reevaluation-bg': colors.statusReevaluationBg,
        'status-reevaluation-text': colors.statusReevaluationText,
```

- [ ] **Step 3: Widen StatusBadge**

In `src/components/ui/StatusBadge.tsx`, change:

```tsx
type Status = 'ACTIVE' | 'RESTRICTED' | 'DENIED' | 'CLOSED';
```

to:

```tsx
type Status = 'ACTIVE' | 'RESTRICTED' | 'REEVALUATION_REQUIRED' | 'DENIED' | 'CLOSED';
```

Add a new entry to `STATUS_CONFIG`, after the `RESTRICTED` entry:

```tsx
  REEVALUATION_REQUIRED: {
    label: 'Reevaluation required',
    bg: 'bg-status-reevaluation-bg',
    text: 'text-status-reevaluation-text',
    icon: '?',
  },
```

- [ ] **Step 4: Widen the two page-level status literal unions**

In `src/app/staff/claimants/[id]/page.tsx`, change line 16 from:

```ts
    status: 'ACTIVE' | 'RESTRICTED' | 'DENIED' | 'CLOSED';
```

to:

```ts
    status: 'ACTIVE' | 'RESTRICTED' | 'REEVALUATION_REQUIRED' | 'DENIED' | 'CLOSED';
```

In `src/app/claim/dashboard/page.tsx`, change line 11 the same way:

```ts
  status: 'ACTIVE' | 'RESTRICTED' | 'REEVALUATION_REQUIRED' | 'DENIED' | 'CLOSED';
```

- [ ] **Step 5: Write the failing test**

In `tests/unit/components.test.tsx`, add a new `it()` inside `describe('StatusBadge', ...)`, after the existing `'renders text for DENIED'` test:

```ts
  it('renders text for REEVALUATION_REQUIRED', () => {
    render(<StatusBadge status="REEVALUATION_REQUIRED" />);
    expect(screen.getByText('Reevaluation required')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/components.test.tsx`
Expected: PASS, 3 tests in the `StatusBadge` block.

- [ ] **Step 7: Commit**

```bash
git add src/styles/tokens.ts tailwind.config.ts src/components/ui/StatusBadge.tsx src/app/staff/claimants/\[id\]/page.tsx src/app/claim/dashboard/page.tsx tests/unit/components.test.tsx
git commit -m "feat: display REEVALUATION_REQUIRED claim status"
```

---

### Task 5: Block certification submission against a REEVALUATION_REQUIRED claim

**Files:**
- Modify: `src/app/api/certifications/route.ts`
- Modify: `tests/integration/certifications.test.ts`

**Interfaces:**
- Consumes: `ClaimStatus.REEVALUATION_REQUIRED` from Task 1.

- [ ] **Step 1: Write the failing test**

In `tests/integration/certifications.test.ts`, add a new `it()` after the existing `'refuses a certification against a DENIED or CLOSED claim'` test:

```ts
  it('refuses a certification against a REEVALUATION_REQUIRED claim', async () => {
    const reevalClaim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'REEVALUATION_REQUIRED',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });

    const req = new Request('http://localhost/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId: reevalClaim.id,
        weekEndingDate: '2026-09-05',
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        jobSearchActivities: [
          { employerName: 'Acme', contactMethod: 'Online', contactDate: '2026-09-02', position: 'Machinist' },
          { employerName: 'Beta', contactMethod: 'Phone', contactDate: '2026-09-03', position: 'Operator' },
          { employerName: 'Gamma', contactMethod: 'In person', contactDate: '2026-09-04', position: 'Technician' },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/reevaluation_required/i);

    const created = await prisma.weeklyCertification.count({ where: { claimId: reevalClaim.id } });
    expect(created).toBe(0);

    await prisma.claim.delete({ where: { id: reevalClaim.id } });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/certifications.test.ts`
Expected: FAIL — the route currently returns 201, not 409, for a `REEVALUATION_REQUIRED` claim.

- [ ] **Step 3: Widen the blocking check**

In `src/app/api/certifications/route.ts`, change:

```ts
  if (claim.status === 'DENIED' || claim.status === 'CLOSED') {
    return apiError(
      `This claim is ${claim.status.toLowerCase()} and can no longer accept weekly certifications.`,
      409
    );
  }
```

to:

```ts
  if (claim.status === 'DENIED' || claim.status === 'CLOSED' || claim.status === 'REEVALUATION_REQUIRED') {
    return apiError(
      `This claim is ${claim.status.toLowerCase()} and can no longer accept weekly certifications.`,
      409
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/certifications.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/certifications/route.ts tests/integration/certifications.test.ts
git commit -m "fix: block weekly certification submission against a REEVALUATION_REQUIRED claim"
```

---

### Task 6: `runEmploymentExpirationCheck` core business logic

**Files:**
- Create: `src/lib/employmentExpiration.ts`
- Test: `tests/unit/employmentExpiration.test.ts`

**Interfaces:**
- Consumes: `EmploymentEvent`/`JobPosting`/`ClaimStatus`/`TriggerSource` from Task 1; `writeAuditLog` from `src/lib/audit.ts` (existing).
- Produces:
  ```ts
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
  export const FIXED_TERM_SEPARATION_REASON = 'Fixed-term/seasonal employment concluded';
  export async function runEmploymentExpirationCheck(
    trigger: { source: TriggerSource; userId?: string }
  ): Promise<ExpirationCheckSummary>;
  ```
  Used by Task 8's two callers, and read (via the `AuditLog`/`EmploymentEvent` rows it writes) by Task 7's timeline integration.

This is the plan's most complex task. Build it in three steps: the pure structural-eligibility check (easiest to isolate and test), then the per-event transaction, then the batch wrapper.

- [ ] **Step 1: Write the failing tests for `evaluateStructuralEligibility` (internal, tested via the exported function's outcomes)**

Create `tests/unit/employmentExpiration.test.ts`. This first block sets up shared fixtures and mocking — the file's final form is built up across the remaining steps, but write the full file now so each subsequent step's `it()` blocks slot into a working structure:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
import { runEmploymentExpirationCheck, FIXED_TERM_SEPARATION_REASON } from '@/lib/employmentExpiration';

describe('runEmploymentExpirationCheck', () => {
  let systemActorUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  const claimIds: string[] = [];
  const employmentEventIds: string[] = [];

  beforeEach(async () => {
    // Only Date is faked (not setTimeout/setInterval/etc.) — these tests
    // make real Prisma calls against a real database while the fake clock
    // is active, and Prisma's own network I/O relies on real timers.
    // Faking every timer alongside real async DB calls risks hangs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-05T12:00:00Z'));

    const systemUser = await prisma.user.upsert({
      where: { email: 'system@emplement.internal' },
      update: {},
      create: { email: 'system@emplement.internal', passwordHash: 'x', role: 'ADMIN' },
    });
    systemActorUserId = systemUser.id;

    const employerUser = await prisma.user.create({
      data: { email: `expiration-employer-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Expiration Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `expiration-claimant-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName: 'Expiration Test Claimant',
        ssnHash: hashSSN('512-88-3344'),
        identityVerificationStatus: 'VERIFIED',
      },
    });
    claimantProfileId = claimantProfile.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, systemActorUserId] } } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    await prisma.employmentEvent.deleteMany({ where: { id: { in: employmentEventIds } } });
    employmentEventIds.length = 0;
    await prisma.claim.deleteMany({ where: { id: { in: claimIds } } });
    claimIds.length = 0;
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
  });

  async function createRestrictedClaim(overrides: { benefitYearEnd?: Date } = {}) {
    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: overrides.benefitYearEnd ?? new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    });
    claimIds.push(claim.id);
    return claim;
  }

  async function createDueHireEvent(overrides: { expectedEndDate?: Date; matchedClaimantProfileId?: string | null } = {}) {
    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Expiration Test Claimant',
        ssnHash: hashSSN('512-88-3344'),
        eventDate: new Date('2026-08-01'),
        expectedEndDate: overrides.expectedEndDate ?? new Date('2026-12-01T05:59:59.999Z'),
        matchedClaimantProfileId:
          overrides.matchedClaimantProfileId === undefined ? claimantProfileId : overrides.matchedClaimantProfileId,
      },
    });
    employmentEventIds.push(event.id);
    return event;
  }

  it('reactivates the claim when it was the final active employment and structural checks pass', async () => {
    await createRestrictedClaim();
    const hireEvent = await createDueHireEvent();

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.recordsEvaluated).toBe(1);
    expect(summary.separationsCreated).toBe(1);
    expect(summary.claimsReactivated).toBe(1);
    expect(summary.claimsSentToReevaluation).toBe(0);
    expect(summary.claimsRetainedRestricted).toBe(0);
    expect(summary.failures).toEqual([]);

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('ACTIVE');

    const separation = await prisma.employmentEvent.findFirst({
      where: { employerId: employerProfileId, type: 'SEPARATION' },
    });
    employmentEventIds.push(separation!.id);
    expect(separation?.reason).toBe(FIXED_TERM_SEPARATION_REASON);
    expect(separation?.triggerSource).toBe('SYSTEM_SCHEDULED');
    expect(separation?.triggeredByUserId).toBeNull();
    expect(separation?.eventDate.toISOString()).toBe('2026-12-01T05:59:59.999Z');

    const updatedHire = await prisma.employmentEvent.findUnique({ where: { id: hireEvent.id } });
    expect(updatedHire?.separationTriggeredAt).not.toBeNull();

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.subject).toBe('Your claim has been reactivated');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: separation!.id, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    expect(log?.actorUserId).toBe(systemActorUserId);
    const metadata = log?.metadata as { outcome?: string; triggerSource?: string } | null;
    expect(metadata?.outcome).toBe('REACTIVATED');
    expect(metadata?.triggerSource).toBe('SYSTEM_SCHEDULED');
  });

  it('leaves the claim in REEVALUATION_REQUIRED when the benefit year has already ended', async () => {
    await createRestrictedClaim({ benefitYearEnd: new Date('2026-11-01') });
    await createDueHireEvent();

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.claimsSentToReevaluation).toBe(1);
    expect(summary.claimsReactivated).toBe(0);

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('REEVALUATION_REQUIRED');

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: separation!.id, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    const metadata = log?.metadata as { reasons?: string[] } | null;
    expect(metadata?.reasons).toContain('Benefit year has ended');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.subject).toBe('Your claim is under review');
  });

  it('leaves the claim in REEVALUATION_REQUIRED when identity verification is not VERIFIED', async () => {
    await prisma.claimantProfile.update({ where: { id: claimantProfileId }, data: { identityVerificationStatus: 'PENDING' } });
    await createRestrictedClaim();
    await createDueHireEvent();

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.claimsSentToReevaluation).toBe(1);
    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('REEVALUATION_REQUIRED');
  });

  it('retains RESTRICTED, without touching the claim, when other active employment exists', async () => {
    await createRestrictedClaim();
    await createDueHireEvent();

    const otherEmployerUser = await prisma.user.create({
      data: { email: `expiration-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, companyName: 'Other Active Employer LLC', verificationStatus: 'VERIFIED' },
    });
    const otherHire = await prisma.employmentEvent.create({
      data: {
        employerId: otherEmployerProfile.id,
        type: 'HIRE',
        employeeName: 'Expiration Test Claimant',
        ssnHash: hashSSN('512-88-3344'),
        eventDate: new Date('2026-09-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.claimsRetainedRestricted).toBe(1);
    expect(summary.claimsSentToReevaluation).toBe(0);
    expect(summary.claimsReactivated).toBe(0);

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('RESTRICTED');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.subject).toBe('Your fixed-term employment has ended');
    expect(message?.body).toContain('Other Active Employer LLC');

    await prisma.employmentEvent.delete({ where: { id: otherHire.id } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: otherEmployerUser.id } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfile.id } });
    await prisma.user.delete({ where: { id: otherEmployerUser.id } });
  });

  it('is idempotent: a second run against the same data processes zero records', async () => {
    await createRestrictedClaim();
    await createDueHireEvent();

    const first = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(first.recordsEvaluated).toBe(1);

    const second = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(second.recordsEvaluated).toBe(0);
    expect(second.separationsCreated).toBe(0);
  });

  it('does not select a HIRE event whose expectedEndDate is in the future', async () => {
    await createRestrictedClaim();
    await createDueHireEvent({ expectedEndDate: new Date('2027-01-01T05:59:59.999Z') });

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(summary.recordsEvaluated).toBe(0);
  });

  it('attributes a manually-triggered run to the calling staff member', async () => {
    await createRestrictedClaim();
    await createDueHireEvent();

    const caseworker = await prisma.user.create({
      data: { email: `expiration-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });

    await runEmploymentExpirationCheck({ source: 'SYSTEM_MANUAL_CHECK', userId: caseworker.id });

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
    expect(separation?.triggerSource).toBe('SYSTEM_MANUAL_CHECK');
    // triggeredByUserId on the EmploymentEvent itself is reserved for the
    // STAFF trigger source (a direct staff-recorded separation) — a
    // manually-*run* check is still system logic, so this stays null. The
    // calling caseworker's identity is captured on the AuditLog row instead.
    expect(separation?.triggeredByUserId).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: separation!.id, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    expect(log?.actorUserId).toBe(caseworker.id);

    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworker.id } });
    await prisma.user.delete({ where: { id: caseworker.id } });
  });

  it('does not touch a claim when the due HIRE event has no matched claimant', async () => {
    await createDueHireEvent({ matchedClaimantProfileId: null });

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(summary.separationsCreated).toBe(1);
    expect(summary.claimsReactivated + summary.claimsSentToReevaluation + summary.claimsRetainedRestricted).toBe(0);

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
  });

  it('records a per-record failure without stopping the rest of the batch', async () => {
    // Both due events must be valid rows (every FK here is enforced, so an
    // invalid employerId/claimantId would fail at fixture-creation time,
    // before the check even runs) — the failure is instead injected by
    // making the second prisma.$transaction call reject, isolating exactly
    // the try/catch behavior in runEmploymentExpirationCheck without
    // depending on which of the two due events it happens to land on (query
    // order across two freshly-inserted rows isn't guaranteed), so this test
    // uses two independent claimants and checks the aggregate outcome
    // instead of asserting which specific one failed.
    await createRestrictedClaim();
    await createDueHireEvent();

    const secondClaimantUser = await prisma.user.create({
      data: { email: `expiration-claimant-2-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const secondClaimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: secondClaimantUser.id,
        legalName: 'Second Expiration Test Claimant',
        ssnHash: hashSSN('488-22-9911'),
        identityVerificationStatus: 'VERIFIED',
      },
    });
    const secondClaim = await prisma.claim.create({
      data: {
        claimantId: secondClaimantProfile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 300,
      },
    });
    const secondHireEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Second Expiration Test Claimant',
        ssnHash: hashSSN('488-22-9911'),
        eventDate: new Date('2026-07-01'),
        expectedEndDate: new Date('2026-11-15'),
        matchedClaimantProfileId: secondClaimantProfile.id,
      },
    });
    employmentEventIds.push(secondHireEvent.id);

    const originalTransaction = prisma.$transaction.bind(prisma);
    let transactionCallCount = 0;
    const transactionSpy = vi
      .spyOn(prisma, '$transaction')
      .mockImplementation(((fn: unknown) => {
        transactionCallCount += 1;
        if (transactionCallCount === 2) {
          return Promise.reject(new Error('Simulated transaction failure'));
        }
        return originalTransaction(fn as never);
      }) as typeof prisma.$transaction);

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    transactionSpy.mockRestore();

    expect(summary.recordsEvaluated).toBe(2);
    expect(summary.separationsCreated).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].error).toBe('Simulated transaction failure');

    const [claim1, claim2] = await Promise.all([
      prisma.claim.findUnique({ where: { id: claimIds[0] } }),
      prisma.claim.findUnique({ where: { id: secondClaim.id } }),
    ]);
    // Exactly one of the two claims was left untouched by the failed
    // transaction (still RESTRICTED); the other was successfully processed.
    const stillRestrictedCount = [claim1?.status, claim2?.status].filter((s) => s === 'RESTRICTED').length;
    expect(stillRestrictedCount).toBe(1);

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    if (separation) employmentEventIds.push(separation.id);

    await prisma.claim.delete({ where: { id: secondClaim.id } });
    await prisma.claimantProfile.delete({ where: { id: secondClaimantProfile.id } });
    await prisma.user.delete({ where: { id: secondClaimantUser.id } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/employmentExpiration.test.ts`
Expected: FAIL — `Cannot find module '@/lib/employmentExpiration'`.

- [ ] **Step 3: Implement `src/lib/employmentExpiration.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/employmentExpiration.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/employmentExpiration.ts tests/unit/employmentExpiration.test.ts
git commit -m "feat: runEmploymentExpirationCheck core business logic"
```

---

### Task 7: Claimant timeline integration (reason + outcome entries)

**Files:**
- Modify: `src/lib/claimantTimeline.ts`
- Modify: `src/app/api/staff/claimants/[id]/route.ts`
- Modify: `tests/unit/claimantTimeline.test.ts`

**Interfaces:**
- Consumes: `EmploymentEvent.reason` (Task 1), the `EMPLOYMENT_EXPIRATION_PROCESSED` audit action shape produced by Task 6 (`metadata: { outcome, reasons, triggerSource }`, `targetEntity: 'EmploymentEvent'`, `targetId` = the `SEPARATION` event's id).
- Produces: `TimelineEmploymentEvent` widened with `reason?: string | null`; `buildClaimantTimeline` synthesizes one additional entry per processed expiration, alongside the existing "Separated" entry.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/claimantTimeline.test.ts`, add three new `it()` blocks inside the existing `describe('buildClaimantTimeline', ...)`, after the existing `'falls back to "an employer" when companyName is null'` test:

```ts
  it('appends the separation reason to the "Separated" entry when present', () => {
    const events = buildClaimantTimeline(
      [],
      [],
      [
        {
          type: 'SEPARATION',
          eventDate: '2026-12-01T05:59:59.999Z',
          employer: { companyName: 'Seasonal Co' },
          reason: 'Fixed-term/seasonal employment concluded',
        },
      ]
    );
    expect(events[0]?.detail).toBe('Seasonal Co — Fixed-term/seasonal employment concluded');
  });

  it('synthesizes a "Claim reactivated" entry from an EMPLOYMENT_EXPIRATION_PROCESSED audit entry', () => {
    const events = buildClaimantTimeline(
      [],
      [
        {
          action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
          targetId: 'sep-event-1',
          timestamp: '2026-12-05T09:00:00Z',
          metadata: { outcome: 'REACTIVATED', reasons: [] },
        },
      ],
      [
        {
          type: 'SEPARATION',
          eventDate: '2026-12-01T05:59:59.999Z',
          employer: { companyName: 'Seasonal Co' },
          reason: 'Fixed-term/seasonal employment concluded',
        },
      ]
    );
    expect(events.map((e) => e.title)).toEqual(['Separated', 'Claim reactivated']);
  });

  it('synthesizes a "Reevaluation required" entry with its failing checks, and a "Claim remains restricted" entry with its reason', () => {
    const reevalEvents = buildClaimantTimeline(
      [],
      [
        {
          action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
          targetId: 'sep-event-2',
          timestamp: '2026-12-05T09:00:00Z',
          metadata: { outcome: 'REEVALUATION_REQUIRED', reasons: ['Benefit year has ended'] },
        },
      ],
      [{ type: 'SEPARATION', eventDate: '2026-12-01T05:59:59.999Z', employer: { companyName: 'Seasonal Co' } }]
    );
    expect(reevalEvents[1]?.title).toBe('Reevaluation required');
    expect(reevalEvents[1]?.detail).toBe('Benefit year has ended');

    const retainedEvents = buildClaimantTimeline(
      [],
      [
        {
          action: 'EMPLOYMENT_EXPIRATION_PROCESSED',
          targetId: 'sep-event-3',
          timestamp: '2026-12-05T09:00:00Z',
          metadata: { outcome: 'RETAINED_RESTRICTED', reasons: ['Still employed at Other Co'] },
        },
      ],
      [{ type: 'SEPARATION', eventDate: '2026-12-01T05:59:59.999Z', employer: { companyName: 'Seasonal Co' } }]
    );
    expect(retainedEvents[1]?.title).toBe('Claim remains restricted');
    expect(retainedEvents[1]?.detail).toBe('Still employed at Other Co');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/claimantTimeline.test.ts`
Expected: FAIL — `reason` isn't part of `TimelineEmploymentEvent` yet, and `EMPLOYMENT_EXPIRATION_PROCESSED` audit entries currently fall through to the existing `applicationById` lookup and get silently skipped (a `continue`), so the reactivated/reevaluation/retained tests see only 1 event instead of 2.

- [ ] **Step 3: Update `src/lib/claimantTimeline.ts`**

Widen the `TimelineEmploymentEvent` type — change:

```ts
export type TimelineEmploymentEvent = {
  type: 'HIRE' | 'SEPARATION';
  eventDate: string | Date;
  employer: { companyName: string | null };
};
```

to:

```ts
export type TimelineEmploymentEvent = {
  type: 'HIRE' | 'SEPARATION';
  eventDate: string | Date;
  employer: { companyName: string | null };
  reason?: string | null;
};
```

Change the employment-events loop from:

```ts
  for (const event of employmentEvents) {
    events.push({
      timestamp: new Date(event.eventDate).toISOString(),
      title: event.type === 'HIRE' ? 'Hired' : 'Separated',
      detail: event.employer.companyName ?? 'an employer',
    });
  }
```

to:

```ts
  for (const event of employmentEvents) {
    const employerName = event.employer.companyName ?? 'an employer';
    events.push({
      timestamp: new Date(event.eventDate).toISOString(),
      title: event.type === 'HIRE' ? 'Hired' : 'Separated',
      detail: event.reason ? `${employerName} — ${event.reason}` : employerName,
    });
  }
```

Add a title map next to `APPLICATION_AUDIT_TITLES`:

```ts
const EXPIRATION_OUTCOME_TITLES: Record<string, string> = {
  REACTIVATED: 'Claim reactivated',
  REEVALUATION_REQUIRED: 'Reevaluation required',
  RETAINED_RESTRICTED: 'Claim remains restricted',
};
```

In the `dedupedAuditEntries` loop, add a branch for this new action *before* the existing `applicationById.get(entry.targetId)` lookup (its `targetId` is a `SEPARATION` `EmploymentEvent`'s id, not a `JobApplication`'s, so it would never match that lookup):

```ts
  for (const entry of dedupedAuditEntries) {
    const timestamp = new Date(entry.timestamp).toISOString();

    if (entry.action === 'EMPLOYMENT_EXPIRATION_PROCESSED') {
      const metadata = entry.metadata as { outcome?: string; reasons?: string[] } | null;
      const title = metadata?.outcome ? EXPIRATION_OUTCOME_TITLES[metadata.outcome] : undefined;
      if (title) {
        events.push({ timestamp, title, detail: metadata?.reasons?.[0] ?? title });
      }
      continue;
    }

    const application = applicationById.get(entry.targetId);
    if (!application) continue;
    // ...unchanged from here down
```

(The `const timestamp = ...` line already exists earlier in the loop body — this step replaces that declaration plus the `applicationById.get` line immediately after it; the rest of the loop body, from the existing `if (!application) continue;` onward, is unchanged.)

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run tests/unit/claimantTimeline.test.ts`
Expected: PASS, all 12 tests (9 existing + 3 new).

- [ ] **Step 5: Wire the second audit query into the API route**

In `src/app/api/staff/claimants/[id]/route.ts`, add `reason: true` to the `matchedEmploymentEvents` select block (after `eventDate: true,`):

```ts
      matchedEmploymentEvents: {
        orderBy: { eventDate: 'desc' },
        select: {
          id: true,
          type: true,
          eventDate: true,
          reason: true,
          employer: { select: { companyName: true } },
        },
      },
```

Replace the existing `auditEntries` fetch:

```ts
  const applications = claimant.candidateProfile?.applications ?? [];
  const auditEntries =
    applications.length === 0
      ? []
      : await prisma.auditLog.findMany({
          where: { targetEntity: 'JobApplication', targetId: { in: applications.map((a) => a.id) } },
          orderBy: { timestamp: 'asc' },
          select: { action: true, targetId: true, timestamp: true, metadata: true },
        });
  const timeline = buildClaimantTimeline(applications, auditEntries, claimant.matchedEmploymentEvents);
```

with:

```ts
  const applications = claimant.candidateProfile?.applications ?? [];
  const employmentEventIds = claimant.matchedEmploymentEvents.map((e) => e.id);
  const [applicationAuditEntries, employmentEventAuditEntries] = await Promise.all([
    applications.length === 0
      ? Promise.resolve([])
      : prisma.auditLog.findMany({
          where: { targetEntity: 'JobApplication', targetId: { in: applications.map((a) => a.id) } },
          orderBy: { timestamp: 'asc' },
          select: { action: true, targetId: true, timestamp: true, metadata: true },
        }),
    employmentEventIds.length === 0
      ? Promise.resolve([])
      : prisma.auditLog.findMany({
          where: { targetEntity: 'EmploymentEvent', targetId: { in: employmentEventIds } },
          orderBy: { timestamp: 'asc' },
          select: { action: true, targetId: true, timestamp: true, metadata: true },
        }),
  ]);
  const auditEntries = [...applicationAuditEntries, ...employmentEventAuditEntries];
  const timeline = buildClaimantTimeline(applications, auditEntries, claimant.matchedEmploymentEvents);
```

- [ ] **Step 6: Run the full staff-claimants integration test to confirm no regression**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: PASS, unchanged — this test's own `EmploymentEvent` fixture has no `reason` and produces no `EMPLOYMENT_EXPIRATION_PROCESSED` audit entry, so its existing `timeline[0].title === 'Hired'` assertion is unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/lib/claimantTimeline.ts src/app/api/staff/claimants/\[id\]/route.ts tests/unit/claimantTimeline.test.ts
git commit -m "feat: render expiration reason and outcome on the claimant case timeline"
```

---

### Task 8: Callers — manual staff route, cron script, Render config

**Files:**
- Create: `src/app/api/staff/employment-expirations/run-check/route.ts`
- Create: `prisma/checkEmploymentExpirations.ts`
- Create: `render.yaml`
- Modify: `package.json`
- Test: `tests/integration/employment-expirations-run-check.test.ts`

**Interfaces:**
- Consumes: `runEmploymentExpirationCheck` from Task 6.
- Produces: `POST /api/staff/employment-expirations/run-check` returning an `ExpirationCheckSummary` JSON body, consumed by Task 9's staff dashboard button.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/employment-expirations-run-check.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as runCheck } from '@/app/api/staff/employment-expirations/run-check/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/employment-expirations/run-check', () => {
  let caseworkerUserId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimId: string;
  let employmentEventId: string;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: 'system@emplement.internal' },
      update: {},
      create: { email: 'system@emplement.internal', passwordHash: 'x', role: 'ADMIN' },
    });

    const caseworkerUser = await prisma.user.create({
      data: { email: `run-check-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const employerUser = await prisma.user.create({
      data: { email: `run-check-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Run Check Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `run-check-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: hashSSN('601-77-2233'), identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Run Check Claimant',
        ssnHash: hashSSN('601-77-2233'),
        eventDate: new Date('2026-08-01'),
        expectedEndDate: new Date('2026-08-02'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    employmentEventId = event.id;
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await runCheck();
    expect(res.status).toBe(403);
  });

  it('runs the check for a CASEWORKER session and returns the full summary', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await runCheck();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recordsEvaluated).toBeGreaterThanOrEqual(1);
    expect(body.separationsCreated).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.failures)).toBe(true);

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('ACTIVE');
  });

  afterAll(async () => {
    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'EmploymentEvent', targetId: { in: [employmentEventId, separation?.id ?? ''] } } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    if (separation) await prisma.employmentEvent.delete({ where: { id: separation.id } });
    await prisma.employmentEvent.delete({ where: { id: employmentEventId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employment-expirations-run-check.test.ts`
Expected: FAIL — the route module doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/staff/employment-expirations/run-check/route.ts`:

```ts
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';
import { runEmploymentExpirationCheck } from '@/lib/employmentExpiration';

export async function POST() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const summary = await runEmploymentExpirationCheck({
    source: 'SYSTEM_MANUAL_CHECK',
    userId: session!.user.id,
  });

  return Response.json(summary, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employment-expirations-run-check.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Create the cron script**

Create `prisma/checkEmploymentExpirations.ts`:

```ts
// Run on a schedule by the Render Cron Job defined in render.yaml — see
// npm script "check:employment-expirations". Never invoked by any page
// load; this is the real, unattended trigger the design spec requires for
// legally consequential claim-status changes. The manual staff route
// (src/app/api/staff/employment-expirations/run-check/route.ts) calls the
// same underlying function for demos and administrative recovery.
import { prisma } from '../src/lib/prisma';
import { runEmploymentExpirationCheck } from '../src/lib/employmentExpiration';

async function main() {
  const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
  console.log(`Employment expiration check complete: ${JSON.stringify(summary)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 6: Add the npm script**

In `package.json`, add a new entry to `"scripts"`, after `"db:backfill-ssn-hash"`:

```json
    "check:employment-expirations": "tsx prisma/checkEmploymentExpirations.ts"
```

- [ ] **Step 7: Run the script against the dev database to confirm it executes cleanly**

Run: `npm run check:employment-expirations`
Expected: prints `Employment expiration check complete: {"recordsEvaluated":0,...}` (or similar, depending on current dev-database state) and exits 0.

- [ ] **Step 8: Create the Render Cron Job definition**

No `render.yaml` exists in this repo yet — this is a brand-new file. Create `render.yaml`:

```yaml
# Render Blueprint: defines the scheduled job that runs the employment
# expiration check unattended. This file declares the service as code, but
# connecting/enabling it against this repo's Render account is a manual,
# one-time step in the Render dashboard (Blueprints -> New Blueprint
# Instance), the same kind of operational step the original Neon/Render
# provisioning for this app was.
services:
  - type: cron
    name: employment-expiration-check
    runtime: node
    plan: starter
    schedule: "0 12 * * *" # Daily at 12:00 UTC (06:00 or 07:00 Central, depending on DST)
    buildCommand: npm install
    startCommand: npm run check:employment-expirations
    envVars:
      - key: DATABASE_URL
        sync: false
```

- [ ] **Step 9: Commit**

```bash
git add src/app/api/staff/employment-expirations/run-check/route.ts prisma/checkEmploymentExpirations.ts render.yaml package.json tests/integration/employment-expirations-run-check.test.ts
git commit -m "feat: manual/staff and scheduled callers for the employment expiration check"
```

---

### Task 9: Staff dashboard "Run expiration check now" control

**Files:**
- Modify: `src/app/staff/dashboard/page.tsx`
- Test: `tests/unit/staff-dashboard.test.tsx`

**Interfaces:**
- Consumes: `POST /api/staff/employment-expirations/run-check` from Task 8, returning `ExpirationCheckSummary`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/staff-dashboard.test.tsx`, following the `useSession`-mocking convention established in `tests/unit/employer-page-guards.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StaffDashboardPage from '@/app/staff/dashboard/page';

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: sessionState.data }),
}));

function mockCaseworkerSession() {
  sessionState.data = {
    user: { id: 'cw1', role: 'CASEWORKER' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('StaffDashboardPage — expiration check control', () => {
  beforeEach(() => {
    mockCaseworkerSession();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/staff/queue') {
          return Promise.resolve({ ok: true, json: async () => [] } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a "Run expiration check now" button', async () => {
    render(<StaffDashboardPage />);
    expect(await screen.findByRole('button', { name: /run expiration check now/i })).toBeInTheDocument();
  });

  it('shows the full results summary after a successful run', async () => {
    vi.mocked(fetch).mockImplementation((url: string) => {
      if (url === '/api/staff/queue') return Promise.resolve({ ok: true, json: async () => [] } as Response);
      if (url === '/api/staff/employment-expirations/run-check') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            recordsEvaluated: 3,
            separationsCreated: 3,
            claimsRetainedRestricted: 1,
            claimsSentToReevaluation: 1,
            claimsReactivated: 1,
            failures: [{ employmentEventId: 'evt-1', error: 'Something went wrong' }],
            results: [],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<StaffDashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: /run expiration check now/i }));

    await waitFor(() => expect(screen.getByText(/3 evaluated/i)).toBeInTheDocument());
    expect(screen.getByText(/1 reactivated/i)).toBeInTheDocument();
    expect(screen.getByText(/1 sent to reevaluation/i)).toBeInTheDocument();
    expect(screen.getByText(/1 retained as restricted/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failure/i)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/staff-dashboard.test.tsx`
Expected: FAIL — no such button exists yet.

- [ ] **Step 3: Add the control to the dashboard**

In `src/app/staff/dashboard/page.tsx`, add an `ExpirationCheckSummary` type and state, after the existing `ClaimantResult` type block:

```ts
type ExpirationCheckSummary = {
  recordsEvaluated: number;
  separationsCreated: number;
  claimsRetainedRestricted: number;
  claimsSentToReevaluation: number;
  claimsReactivated: number;
  failures: { employmentEventId: string; error: string }[];
};
```

In the component, after the existing `const [results, setResults] = useState<ClaimantResult[]>([]);` line, add:

```ts
  const [expirationSummary, setExpirationSummary] = useState<ExpirationCheckSummary | null>(null);
  const [expirationRunning, setExpirationRunning] = useState(false);
  const [expirationError, setExpirationError] = useState<string | null>(null);

  async function handleRunExpirationCheck() {
    setExpirationRunning(true);
    setExpirationError(null);
    try {
      const res = await fetch('/api/staff/employment-expirations/run-check', { method: 'POST' });
      if (!res.ok) {
        setExpirationError('The expiration check could not be run. Please try again.');
        return;
      }
      setExpirationSummary(await res.json());
    } finally {
      setExpirationRunning(false);
    }
  }
```

Add a new `<section>` in the JSX, after the closing `</ul>` of the review-queue list and before the search `<form>`:

```tsx
      <section className="border border-border rounded p-4 mb-8">
        <h2 className="font-medium mb-2">Employment expiration check</h2>
        <p className="text-sm text-text-secondary mb-2">
          Runs automatically on a schedule. Use this to run it now for a demo, or to catch up after a missed run.
        </p>
        <button
          type="button"
          onClick={handleRunExpirationCheck}
          disabled={expirationRunning}
          className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50"
        >
          {expirationRunning ? 'Running…' : 'Run expiration check now'}
        </button>
        {expirationError && (
          <p role="alert" className="mt-2 text-error-text">
            {expirationError}
          </p>
        )}
        {expirationSummary && (
          <dl className="mt-4 text-sm grid grid-cols-2 gap-x-4 gap-y-1 max-w-md">
            <dt className="text-text-secondary">Evaluated</dt>
            <dd>{expirationSummary.recordsEvaluated} evaluated</dd>
            <dt className="text-text-secondary">Separations created</dt>
            <dd>{expirationSummary.separationsCreated}</dd>
            <dt className="text-text-secondary">Reactivated</dt>
            <dd>{expirationSummary.claimsReactivated} reactivated</dd>
            <dt className="text-text-secondary">Sent to reevaluation</dt>
            <dd>{expirationSummary.claimsSentToReevaluation} sent to reevaluation</dd>
            <dt className="text-text-secondary">Retained as restricted</dt>
            <dd>{expirationSummary.claimsRetainedRestricted} retained as restricted</dd>
            <dt className="text-text-secondary">Failures</dt>
            <dd>{expirationSummary.failures.length} failure{expirationSummary.failures.length === 1 ? '' : 's'}</dd>
          </dl>
        )}
        {expirationSummary && expirationSummary.failures.length > 0 && (
          <ul className="mt-2 text-sm text-error-text space-y-1">
            {expirationSummary.failures.map((f) => (
              <li key={f.employmentEventId}>
                {f.employmentEventId}: {f.error}
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/staff-dashboard.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full unit suite to confirm no regression**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/staff/dashboard/page.tsx tests/unit/staff-dashboard.test.tsx
git commit -m "feat: staff dashboard control to run the employment expiration check on demand"
```

---

### Task 10: End-to-end walkthrough

**Files:**
- Create: `tests/e2e/employment-expiration.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9, exercised as a real user would.

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/employment-expiration.spec.ts`:

```ts
// tests/e2e/employment-expiration.spec.ts
import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma';
import { hashSSN } from '../../src/lib/ssnHash';
import { waitForHydration } from './helpers';

const caseworkerEmail = `e2e-expiration-caseworker-${Date.now()}@example.com`;
const caseworkerPassword = 'E2EExpirationPass123';
const claimantSsn = '733-22-4411';

let employerUserId: string;
let employerProfileId: string;
let claimantUserId: string;
let claimantProfileId: string;
let caseworkerUserId: string;
let claimId: string;
let employmentEventId: string;

test.beforeAll(async () => {
  await prisma.user.upsert({
    where: { email: 'system@emplement.internal' },
    update: {},
    create: { email: 'system@emplement.internal', passwordHash: 'x', role: 'ADMIN' },
  });

  const caseworkerUser = await prisma.user.create({
    data: { email: caseworkerEmail, passwordHash: await bcrypt.hash(caseworkerPassword, 10), role: 'CASEWORKER' },
  });
  caseworkerUserId = caseworkerUser.id;

  const employerUser = await prisma.user.create({
    data: { email: `e2e-expiration-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
  });
  employerUserId = employerUser.id;
  const employerProfile = await prisma.employerProfile.create({
    data: { userId: employerUser.id, companyName: 'E2E Expiration Test Co', verificationStatus: 'VERIFIED' },
  });
  employerProfileId = employerProfile.id;

  const claimantUser = await prisma.user.create({
    data: { email: `e2e-expiration-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
  });
  claimantUserId = claimantUser.id;
  const claimantProfile = await prisma.claimantProfile.create({
    data: {
      userId: claimantUser.id,
      legalName: 'E2E Expiration Fixture Claimant',
      ssnHash: hashSSN(claimantSsn),
      identityVerificationStatus: 'VERIFIED',
    },
  });
  claimantProfileId = claimantProfile.id;

  const claim = await prisma.claim.create({
    data: {
      claimantId: claimantProfileId,
      status: 'RESTRICTED',
      benefitYearStart: new Date('2026-08-01'),
      benefitYearEnd: new Date('2027-08-01'),
      weeklyBenefitAmount: 320,
    },
  });
  claimId = claim.id;

  // Already-past expectedEndDate, so it's due the moment the check runs.
  const event = await prisma.employmentEvent.create({
    data: {
      employerId: employerProfileId,
      type: 'HIRE',
      employeeName: 'E2E Expiration Fixture Claimant',
      ssnHash: hashSSN(claimantSsn),
      eventDate: new Date('2026-01-01'),
      expectedEndDate: new Date('2026-01-15'),
      matchedClaimantProfileId: claimantProfileId,
    },
  });
  employmentEventId = event.id;
});

test('a caseworker runs the expiration check and sees the resulting story on the claimant case page', async ({ page }) => {
  await page.goto('/staff/login');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill(caseworkerEmail);
  await page.getByLabel('Password').fill(caseworkerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/staff\/dashboard/);

  await page.getByRole('button', { name: 'Run expiration check now' }).click();
  await expect(page.getByText(/1 evaluated/i)).toBeVisible();
  await expect(page.getByText(/1 reactivated/i)).toBeVisible();

  await page.goto(`/staff/claimants/${claimantProfileId}`);
  await waitForHydration(page);
  await expect(page.getByRole('heading', { name: 'Case timeline' })).toBeVisible();
  await expect(page.getByText('Separated', { exact: true })).toBeVisible();
  await expect(page.getByText(/Fixed-term\/seasonal employment concluded/i)).toBeVisible();
  await expect(page.getByText('Claim reactivated')).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  const separation = await prisma.employmentEvent.findFirst({
    where: { employerId: employerProfileId, type: 'SEPARATION' },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: [caseworkerUserId] } },
        { targetEntity: 'EmploymentEvent', targetId: { in: [employmentEventId, separation?.id ?? ''] } },
      ],
    },
  });
  await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
  if (separation) await prisma.employmentEvent.delete({ where: { id: separation.id } });
  await prisma.employmentEvent.delete({ where: { id: employmentEventId } });
  await prisma.claim.delete({ where: { id: claimId } });
  await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
  await prisma.user.delete({ where: { id: claimantUserId } });
  await prisma.employerProfile.delete({ where: { id: employerProfileId } });
  await prisma.user.delete({ where: { id: employerUserId } });
  await prisma.user.delete({ where: { id: caseworkerUserId } });
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run the full E2E suite**

Windows/OneDrive note: run `rm -rf .next` first if a stale build-symlink error appears. Also clear any leftover dev server on port 3000 first (`netstat -ano | grep ":3000" | grep LISTENING`, then `taskkill //F //PID <pid> //T`) so Playwright's own `webServer` isn't blocked.

Run: `npx playwright test`
Expected: all tests pass, including the new `employment-expiration.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/employment-expiration.spec.ts
git commit -m "test: end-to-end coverage for the employment expiration check"
```
