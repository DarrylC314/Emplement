# Certification Job-Search Prefill from Marketplace Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the weekly certification form, prefill read-only job-search-activity rows from the claimant's marketplace applications submitted during that certification week, reviewed and submitted like any other row, never retyped.

**Architecture:** Purely additive to the existing `/claim/certify` page. A new pure function does the date-window filtering (unit-testable in isolation); the page calls it against the already-existing `GET /api/job-applications` route on the week-ending date field's blur, with no new API routes, no schema changes, and no change to `evaluateCertification` or `POST /api/certifications`.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- No new API routes, no Prisma schema/migration changes.
- `evaluateCertification` and `POST /api/certifications` are untouched — both prefilled and manually-typed rows serialize into the identical `jobSearchActivities` array shape the backend already expects; the client-only `source` field must never appear in the POST request body.
- Prefilled rows are read-only display, never editable `TextField`s.
- The prefill fetch runs on the week-ending date field's blur (not on page load, not via a separate button) — the date is a field the claimant fills in themselves, so nothing can prefill before it's entered.
- Changing the week-ending date replaces the current set of prefilled rows with a fresh fetch for the new week; rows the claimant typed manually are left untouched.
- Every job-search-activity row — prefilled or manual — gets a new "Remove" button, since this form has no removal capability today and prefill makes one necessary.
- If the prefill fetch fails, the form degrades to today's exact behavior (no prefill, no error banner) — a claimant must always be able to certify by typing manually.

---

## Task 1: `filterApplicationsInWeek` pure function and unit tests

**Files:**
- Create: `src/lib/certificationPrefill.ts`
- Test: `tests/unit/certificationPrefill.test.ts`

**Interfaces:**
- Produces: `type MarketplaceApplication = { id: string; createdAt: string; jobPosting: { title: string; employer: { companyName: string | null } } }`; `filterApplicationsInWeek(applications: MarketplaceApplication[], weekEndingDate: string): MarketplaceApplication[]` — returns the applications whose `createdAt` falls within the 7-day window `[weekEndingDate - 6 days 00:00:00, weekEndingDate 23:59:59.999]` (both ends inclusive), in their original order. Returns `[]` if `weekEndingDate` doesn't parse as a valid date. Consumed by Task 2.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/certificationPrefill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterApplicationsInWeek } from '@/lib/certificationPrefill';

describe('filterApplicationsInWeek', () => {
  const posting = { title: 'Test Job', employer: { companyName: 'Test Co' } };

  it('includes an application created exactly on the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-15T10:00:00Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('includes an application created exactly 6 days before the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-09T00:00:00Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('excludes an application created 7 days before the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-08T23:00:00Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result).toEqual([]);
  });

  it('excludes an application created after the week-ending date', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-16T00:00:01Z', jobPosting: posting }],
      '2026-08-15'
    );
    expect(result).toEqual([]);
  });

  it('returns an empty array for an empty applications list', () => {
    expect(filterApplicationsInWeek([], '2026-08-15')).toEqual([]);
  });

  it('handles multiple applications from different postings, preserving order and excluding out-of-window ones', () => {
    const result = filterApplicationsInWeek(
      [
        { id: 'a', createdAt: '2026-08-12T00:00:00Z', jobPosting: { title: 'Job A', employer: { companyName: 'Co A' } } },
        { id: 'b', createdAt: '2026-08-13T00:00:00Z', jobPosting: { title: 'Job B', employer: { companyName: null } } },
        { id: 'c', createdAt: '2026-07-01T00:00:00Z', jobPosting: { title: 'Job C', employer: { companyName: 'Co C' } } },
      ],
      '2026-08-15'
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array for an invalid weekEndingDate', () => {
    const result = filterApplicationsInWeek(
      [{ id: 'a', createdAt: '2026-08-15T10:00:00Z', jobPosting: posting }],
      'not-a-date'
    );
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/certificationPrefill.test.ts`
Expected: FAIL — `Cannot find module '@/lib/certificationPrefill'`.

- [ ] **Step 3: Implement the function**

Create `src/lib/certificationPrefill.ts`:

```ts
export type MarketplaceApplication = {
  id: string;
  createdAt: string;
  jobPosting: {
    title: string;
    employer: { companyName: string | null };
  };
};

export function filterApplicationsInWeek(
  applications: MarketplaceApplication[],
  weekEndingDate: string
): MarketplaceApplication[] {
  const end = new Date(weekEndingDate);
  if (isNaN(end.getTime())) return [];
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  return applications.filter((a) => {
    const created = new Date(a.createdAt);
    return created >= start && created <= end;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/certificationPrefill.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/certificationPrefill.ts tests/unit/certificationPrefill.test.ts
git commit -m "Add filterApplicationsInWeek for certification job-search prefill"
```

---

## Task 2: Wire prefill, remove, and row-source tracking into the certify page

**Files:**
- Modify: `src/components/ui/TextField.tsx`
- Modify: `src/app/claim/certify/page.tsx`

**Interfaces:**
- Consumes: `filterApplicationsInWeek`, `MarketplaceApplication` from Task 1; `GET /api/job-applications` (already exists, unmodified).
- Produces: `TextField` gains an optional `onBlur?: () => void` prop (backward compatible — every existing call site omits it and is unaffected). Consumed by Task 3's E2E test via the rendered page.

- [ ] **Step 1: Add an optional `onBlur` prop to `TextField`**

`TextField` has no way to run code when a field loses focus, which the week-ending date field needs for the prefill trigger. In `src/components/ui/TextField.tsx`, change:

```tsx
type TextFieldProps = {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  autoComplete?: string;
};

export function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  error,
  required,
  autoComplete,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block font-medium text-text-primary mb-1">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded border px-3 py-2 text-text-primary ${
          error ? 'border-error-border' : 'border-border'
        }`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

to:

```tsx
type TextFieldProps = {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  required?: boolean;
  autoComplete?: string;
};

export function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  error,
  required,
  autoComplete,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block font-medium text-text-primary mb-1">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded border px-3 py-2 text-text-primary ${
          error ? 'border-error-border' : 'border-border'
        }`}
      />
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the certify page**

Replace the full contents of `src/app/claim/certify/page.tsx` with:

```tsx
'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Fieldset } from '@/components/ui/Fieldset';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { filterApplicationsInWeek, type MarketplaceApplication } from '@/lib/certificationPrefill';

type JobSearchEntry = {
  employerName: string;
  contactMethod: string;
  contactDate: string;
  position: string;
  source: 'marketplace' | 'manual';
};

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export default function CertifyPage() {
  return (
    <Suspense fallback={null}>
      <CertifyForm />
    </Suspense>
  );
}

function CertifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const claimId = params.get('claimId') ?? '';

  const [weekEndingDate, setWeekEndingDate] = useState('');
  const [ableAndAvailable, setAbleAndAvailable] = useState('yes');
  const [workedThisWeek, setWorkedThisWeek] = useState('no');
  const [earnings, setEarnings] = useState('0');
  const [refusedWork, setRefusedWork] = useState('no');
  const [activities, setActivities] = useState<JobSearchEntry[]>([
    { employerName: '', contactMethod: '', contactDate: '', position: '', source: 'manual' },
  ]);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  function updateActivity(index: number, field: keyof JobSearchEntry, value: string) {
    const next = [...activities];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, [field]: value };
    setActivities(next);
  }

  function addActivity() {
    setActivities([
      ...activities,
      { employerName: '', contactMethod: '', contactDate: '', position: '', source: 'manual' },
    ]);
  }

  function removeActivity(index: number) {
    setActivities(activities.filter((_, i) => i !== index));
  }

  async function handleWeekEndingDateBlur() {
    if (!weekEndingDate || isNaN(Date.parse(weekEndingDate))) return;
    const res = await fetch('/api/job-applications');
    if (!res.ok) return;
    const applications: MarketplaceApplication[] = await res.json();
    const matches = filterApplicationsInWeek(applications, weekEndingDate);
    const prefilled: JobSearchEntry[] = matches.map((a) => ({
      employerName: a.jobPosting.employer.companyName ?? 'An employer',
      contactMethod: 'Applied through Emplement marketplace',
      contactDate: a.createdAt.slice(0, 10),
      position: a.jobPosting.title,
      source: 'marketplace',
    }));
    setActivities([...prefilled, ...activities.filter((a) => a.source === 'manual')]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const res = await fetch('/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        weekEndingDate,
        ableAndAvailable: ableAndAvailable === 'yes',
        workedThisWeek: workedThisWeek === 'yes',
        earnings: Number(earnings),
        refusedWork: refusedWork === 'yes',
        jobSearchActivities: activities.map(({ employerName, contactMethod, contactDate, position }) => ({
          employerName,
          contactMethod,
          contactDate,
          position,
        })),
      }),
    });
    if (res.ok) {
      router.push('/claim/dashboard');
      return;
    }
    setErrors([{ id: 'weekEndingDate', message: 'Please check your entries and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Weekly certification</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="weekEndingDate"
          label="Week ending date"
          type="date"
          value={weekEndingDate}
          onChange={setWeekEndingDate}
          onBlur={handleWeekEndingDateBlur}
          required
        />
        <Fieldset legend="Were you able and available to work this week?" name="ableAndAvailable" options={YES_NO} value={ableAndAvailable} onChange={setAbleAndAvailable} />
        <Fieldset legend="Did you work this week?" name="workedThisWeek" options={YES_NO} value={workedThisWeek} onChange={setWorkedThisWeek} />
        <TextField id="earnings" label="Total earnings this week ($)" type="number" value={earnings} onChange={setEarnings} />
        <Fieldset legend="Did you refuse any offer of work this week?" name="refusedWork" options={YES_NO} value={refusedWork} onChange={setRefusedWork} />

        <fieldset className="mb-4">
          <legend className="font-medium mb-2">Job search activities (minimum 3 required)</legend>
          {activities.map((a, i) => (
            // Nested fieldset per entry, not just a styled <div>: with two or
            // more activities, every entry's fields share the exact same
            // labels ("Employer name", "Contact method", ...). A sighted user
            // tells them apart visually by position; a screen-reader user
            // navigating by field name hears "Employer name" repeated with no
            // way to know which entry they're in. A legend here gives that
            // context back — most screen readers announce the nearest
            // enclosing legend alongside the field's own label — the same
            // technique already used for the Yes/No question groups above.
            <fieldset key={i} className="border border-border rounded p-4 mb-3">
              <legend className="sr-only">Job search activity {i + 1}</legend>
              {a.source === 'marketplace' ? (
                <div className="mb-3 text-sm">
                  <p>
                    <span className="font-medium">Employer:</span> {a.employerName}
                  </p>
                  <p>
                    <span className="font-medium">Contact method:</span> {a.contactMethod}
                  </p>
                  <p>
                    <span className="font-medium">Contact date:</span> {a.contactDate}
                  </p>
                  <p>
                    <span className="font-medium">Position:</span> {a.position}
                  </p>
                  <p role="status" className="text-status-active-text font-medium mt-1">
                    Prefilled from your marketplace application
                  </p>
                </div>
              ) : (
                <>
                  <TextField id={`employer-${i}`} label="Employer name" value={a.employerName} onChange={(v) => updateActivity(i, 'employerName', v)} required />
                  <TextField id={`method-${i}`} label="Contact method" value={a.contactMethod} onChange={(v) => updateActivity(i, 'contactMethod', v)} required />
                  <TextField id={`date-${i}`} label="Contact date" type="date" value={a.contactDate} onChange={(v) => updateActivity(i, 'contactDate', v)} required />
                  <TextField id={`position-${i}`} label="Position applied for" value={a.position} onChange={(v) => updateActivity(i, 'position', v)} required />
                </>
              )}
              <Button type="button" variant="secondary" onClick={() => removeActivity(i)}>
                Remove
              </Button>
            </fieldset>
          ))}
          <Button type="button" variant="secondary" onClick={addActivity}>
            Add another job search activity
          </Button>
        </fieldset>

        <Button type="submit">Submit certification</Button>
      </form>
    </main>
  );
}
```

Note what changed from the current page: `JobSearchEntry` gained `source`; the initial row and `addActivity` both set `source: 'manual'`; a new `removeActivity` function and "Remove" button on every row; `handleWeekEndingDateBlur` wired to the week-ending date field's new `onBlur`; marketplace-sourced rows render as read-only text instead of `TextField`s; `handleSubmit`'s request body strips `source` via destructuring before building `jobSearchActivities`, so it never reaches `POST /api/certifications`.

- [ ] **Step 3: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS. (No new automated test in this task — Task 3's E2E test is what exercises this page's rendering and interactions; `TextField`'s existing usages across the app are unaffected by the new optional `onBlur` prop, since none of them pass it.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/TextField.tsx src/app/claim/certify/page.tsx
git commit -m "Wire marketplace-application prefill and row removal into the certify form"
```

---

## Task 3: E2E coverage

**Files:**
- Modify: `tests/e2e/employer-marketplace-flow.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1-2, plus the existing marketplace flow this file already exercises.

- [ ] **Step 1: Extend the flow to certify a week using prefilled marketplace applications**

By the point this plan's addition begins, the existing test has already created two `JobApplication`s for `claimantEmail` during this same test run: one for "Warehouse associate" (now `HIRED`) and one for "Second warehouse role" (now has a `CONFIRMED` interview) — both created moments ago, so today's date as the week-ending date pulls both into the certification's prefill.

In `tests/e2e/employer-marketplace-flow.spec.ts`, change the end of the test from:

```ts
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByRole('link', { name: 'View applications' }).first().click();
  await waitForHydration(page);
  await expect(page.getByText(/✓ Interview confirmed/)).toBeVisible();

  await claimantPage.close();
});
```

to:

```ts
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByRole('link', { name: 'View applications' }).first().click();
  await waitForHydration(page);
  await expect(page.getByText(/✓ Interview confirmed/)).toBeVisible();

  // Certify a week using both marketplace applications built above as
  // prefilled job-search contacts, plus one manually-typed entry to reach
  // the 3-contact minimum.
  const today = new Date().toISOString().slice(0, 10);
  await claimantPage.goto(`/claim/certify?claimId=${claimId}`);
  await waitForHydration(claimantPage);
  await claimantPage.getByLabel('Week ending date').fill(today);
  await claimantPage.getByLabel('Week ending date').blur();

  await expect(claimantPage.getByText('Prefilled from your marketplace application').first()).toBeVisible();
  await expect(claimantPage.getByText('Warehouse associate')).toBeVisible();
  await expect(claimantPage.getByText('Second warehouse role')).toBeVisible();

  // The form started with one empty manual row; prefill leaves manual rows
  // untouched, so it's still present as the third row, ready to fill in —
  // no need to click "Add another job search activity".
  await claimantPage.locator('#employer-2').fill('Acme Corp');
  await claimantPage.locator('#method-2').fill('Online application');
  await claimantPage.locator('#date-2').fill(today);
  await claimantPage.locator('#position-2').fill('Machinist');

  const certifyResults = await new AxeBuilder({ page: claimantPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(certifyResults.violations).toEqual([]);

  await claimantPage.getByRole('button', { name: 'Submit certification' }).click();
  await expect(claimantPage).toHaveURL(/\/claim\/dashboard/);

  const certification = await prisma.weeklyCertification.findFirst({
    where: { claimId },
    orderBy: { submittedAt: 'desc' },
  });
  expect(certification?.autoDecision).toBe('APPROVED');

  await claimantPage.close();
});
```

- [ ] **Step 2: Extend teardown to clean up the new certification data**

Neither `WeeklyCertification` nor `JobSearchActivity` has an `onDelete: Cascade` in `prisma/schema.prisma` (confirmed by reading both model definitions directly), so the existing `claim.deleteMany({ where: { claimantId: profileId } })` in `afterAll` would fail with a foreign-key constraint error once this test's certification exists — `JobSearchActivity` references `WeeklyCertification`, which references `Claim`, and both must be cleared first, in that order.

In `tests/e2e/employer-marketplace-flow.spec.ts`'s `afterAll`, change:

```ts
  if (claimantUser?.claimantProfile) {
    const profileId = claimantUser.claimantProfile.id;
    await prisma.message.deleteMany({ where: { claimantId: profileId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: profileId } });
    await prisma.claim.deleteMany({ where: { claimantId: profileId } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profileId } });
    await prisma.claimantProfile.delete({ where: { id: profileId } });
  }
```

to:

```ts
  if (claimantUser?.claimantProfile) {
    const profileId = claimantUser.claimantProfile.id;
    await prisma.message.deleteMany({ where: { claimantId: profileId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: profileId } });
    await prisma.jobSearchActivity.deleteMany({
      where: { weeklyCertification: { claim: { claimantId: profileId } } },
    });
    await prisma.weeklyCertification.deleteMany({ where: { claim: { claimantId: profileId } } });
    await prisma.claim.deleteMany({ where: { claimantId: profileId } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profileId } });
    await prisma.claimantProfile.delete({ where: { id: profileId } });
  }
```

- [ ] **Step 3: Run the E2E test to verify it passes**

Run: `rm -rf .next && npx playwright test employer-marketplace-flow.spec.ts --reporter=list`
Expected: PASS. If a selector doesn't match the live DOM, read the actual current page source for that route and correct the selector — per this session's established practice for E2E work.

- [ ] **Step 4: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`
Expected: All tests pass, including the extended marketplace flow spec. (`unmatched-events-flow.spec.ts` has a known, pre-existing, out-of-plan failure from earlier seed-data changes this session — unrelated to this plan, do not attempt to fix it here.)

- [ ] **Step 5: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/employer-marketplace-flow.spec.ts
git commit -m "Extend E2E flow with certification job-search prefill coverage"
```

---
