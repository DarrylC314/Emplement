# Unmatched Employer Events (Staff Resolution Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a queue to resolve employer-reported hire/separation events that never automatically matched a claimant — retry the event's original SSN hash, manually match with a corrected SSN, or dismiss with a note.

**Architecture:** Additive to the existing Next.js 14 App Router / Prisma / PostgreSQL codebase. `EmploymentEvent` gains `dismissedAt`/`dismissedByUserId`. A new staff-only page (`/staff/unmatched-events`) lists events with no match and no dismissal, offering three per-event actions backed by three new routes. The existing staff claimant search is extended (not duplicated) to surface `prefix`/`suffix`/`gender`/`dateOfBirth`, the disambiguation data staff use before attempting a match. Justification notes for match/dismiss live only in `AuditLog.metadata`, never a persisted column — mirroring the existing reveal-SSN route exactly.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, PostgreSQL via Prisma, NextAuth.js, Zod, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- Follow every existing convention exactly: `requireRole(['CASEWORKER','ADMIN'])` at the top of every new route; actor identity always derived from `session.user.id`, never client input.
- Every status-affecting write logs an `AuditLog` row via `writeAuditLog`.
- API routes use `apiError`/`invalidBody`/`parseJson` from `src/lib/apiRequest.ts`.
- Prisma `select` blocks are always explicit — never `include`.
- WCAG 2.2 AA: semantic HTML, every status/warning uses icon + text + color (never color alone), every form field has a visible label and `aria-describedby` error association.
- axe-core scans every route in `tests/e2e/accessibility.spec.ts` — new pages must pass it.
- **Design decision, carried from the spec:** justification notes for manual match and dismiss are never persisted columns on `EmploymentEvent` — they exist only in `AuditLog.metadata`, exactly mirroring `POST /api/staff/claimants/[id]/reveal-ssn/route.ts`'s `reason` field (required, 400 if missing, `metadata: { reason }`).
- **Design decision, carried from the spec:** the "retry" route re-hashes nothing — it re-checks the event's own already-stored `ssnHash` against current claimants. The "manual match" route hashes a *freshly-submitted* SSN via `hashSSN` and never touches the event's original `ssnHash` column. These are deliberately different data sources; do not conflate them.
- **Design decision, carried from the spec:** telling staff "no claimant found with that SSN" (404) on the manual-match route is correct and intentional — unlike the employer-facing `POST /api/employer/events` route (which never reveals match status, to prevent an employer probing for whether an SSN belongs to a claimant), staff already have full context and audit-logged access to claimant data at the same trust level as the reveal-SSN feature. Do not flag the 404 body/status as a privacy leak.

---

## Task 1: Schema — `EmploymentEvent` dismissal fields

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: `EmploymentEvent.dismissedAt: DateTime?`, `EmploymentEvent.dismissedByUserId: String?`, `EmploymentEvent.dismissedBy: User?` relation; `User.dismissedEmploymentEvents: EmploymentEvent[]` back-relation.

- [ ] **Step 1: Add the dismissal fields to `EmploymentEvent`**

In `prisma/schema.prisma`, in the `EmploymentEvent` model, add three fields immediately after `createdAt DateTime @default(now())`:

```prisma
  dismissedAt       DateTime?
  dismissedByUserId String?
  dismissedBy       User?     @relation(fields: [dismissedByUserId], references: [id])
```

- [ ] **Step 2: Add the required back-relation on `User`**

In the `User` model, add a field after `uploadedDocuments Document[] @relation("DocumentUploader")`:

```prisma
  dismissedEmploymentEvents EmploymentEvent[]
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_employment_event_dismissal`
Expected: Completes with no errors; a new migration directory appears under `prisma/migrations/`; Prisma Client regenerates. Open the generated `migration.sql` yourself and confirm it contains two `ALTER TABLE "EmploymentEvent" ADD COLUMN` statements (`dismissedAt`, `dismissedByUserId`) and an `ADD CONSTRAINT ... FOREIGN KEY` referencing `User`. If either is missing, do not proceed — regenerate against a clean state before continuing.

- [ ] **Step 4: Write a failing schema smoke test**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block:

```ts
  it('can create and read back an EmploymentEvent with dismissal fields', async () => {
    const employerUser = await prisma.user.create({
      data: { email: `schema-test-employer-dismiss-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const staffUser = await prisma.user.create({
      data: { email: `schema-test-staff-dismiss-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CASEWORKER' },
    });

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfile.id,
        type: 'HIRE',
        employeeName: 'Test Employee',
        ssnHash: `test-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    expect(event.dismissedAt).toBeNull();
    expect(event.dismissedByUserId).toBeNull();

    const dismissed = await prisma.employmentEvent.update({
      where: { id: event.id },
      data: { dismissedAt: new Date(), dismissedByUserId: staffUser.id },
    });
    expect(dismissed.dismissedAt).not.toBeNull();
    expect(dismissed.dismissedByUserId).toBe(staffUser.id);

    await prisma.employmentEvent.delete({ where: { id: event.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
    await prisma.user.delete({ where: { id: staffUser.id } });
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/schema.test.ts
git commit -m "Add dismissal fields to EmploymentEvent"
```

---

## Task 2: Extend staff claimant search with identity fields

**Files:**
- Modify: `src/app/api/staff/claimants/route.ts`
- Modify: `src/app/staff/dashboard/page.tsx`
- Test: `tests/integration/staff-claimants.test.ts`

**Interfaces:**
- Consumes: `ClaimantProfile.prefix`/`suffix`/`gender`/`dateOfBirth` (already exist).
- Produces: `GET /api/staff/claimants` search results include `prefix`/`suffix`/`gender`/`dateOfBirth`; the staff dashboard's search results display them. Not consumed by any later task in this plan — this is the disambiguation tool staff use manually before returning to the unmatched-events queue.

- [ ] **Step 1: Extend the search test's fixture and add a failing assertion**

In `tests/integration/staff-claimants.test.ts`, change the `claimantProfile.create` call in `beforeAll` from:

```ts
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName, ssnEncrypted: ssnCiphertext, prefix: 'DR', suffix: 'JR', gender: 'Non-binary' },
    });
```

to:

```ts
    const profile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName,
        ssnEncrypted: ssnCiphertext,
        prefix: 'DR',
        suffix: 'JR',
        gender: 'Non-binary',
        dateOfBirth: new Date('1990-05-15'),
      },
    });
```

Then add these assertions to the existing `'returns matching claimants with nested claim certifications and case notes'` test, immediately after the existing `expect(claimant.legalName).toBe(legalName);` line:

```ts
    expect(claimant.prefix).toBe('DR');
    expect(claimant.suffix).toBe('JR');
    expect(claimant.gender).toBe('Non-binary');
    expect(claimant.dateOfBirth).toBeTruthy();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: FAIL — `claimant.prefix` is `undefined`.

- [ ] **Step 3: Extend the search route's select block**

In `src/app/api/staff/claimants/route.ts`, change:

```ts
    select: {
      id: true,
      legalName: true,
      user: { select: { email: true } },
```

to:

```ts
    select: {
      id: true,
      legalName: true,
      prefix: true,
      suffix: true,
      gender: true,
      dateOfBirth: true,
      user: { select: { email: true } },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: PASS.

- [ ] **Step 5: Display the new fields in the dashboard's search results**

In `src/app/staff/dashboard/page.tsx`, change the `ClaimantResult` type from:

```ts
type ClaimantResult = {
  id: string;
  legalName: string | null;
  user: { email: string };
};
```

to:

```ts
type ClaimantResult = {
  id: string;
  legalName: string | null;
  prefix: 'MR' | 'MRS' | 'MS' | 'DR' | 'MX' | null;
  suffix: 'JR' | 'SR' | 'II' | 'III' | 'IV' | null;
  gender: string | null;
  dateOfBirth: string | null;
  user: { email: string };
};
```

Add these two constants and one function above the component function:

```ts
const PREFIX_LABELS: Record<NonNullable<ClaimantResult['prefix']>, string> = {
  MR: 'Mr.',
  MRS: 'Mrs.',
  MS: 'Ms.',
  DR: 'Dr.',
  MX: 'Mx.',
};

const SUFFIX_LABELS: Record<NonNullable<ClaimantResult['suffix']>, string> = {
  JR: 'Jr.',
  SR: 'Sr.',
  II: 'II',
  III: 'III',
  IV: 'IV',
};

function formatClaimantName(claimant: ClaimantResult): string {
  const name = claimant.legalName ?? claimant.user.email;
  const withPrefix = claimant.prefix ? `${PREFIX_LABELS[claimant.prefix]} ${name}` : name;
  return claimant.suffix ? `${withPrefix}, ${SUFFIX_LABELS[claimant.suffix]}` : withPrefix;
}
```

Replace the results-rendering block:

```tsx
      {results.length > 0 && (
        <ul className="space-y-3">
          {results.map((claimant) => (
            <li key={claimant.id} className="border border-border rounded p-4">
              <p className="font-medium">{claimant.legalName ?? claimant.user.email}</p>
              <Link href={`/staff/claimants/${claimant.id}`} className="text-link underline">
                Review case
              </Link>
            </li>
          ))}
        </ul>
      )}
```

with:

```tsx
      {results.length > 0 && (
        <ul className="space-y-3">
          {results.map((claimant) => (
            <li key={claimant.id} className="border border-border rounded p-4">
              <p className="font-medium">{formatClaimantName(claimant)}</p>
              {(claimant.gender || claimant.dateOfBirth) && (
                <p className="text-sm text-text-secondary">
                  {claimant.gender && `Gender: ${claimant.gender}`}
                  {claimant.gender && claimant.dateOfBirth && ' — '}
                  {claimant.dateOfBirth && `DOB: ${new Date(claimant.dateOfBirth).toLocaleDateString()}`}
                </p>
              )}
              <Link href={`/staff/claimants/${claimant.id}`} className="text-link underline">
                Review case
              </Link>
            </li>
          ))}
        </ul>
      )}
```

- [ ] **Step 6: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/staff/claimants/route.ts src/app/staff/dashboard/page.tsx tests/integration/staff-claimants.test.ts
git commit -m "Show prefix, suffix, gender, and date of birth in staff claimant search results"
```

---

## Task 3: Unmatched-events queue — listing route, page, nav link

**Files:**
- Create: `src/app/api/staff/unmatched-events/route.ts`
- Create: `src/app/staff/unmatched-events/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/integration/unmatched-events.test.ts`

**Interfaces:**
- Consumes: `EmploymentEvent.dismissedAt`/`dismissedByUserId` from Task 1.
- Produces: `GET /api/staff/unmatched-events` returning `{ id, type, employeeName, eventDate, createdAt, employer: { companyName } }[]`; the `UnmatchedEvent` type shape on the page (Tasks 4-6 extend this same page's state, not this type).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unmatched-events.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listUnmatchedEvents } from '@/app/api/staff/unmatched-events/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('GET /api/staff/unmatched-events', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let unmatchedEventId: string;
  let matchedEventId: string;
  let dismissedEventId: string;

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `unmatched-events-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `unmatched-events-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;

    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Unmatched Events Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `unmatched-events-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = claimantProfile.id;

    const unmatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Still Unmatched',
        ssnHash: `unmatched-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    unmatchedEventId = unmatchedEvent.id;

    const matchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Matched',
        ssnHash: `matched-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    matchedEventId = matchedEvent.id;

    const dismissedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'SEPARATION',
        employeeName: 'Already Dismissed',
        ssnHash: `dismissed-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        dismissedAt: new Date(),
        dismissedByUserId: caseworkerUserId,
      },
    });
    dismissedEventId = dismissedEvent.id;
  });

  it('lists only events with no match and no dismissal', async () => {
    const res = await listUnmatchedEvents();
    expect(res.status).toBe(200);
    const events = await res.json();

    const ids = events.map((e: { id: string }) => e.id);
    expect(ids).toContain(unmatchedEventId);
    expect(ids).not.toContain(matchedEventId);
    expect(ids).not.toContain(dismissedEventId);

    const target = events.find((e: { id: string }) => e.id === unmatchedEventId);
    expect(target.employeeName).toBe('Still Unmatched');
    expect(target.type).toBe('HIRE');
    expect(target.employer.companyName).toBe('Unmatched Events Test Co');
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listUnmatchedEvents();
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/unmatched-events.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/staff/unmatched-events/route'`.

- [ ] **Step 3: Implement the listing route**

Create `src/app/api/staff/unmatched-events/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const events = await prisma.employmentEvent.findMany({
    where: { matchedClaimantProfileId: null, dismissedAt: null },
    orderBy: { eventDate: 'desc' },
    select: {
      id: true,
      type: true,
      employeeName: true,
      eventDate: true,
      createdAt: true,
      employer: { select: { companyName: true } },
    },
  });

  return Response.json(events);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/unmatched-events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the queue page**

Create `src/app/staff/unmatched-events/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type UnmatchedEvent = {
  id: string;
  type: 'HIRE' | 'SEPARATION';
  employeeName: string;
  eventDate: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function UnmatchedEventsPage() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<UnmatchedEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadEvents() {
    setLoadError(null);
    const res = await fetch('/api/staff/unmatched-events');
    if (!res.ok) {
      setLoadError('We could not load the unmatched events queue. Please try again.');
      return;
    }
    setEvents(await res.json());
  }

  useEffect(() => {
    if (status === 'authenticated' && (session?.user.role === 'CASEWORKER' || session?.user.role === 'ADMIN')) {
      loadEvents();
    }
  }, [status, session]);

  if (status === 'loading') {
    return (
      <main id="main-content" className="p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || (session?.user.role !== 'CASEWORKER' && session?.user.role !== 'ADMIN')) {
    return (
      <main id="main-content" className="p-8">
        <p role="alert">You do not have access to this page.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Unmatched employer events</h1>
      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}
      {events === null && !loadError && <p>Loading…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-sm text-text-secondary">No unmatched events on file.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border border-border rounded p-4">
              <p className="font-medium">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'}: {event.employeeName}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Reported by {event.employer.companyName ?? 'an employer'} — event date{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Add a nav link**

In `src/components/layout/AppNav.tsx`, change:

```ts
const STAFF_LINKS: NavLink[] = [{ href: '/staff/dashboard', label: 'Staff dashboard' }];
```

to:

```ts
const STAFF_LINKS: NavLink[] = [
  { href: '/staff/dashboard', label: 'Staff dashboard' },
  { href: '/staff/unmatched-events', label: 'Unmatched events' },
];
```

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, log in as a caseworker, open `/staff/unmatched-events` via the new nav link, and confirm the page loads and shows "No unmatched events on file." (or real events if any exist in your dev data).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/staff/unmatched-events/route.ts src/app/staff/unmatched-events/page.tsx src/components/layout/AppNav.tsx tests/integration/unmatched-events.test.ts
git commit -m "Add unmatched-events queue listing route and page"
```

---

## Task 4: Retry route

**Files:**
- Create: `src/app/api/staff/unmatched-events/[id]/retry/route.ts`
- Modify: `src/app/staff/unmatched-events/page.tsx`
- Test: `tests/integration/unmatched-events-retry.test.ts`

**Interfaces:**
- Consumes: `UnmatchedEvent` type and page structure from Task 3.
- Produces: `POST /api/staff/unmatched-events/[id]/retry`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unmatched-events-retry.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as retryMatch } from '@/app/api/staff/unmatched-events/[id]/retry/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/unmatched-events/[id]/retry', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let matchableEventId: string;
  let stillUnmatchedEventId: string;
  let alreadyMatchedEventId: string;
  const matchableSsn = '408-77-2211';

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `retry-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `retry-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Retry Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `retry-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: hashSSN(matchableSsn) },
    });
    claimantProfileId = claimantProfile.id;

    // Same ssnHash as the claimant above — models a claimant who verified
    // their identity *after* the employer reported this event.
    const matchableEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Late Verifier',
        ssnHash: hashSSN(matchableSsn),
        eventDate: new Date('2026-08-01'),
      },
    });
    matchableEventId = matchableEvent.id;

    const stillUnmatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Nobody On File',
        ssnHash: `no-match-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    stillUnmatchedEventId = stillUnmatchedEvent.id;

    const alreadyMatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Resolved',
        ssnHash: `already-matched-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    alreadyMatchedEventId = alreadyMatchedEvent.id;
  });

  it('links the event when the stored ssnHash now matches a claimant', async () => {
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${matchableEventId}/retry`, { method: 'POST' }),
      { params: { id: matchableEventId } }
    );
    expect(res.status).toBe(200);

    const event = await prisma.employmentEvent.findUnique({ where: { id: matchableEventId } });
    expect(event?.matchedClaimantProfileId).toBe(claimantProfileId);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: matchableEventId, action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as { via?: string })?.via).toBe('retry');
  });

  it('returns 404 when the stored ssnHash still matches no claimant', async () => {
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${stillUnmatchedEventId}/retry`, { method: 'POST' }),
      { params: { id: stillUnmatchedEventId } }
    );
    expect(res.status).toBe(404);

    const event = await prisma.employmentEvent.findUnique({ where: { id: stillUnmatchedEventId } });
    expect(event?.matchedClaimantProfileId).toBeNull();
  });

  it('returns 409 when the event is already matched', async () => {
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${alreadyMatchedEventId}/retry`, { method: 'POST' }),
      { params: { id: alreadyMatchedEventId } }
    );
    expect(res.status).toBe(409);
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${stillUnmatchedEventId}/retry`, { method: 'POST' }),
      { params: { id: stillUnmatchedEventId } }
    );
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/unmatched-events-retry.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/staff/unmatched-events/[id]/retry/route'`.

- [ ] **Step 3: Implement the retry route**

Create `src/app/api/staff/unmatched-events/[id]/retry/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const event = await prisma.employmentEvent.findUnique({
    where: { id: params.id },
    select: { id: true, ssnHash: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!event) {
    return apiError('Event not found', 404);
  }
  if (event.matchedClaimantProfileId || event.dismissedAt) {
    return apiError('This event has already been resolved', 409);
  }

  // Re-checks the event's own already-stored ssnHash — no new hash is
  // computed here. This is what handles "the claimant verified their
  // identity after the event was reported": the original hash was always
  // correct, it just didn't match anyone yet.
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash: event.ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    return apiError('No claimant found for this event yet', 404);
  }

  const updated = await prisma.employmentEvent.update({
    where: { id: params.id },
    data: { matchedClaimantProfileId: matchedClaimant.id },
    select: { id: true },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { via: 'retry' },
  });

  return Response.json(updated, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/unmatched-events-retry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire a Retry button into the queue page**

Replace the full contents of `src/app/staff/unmatched-events/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type UnmatchedEvent = {
  id: string;
  type: 'HIRE' | 'SEPARATION';
  employeeName: string;
  eventDate: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function UnmatchedEventsPage() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<UnmatchedEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadEvents() {
    setLoadError(null);
    const res = await fetch('/api/staff/unmatched-events');
    if (!res.ok) {
      setLoadError('We could not load the unmatched events queue. Please try again.');
      return;
    }
    setEvents(await res.json());
  }

  useEffect(() => {
    if (status === 'authenticated' && (session?.user.role === 'CASEWORKER' || session?.user.role === 'ADMIN')) {
      loadEvents();
    }
  }, [status, session]);

  async function handleRetry(id: string) {
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/retry`, { method: 'POST' });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found for this event yet.'
          : 'We could not retry this match. Please try again.'
      );
      return;
    }
    setEvents((prev) => prev?.filter((e) => e.id !== id) ?? null);
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || (session?.user.role !== 'CASEWORKER' && session?.user.role !== 'ADMIN')) {
    return (
      <main id="main-content" className="p-8">
        <p role="alert">You do not have access to this page.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Unmatched employer events</h1>
      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 text-error-text">
          {actionError}
        </p>
      )}
      {events === null && !loadError && <p>Loading…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-sm text-text-secondary">No unmatched events on file.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border border-border rounded p-4">
              <p className="font-medium">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'}: {event.employeeName}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Reported by {event.employer.companyName ?? 'an employer'} — event date{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </p>
              <Button onClick={() => handleRetry(event.id)}>Retry</Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/staff/unmatched-events/[id]/retry/route.ts src/app/staff/unmatched-events/page.tsx tests/integration/unmatched-events-retry.test.ts
git commit -m "Add retry route for re-checking an event's original ssnHash"
```

---

## Task 5: Manual match route

**Files:**
- Create: `src/app/api/staff/unmatched-events/[id]/match/route.ts`
- Modify: `src/app/staff/unmatched-events/page.tsx`
- Test: `tests/integration/unmatched-events-match.test.ts`

**Interfaces:**
- Consumes: `hashSSN` from `src/lib/ssnHash.ts`; the page structure from Task 4.
- Produces: `POST /api/staff/unmatched-events/[id]/match`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unmatched-events-match.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as manualMatch } from '@/app/api/staff/unmatched-events/[id]/match/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/unmatched-events/[id]/match', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let eventId: string;
  let secondEventId: string;
  let alreadyMatchedEventId: string;
  const correctSsn = '512-88-3344';

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `match-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `match-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Match Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `match-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: hashSSN(correctSsn) },
    });
    claimantProfileId = claimantProfile.id;

    // The event's own stored ssnHash deliberately does NOT match the
    // claimant above — it represents the employer's original, incorrect
    // submission. The manual-match route must hash the freshly-submitted
    // SSN, not compare against this stale value.
    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Typo Victim',
        ssnHash: `original-wrong-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    eventId = event.id;

    const secondEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'SEPARATION',
        employeeName: 'No Such Claimant',
        ssnHash: `unrelated-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    secondEventId = secondEvent.id;

    const alreadyMatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Resolved',
        ssnHash: `already-resolved-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    alreadyMatchedEventId = alreadyMatchedEvent.id;
  });

  it('links the event to the claimant matching the freshly-submitted SSN', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${eventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn, note: 'Employer had a typo; confirmed correct SSN with claimant by phone.' }),
    });
    const res = await manualMatch(req, { params: { id: eventId } });
    expect(res.status).toBe(200);

    const event = await prisma.employmentEvent.findUnique({ where: { id: eventId } });
    expect(event?.matchedClaimantProfileId).toBe(claimantProfileId);
    // The event's originally-stored ssnHash is left untouched — it's a
    // historical record of what the employer actually submitted.
    expect(event?.ssnHash).not.toBe(hashSSN(correctSsn));

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: eventId, action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as { via?: string; note?: string })?.via).toBe('manual');
    expect((log?.metadata as { via?: string; note?: string })?.note).toContain('typo');
  });

  it('returns 404 when no claimant matches the submitted SSN', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: '999-99-9999', note: 'Tried a guess based on the employer roster.' }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(404);
  });

  it('rejects a request missing the required note with 400', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(400);
  });

  it('returns 409 when the event is already matched', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${alreadyMatchedEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn, note: 'Retrying anyway.' }),
    });
    const res = await manualMatch(req, { params: { id: alreadyMatchedEventId } });
    expect(res.status).toBe(409);
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn, note: 'Should be rejected.' }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/unmatched-events-match.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/staff/unmatched-events/[id]/match/route'`.

- [ ] **Step 3: Implement the manual match route**

Create `src/app/api/staff/unmatched-events/[id]/match/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ ssn?: string; note?: string }>(req);
  if (!body) return invalidBody();

  const { ssn, note } = body;
  if (!ssn) {
    return apiError('ssn is required', 400);
  }
  if (!note) {
    return apiError('note is required', 400);
  }

  const event = await prisma.employmentEvent.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!event) {
    return apiError('Event not found', 404);
  }
  if (event.matchedClaimantProfileId || event.dismissedAt) {
    return apiError('This event has already been resolved', 409);
  }

  // Hashes the freshly-submitted SSN — never the event's own stored
  // ssnHash. This is what handles "the employer had the wrong SSN on
  // file": the event's original hash will never match anyone no matter
  // how many times it's retried, so staff supply a corrected one here.
  const ssnHash = hashSSN(ssn);
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    return apiError('No claimant found with that SSN', 404);
  }

  const updated = await prisma.employmentEvent.update({
    where: { id: params.id },
    data: { matchedClaimantProfileId: matchedClaimant.id },
    select: { id: true },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { via: 'manual', note },
  });

  return Response.json(updated, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/unmatched-events-match.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire a manual-match form into the queue page**

Replace the full contents of `src/app/staff/unmatched-events/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type UnmatchedEvent = {
  id: string;
  type: 'HIRE' | 'SEPARATION';
  employeeName: string;
  eventDate: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function UnmatchedEventsPage() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<UnmatchedEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [ssn, setSsn] = useState('');
  const [matchNote, setMatchNote] = useState('');

  async function loadEvents() {
    setLoadError(null);
    const res = await fetch('/api/staff/unmatched-events');
    if (!res.ok) {
      setLoadError('We could not load the unmatched events queue. Please try again.');
      return;
    }
    setEvents(await res.json());
  }

  useEffect(() => {
    if (status === 'authenticated' && (session?.user.role === 'CASEWORKER' || session?.user.role === 'ADMIN')) {
      loadEvents();
    }
  }, [status, session]);

  function resolveEvent(id: string) {
    setEvents((prev) => prev?.filter((e) => e.id !== id) ?? null);
    setMatchingId(null);
    setSsn('');
    setMatchNote('');
  }

  async function handleRetry(id: string) {
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/retry`, { method: 'POST' });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found for this event yet.'
          : 'We could not retry this match. Please try again.'
      );
      return;
    }
    resolveEvent(id);
  }

  async function handleMatch(id: string, e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn, note: matchNote }),
    });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found with that SSN.'
          : 'We could not record this match. Please try again.'
      );
      return;
    }
    resolveEvent(id);
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || (session?.user.role !== 'CASEWORKER' && session?.user.role !== 'ADMIN')) {
    return (
      <main id="main-content" className="p-8">
        <p role="alert">You do not have access to this page.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Unmatched employer events</h1>
      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 text-error-text">
          {actionError}
        </p>
      )}
      {events === null && !loadError && <p>Loading…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-sm text-text-secondary">No unmatched events on file.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border border-border rounded p-4">
              <p className="font-medium">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'}: {event.employeeName}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Reported by {event.employer.companyName ?? 'an employer'} — event date{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </p>

              {matchingId === event.id ? (
                <form onSubmit={(e) => handleMatch(event.id, e)} className="mb-2">
                  <TextField
                    id={`match-ssn-${event.id}`}
                    label="Social Security number (123-45-6789)"
                    value={ssn}
                    onChange={setSsn}
                    required
                  />
                  <TextField
                    id={`match-note-${event.id}`}
                    label="Match notes (audit-logged)"
                    value={matchNote}
                    onChange={setMatchNote}
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="submit">Confirm match</Button>
                    <Button type="button" variant="secondary" onClick={() => setMatchingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex gap-3">
                  <Button onClick={() => handleRetry(event.id)}>Retry</Button>
                  <Button variant="secondary" onClick={() => setMatchingId(event.id)}>
                    Manual match
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/staff/unmatched-events/[id]/match/route.ts src/app/staff/unmatched-events/page.tsx tests/integration/unmatched-events-match.test.ts
git commit -m "Add manual-match route for a corrected SSN"
```

---

## Task 6: Dismiss route

**Files:**
- Create: `src/app/api/staff/unmatched-events/[id]/dismiss/route.ts`
- Modify: `src/app/staff/unmatched-events/page.tsx`
- Test: `tests/integration/unmatched-events-dismiss.test.ts`

**Interfaces:**
- Consumes: the page structure from Task 5.
- Produces: `POST /api/staff/unmatched-events/[id]/dismiss`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unmatched-events-dismiss.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as dismissEvent } from '@/app/api/staff/unmatched-events/[id]/dismiss/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/unmatched-events/[id]/dismiss', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let eventId: string;
  let secondEventId: string;
  let alreadyDismissedEventId: string;

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `dismiss-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `dismiss-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Dismiss Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `dismiss-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = claimantProfile.id;

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Never Will Match',
        ssnHash: `dismiss-target-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    eventId = event.id;

    const secondEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'SEPARATION',
        employeeName: 'No Note Provided',
        ssnHash: `no-note-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    secondEventId = secondEvent.id;

    const alreadyDismissedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Dismissed',
        ssnHash: `already-dismissed-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        dismissedAt: new Date(),
        dismissedByUserId: caseworkerUserId,
      },
    });
    alreadyDismissedEventId = alreadyDismissedEvent.id;
  });

  it('dismisses the event, attributing it to the acting caseworker', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${eventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Confirmed with the employer this employee never actually filed a claim.' }),
    });
    const res = await dismissEvent(req, { params: { id: eventId } });
    expect(res.status).toBe(200);

    const event = await prisma.employmentEvent.findUnique({ where: { id: eventId } });
    expect(event?.dismissedAt).not.toBeNull();
    expect(event?.dismissedByUserId).toBe(caseworkerUserId);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: eventId, action: 'EMPLOYMENT_EVENT_DISMISSED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as { note?: string })?.note).toContain('never actually filed');
  });

  it('rejects a request missing the required note with 400', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await dismissEvent(req, { params: { id: secondEventId } });
    expect(res.status).toBe(400);

    const event = await prisma.employmentEvent.findUnique({ where: { id: secondEventId } });
    expect(event?.dismissedAt).toBeNull();
  });

  it('returns 409 when the event is already dismissed', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${alreadyDismissedEventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Dismissing again.' }),
    });
    const res = await dismissEvent(req, { params: { id: alreadyDismissedEventId } });
    expect(res.status).toBe(409);
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Should be rejected.' }),
    });
    const res = await dismissEvent(req, { params: { id: secondEventId } });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/unmatched-events-dismiss.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/staff/unmatched-events/[id]/dismiss/route'`.

- [ ] **Step 3: Implement the dismiss route**

Create `src/app/api/staff/unmatched-events/[id]/dismiss/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ note?: string }>(req);
  if (!body) return invalidBody();

  const { note } = body;
  if (!note) {
    return apiError('note is required', 400);
  }

  const event = await prisma.employmentEvent.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!event) {
    return apiError('Event not found', 404);
  }
  if (event.matchedClaimantProfileId || event.dismissedAt) {
    return apiError('This event has already been resolved', 409);
  }

  const updated = await prisma.employmentEvent.update({
    where: { id: params.id },
    data: { dismissedAt: new Date(), dismissedByUserId: session!.user.id },
    select: { id: true },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_DISMISSED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { note },
  });

  return Response.json(updated, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/unmatched-events-dismiss.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire a dismiss form into the queue page**

Replace the full contents of `src/app/staff/unmatched-events/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type UnmatchedEvent = {
  id: string;
  type: 'HIRE' | 'SEPARATION';
  employeeName: string;
  eventDate: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function UnmatchedEventsPage() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<UnmatchedEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [ssn, setSsn] = useState('');
  const [matchNote, setMatchNote] = useState('');
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState('');

  async function loadEvents() {
    setLoadError(null);
    const res = await fetch('/api/staff/unmatched-events');
    if (!res.ok) {
      setLoadError('We could not load the unmatched events queue. Please try again.');
      return;
    }
    setEvents(await res.json());
  }

  useEffect(() => {
    if (status === 'authenticated' && (session?.user.role === 'CASEWORKER' || session?.user.role === 'ADMIN')) {
      loadEvents();
    }
  }, [status, session]);

  function resolveEvent(id: string) {
    setEvents((prev) => prev?.filter((e) => e.id !== id) ?? null);
    setMatchingId(null);
    setSsn('');
    setMatchNote('');
    setDismissingId(null);
    setDismissNote('');
  }

  async function handleRetry(id: string) {
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/retry`, { method: 'POST' });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found for this event yet.'
          : 'We could not retry this match. Please try again.'
      );
      return;
    }
    resolveEvent(id);
  }

  async function handleMatch(id: string, e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn, note: matchNote }),
    });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found with that SSN.'
          : 'We could not record this match. Please try again.'
      );
      return;
    }
    resolveEvent(id);
  }

  async function handleDismiss(id: string, e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: dismissNote }),
    });
    if (!res.ok) {
      setActionError('We could not dismiss this event. Please try again.');
      return;
    }
    resolveEvent(id);
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || (session?.user.role !== 'CASEWORKER' && session?.user.role !== 'ADMIN')) {
    return (
      <main id="main-content" className="p-8">
        <p role="alert">You do not have access to this page.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Unmatched employer events</h1>
      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 text-error-text">
          {actionError}
        </p>
      )}
      {events === null && !loadError && <p>Loading…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-sm text-text-secondary">No unmatched events on file.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border border-border rounded p-4">
              <p className="font-medium">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'}: {event.employeeName}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Reported by {event.employer.companyName ?? 'an employer'} — event date{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </p>

              {matchingId === event.id && (
                <form onSubmit={(e) => handleMatch(event.id, e)} className="mb-2">
                  <TextField
                    id={`match-ssn-${event.id}`}
                    label="Social Security number (123-45-6789)"
                    value={ssn}
                    onChange={setSsn}
                    required
                  />
                  <TextField
                    id={`match-note-${event.id}`}
                    label="Match notes (audit-logged)"
                    value={matchNote}
                    onChange={setMatchNote}
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="submit">Confirm match</Button>
                    <Button type="button" variant="secondary" onClick={() => setMatchingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {dismissingId === event.id && (
                <form onSubmit={(e) => handleDismiss(event.id, e)} className="mb-2">
                  <TextField
                    id={`dismiss-note-${event.id}`}
                    label="Reason for dismissal (audit-logged)"
                    value={dismissNote}
                    onChange={setDismissNote}
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="submit">Confirm dismissal</Button>
                    <Button type="button" variant="secondary" onClick={() => setDismissingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {matchingId !== event.id && dismissingId !== event.id && (
                <div className="flex gap-3">
                  <Button onClick={() => handleRetry(event.id)}>Retry</Button>
                  <Button variant="secondary" onClick={() => setMatchingId(event.id)}>
                    Manual match
                  </Button>
                  <Button variant="secondary" onClick={() => setDismissingId(event.id)}>
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/staff/unmatched-events/[id]/dismiss/route.ts src/app/staff/unmatched-events/page.tsx tests/integration/unmatched-events-dismiss.test.ts
git commit -m "Add dismiss route for events that will never match a claimant"
```

---

## Task 7: E2E test and accessibility scan

**Files:**
- Create: `tests/e2e/unmatched-events-flow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1-6.

- [ ] **Step 1: Write the E2E flow test**

Create `tests/e2e/unmatched-events-flow.spec.ts`:

```ts
// tests/e2e/unmatched-events-flow.spec.ts
import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma';
import { hashSSN } from '../../src/lib/ssnHash';
import { waitForHydration } from './helpers';

const caseworkerEmail = `e2e-unmatched-caseworker-${Date.now()}@example.com`;
const caseworkerPassword = 'E2EUnmatchedPass123';
const employerFein = '85-9876543';
const matchSsn = '250-61-9087';

let employerUserId: string;
let employerProfileId: string;
let claimantUserId: string;
let claimantProfileId: string;
let caseworkerUserId: string;
let eventId: string;

test.beforeAll(async () => {
  const caseworkerUser = await prisma.user.create({
    data: {
      email: caseworkerEmail,
      passwordHash: await bcrypt.hash(caseworkerPassword, 10),
      role: 'CASEWORKER',
    },
  });
  caseworkerUserId = caseworkerUser.id;

  const employerUser = await prisma.user.create({
    data: {
      email: `e2e-unmatched-employer-fixture-${Date.now()}@example.com`,
      passwordHash: 'x',
      role: 'EMPLOYER',
    },
  });
  employerUserId = employerUser.id;
  const employerProfile = await prisma.employerProfile.create({
    data: { userId: employerUser.id, fein: employerFein, companyName: 'Unmatched Flow Test Co', verificationStatus: 'VERIFIED' },
  });
  employerProfileId = employerProfile.id;

  const claimantUser = await prisma.user.create({
    data: { email: `e2e-unmatched-claimant-fixture-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
  });
  claimantUserId = claimantUser.id;
  const claimantProfile = await prisma.claimantProfile.create({
    data: { userId: claimantUser.id, legalName: 'Unmatched Flow Fixture Claimant', ssnHash: hashSSN(matchSsn) },
  });
  claimantProfileId = claimantProfile.id;

  // Reported with a wrong ssnHash, deliberately not matching the claimant
  // above — this E2E test proves the manual-match path (a corrected SSN),
  // not the automatic one.
  const event = await prisma.employmentEvent.create({
    data: {
      employerId: employerProfileId,
      type: 'HIRE',
      employeeName: 'Unmatched Flow Fixture Claimant',
      ssnHash: `e2e-original-wrong-hash-${Date.now()}`,
      eventDate: new Date('2026-08-01'),
    },
  });
  eventId = event.id;
});

test('caseworker can see an unmatched event, manually match it, and see it on the claimant case page', async ({
  page,
}) => {
  await page.goto('/staff/login');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill(caseworkerEmail);
  await page.getByLabel('Password').fill(caseworkerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/staff\/dashboard/);

  await page.goto('/staff/unmatched-events');
  await waitForHydration(page);
  await expect(page.getByText('Unmatched Flow Fixture Claimant').first()).toBeVisible();

  await page.getByRole('button', { name: 'Manual match' }).click();
  await page.getByLabel(/Social Security number/i).fill(matchSsn);
  await page.getByLabel(/Match notes/i).fill('Verified with the claimant directly by phone.');
  await page.getByRole('button', { name: 'Confirm match' }).click();

  await expect(page.getByText('No unmatched events on file.')).toBeVisible();

  const updatedEvent = await prisma.employmentEvent.findUnique({ where: { id: eventId } });
  expect(updatedEvent?.matchedClaimantProfileId).toBe(claimantProfileId);

  await page.goto(`/staff/claimants/${claimantProfileId}`);
  await waitForHydration(page);
  await expect(page.getByText(/Hired by Unmatched Flow Test Co/i)).toBeVisible();
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [caseworkerUserId, employerUserId] } },
  });
  await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
  await prisma.employerProfile.delete({ where: { id: employerProfileId } });
  await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
  await prisma.user.delete({ where: { id: claimantUserId } });
  await prisma.user.delete({ where: { id: employerUserId } });
  await prisma.user.delete({ where: { id: caseworkerUserId } });
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run the E2E test to verify it passes in isolation**

Run: `rm -rf .next && npx playwright test unmatched-events-flow.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Add an accessibility scan for the new page**

In `tests/e2e/accessibility.spec.ts`, inside the existing `test.describe('staff pages', ...)` block, add this test immediately after the existing `'the certification review page has no automatically detectable accessibility violations'` test, before the block's closing `});`:

```ts
  test('/staff/unmatched-events has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/staff/unmatched-events');
    await expect(page.getByRole('heading', { name: /unmatched employer events/i })).toBeVisible();
    await expectNoViolations(page);
  });
```

- [ ] **Step 4: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`
Expected: All tests pass, including the new unmatched-events flow and accessibility scan.

- [ ] **Step 5: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/unmatched-events-flow.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "Add E2E test and accessibility scan for the unmatched-events queue"
```

---
