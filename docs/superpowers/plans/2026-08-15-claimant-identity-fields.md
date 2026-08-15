# Claimant Identity Fields (Prefix, Suffix, Gender) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three optional identity fields — name prefix, name suffix, and gender — to `ClaimantProfile`, collected during identity verification and displayed on the staff case-detail page.

**Architecture:** Additive to the existing Next.js 14 App Router / Prisma / PostgreSQL codebase. Two new Prisma enums (`NamePrefix`, `NameSuffix`) and one new free-text column (`gender`) on `ClaimantProfile`, all nullable. Collected via the existing identity-verification callback form/route (not signup), using a new shared `Select` UI component for the two enum-backed dropdowns. Displayed on the staff case-detail page next to the existing legal-name heading.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, PostgreSQL via Prisma, NextAuth.js, Zod, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- Follow every existing convention exactly: `requireRole`/`requireOwnership` at the top of every API route; actor identity always derived from `session.user.id`, never client input.
- Zod validation schemas in `src/lib/validation/`, shared shape between client and server.
- Prisma `select` blocks are always explicit — never `include` a relation that would ship unused PII/data.
- WCAG 2.2 AA: semantic HTML, every form field has a visible label and `aria-describedby` error association.
- axe-core scans every route in `tests/e2e/accessibility.spec.ts` — `/claim/verify-identity/callback` is already scanned; adding fields to that form is automatically covered, no new scan needed.
- **Design decision, carried from the spec:** these three fields are set once via the identity-verification flow, same lifecycle as the existing `legalName`/`dateOfBirth`. No edit capability is added for them. Note: `src/app/api/staff/claimants/[id]/route.ts`'s `PATCH` handler already has an `EDITABLE_FIELDS` list that happens to include `legalName` (a pre-existing capability with no UI currently wired to it) — do **not** add `prefix`/`suffix`/`gender` to that list; the spec explicitly scopes editing out for these new fields regardless of that existing precedent.
- **Design decision, carried from the spec:** prefix/suffix use fixed enums with no free-text "Other" escape hatch. Gender is free text with no fixed list. All three are optional at every layer — omitting any or all of them is not an error.

---

## Task 1: Schema — `NamePrefix`, `NameSuffix` enums and `ClaimantProfile` fields

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: enum `NamePrefix` (`MR | MRS | MS | DR | MX`); enum `NameSuffix` (`JR | SR | II | III | IV`); `ClaimantProfile.prefix: NamePrefix?`, `ClaimantProfile.suffix: NameSuffix?`, `ClaimantProfile.gender: String?`.

- [ ] **Step 1: Add the two new enums**

In `prisma/schema.prisma`, add near the other enums (after `enum EmployerVerifiedStatus`):

```prisma
enum NamePrefix {
  MR
  MRS
  MS
  DR
  MX
}

enum NameSuffix {
  JR
  SR
  II
  III
  IV
}
```

- [ ] **Step 2: Add the three new fields to `ClaimantProfile`**

In the `ClaimantProfile` model, add three fields immediately after `ssnHash String? @unique`:

```prisma
  prefix                     NamePrefix?
  suffix                     NameSuffix?
  gender                     String?
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_claimant_identity_fields`
Expected: Completes with no errors; a new migration directory appears under `prisma/migrations/`; Prisma Client regenerates. Confirm the generated `migration.sql` contains `CREATE TYPE "NamePrefix"`, `CREATE TYPE "NameSuffix"`, and three `ALTER TABLE "ClaimantProfile" ADD COLUMN` statements (`prefix`, `suffix`, `gender`) — if any are missing, do not proceed; regenerate the migration against a clean state before continuing (a migration file that doesn't fully reflect `schema.prisma` will break any environment that applies it fresh).

- [ ] **Step 4: Write a failing schema smoke test**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block:

```ts
  it('can create and read back a ClaimantProfile with prefix, suffix, and gender', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-identity-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });

    const profile = await prisma.claimantProfile.create({
      data: { userId: user.id },
    });
    expect(profile.prefix).toBeNull();
    expect(profile.suffix).toBeNull();
    expect(profile.gender).toBeNull();

    const updated = await prisma.claimantProfile.update({
      where: { id: profile.id },
      data: { prefix: 'DR', suffix: 'JR', gender: 'Non-binary' },
    });
    expect(updated.prefix).toBe('DR');
    expect(updated.suffix).toBe('JR');
    expect(updated.gender).toBe('Non-binary');

    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/schema.test.ts
git commit -m "Add NamePrefix, NameSuffix enums and ClaimantProfile identity fields"
```

---

## Task 2: Validation + identity-verification callback wiring

**Files:**
- Modify: `src/lib/validation/identity.ts`
- Modify: `src/app/api/identity-verification/callback/route.ts`
- Test: `tests/integration/identity-verification.test.ts`

**Interfaces:**
- Consumes: `NamePrefix`, `NameSuffix` enums from Task 1.
- Produces: `identityVerificationSchema` accepts optional `prefix`, `suffix`, `gender`; the callback route stores them on `ClaimantProfile` when present, leaves them untouched (`null`, the default) when absent.

- [ ] **Step 1: Extend the Zod schema**

Replace the full contents of `src/lib/validation/identity.ts`:

```ts
import { z } from 'zod';

// Empty-string inputs (an unselected dropdown, an empty text field) are
// treated as "not provided," not as an invalid enum value or a stored empty
// string — these three fields are optional everywhere, and the client always
// sends every form key regardless of whether the user filled it in.
const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.enum(values).optional());

export const identityVerificationSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required'),
  dateOfBirth: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  mailingAddress: z.string().min(1, 'Mailing address is required'),
  prefix: optionalEnum(['MR', 'MRS', 'MS', 'DR', 'MX']),
  suffix: optionalEnum(['JR', 'SR', 'II', 'III', 'IV']),
  gender: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
});

export type IdentityVerificationInput = z.infer<typeof identityVerificationSchema>;
```

- [ ] **Step 2: Write a failing test asserting the new fields are stored when provided**

In `tests/integration/identity-verification.test.ts`, add a new test after the existing `'completes verification via callback and encrypts the SSN'` test:

```ts
  it('stores prefix, suffix, and gender when provided', async () => {
    const user = await prisma.user.create({
      data: { email: `idv-identity-fields-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: profile.id,
        legalName: 'Alex Rivera',
        dateOfBirth: '1985-06-20',
        ssn: '321-54-9876',
        phone: '5559876543',
        mailingAddress: '456 Oak Ave, Jefferson City, MO 65101',
        prefix: 'DR',
        suffix: 'III',
        gender: 'Non-binary',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(200);

    const updated = await prisma.claimantProfile.findUnique({ where: { id: profile.id } });
    expect(updated?.prefix).toBe('DR');
    expect(updated?.suffix).toBe('III');
    expect(updated?.gender).toBe('Non-binary');

    await prisma.auditLog.deleteMany({ where: { targetId: profile.id } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profile.id } });
    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('leaves prefix, suffix, and gender null when omitted', async () => {
    const user = await prisma.user.create({
      data: { email: `idv-identity-fields-omitted-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const req = new Request('http://localhost/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: profile.id,
        legalName: 'Sam Chen',
        dateOfBirth: '1992-03-11',
        ssn: '654-32-1098',
        phone: '5551112222',
        mailingAddress: '789 Pine St, Jefferson City, MO 65101',
        prefix: '',
        suffix: '',
        gender: '',
      }),
    });
    const res = await callbackVerification(req);
    expect(res.status).toBe(200);

    const updated = await prisma.claimantProfile.findUnique({ where: { id: profile.id } });
    expect(updated?.prefix).toBeNull();
    expect(updated?.suffix).toBeNull();
    expect(updated?.gender).toBeNull();

    await prisma.auditLog.deleteMany({ where: { targetId: profile.id } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profile.id } });
    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/identity-verification.test.ts`
Expected: FAIL — `updated?.prefix` is `undefined`/`null` mismatch against `'DR'` in the first new test (the route doesn't write these fields yet).

- [ ] **Step 4: Wire the fields into the callback route**

In `src/app/api/identity-verification/callback/route.ts`, change the `prisma.claimantProfile.update` call's `data` block from:

```ts
      data: {
        legalName: parsed.data.legalName,
        dateOfBirth: new Date(parsed.data.dateOfBirth),
        ssnEncrypted: encryptSSN(parsed.data.ssn),
        ssnHash: hashSSN(parsed.data.ssn),
        phone: parsed.data.phone,
        mailingAddress: parsed.data.mailingAddress,
        identityVerificationStatus: 'VERIFIED',
      },
```

to:

```ts
      data: {
        legalName: parsed.data.legalName,
        dateOfBirth: new Date(parsed.data.dateOfBirth),
        ssnEncrypted: encryptSSN(parsed.data.ssn),
        ssnHash: hashSSN(parsed.data.ssn),
        phone: parsed.data.phone,
        mailingAddress: parsed.data.mailingAddress,
        prefix: parsed.data.prefix,
        suffix: parsed.data.suffix,
        gender: parsed.data.gender,
        identityVerificationStatus: 'VERIFIED',
      },
```

(`parsed.data.prefix`/`suffix`/`gender` are `undefined` when omitted — Prisma's `update` treats an `undefined` field in `data` as "don't change this field," which is exactly the desired "leave null" behavior on a fresh profile.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/identity-verification.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation/identity.ts src/app/api/identity-verification/callback/route.ts tests/integration/identity-verification.test.ts
git commit -m "Accept optional prefix, suffix, and gender at identity verification"
```

---

## Task 3: `Select` UI component + verify-identity form fields

**Files:**
- Create: `src/components/ui/Select.tsx`
- Modify: `src/app/claim/verify-identity/callback/page.tsx`

**Interfaces:**
- Consumes: `identityVerificationSchema`'s field names from Task 2 (`prefix`, `suffix`, `gender`).
- Produces: `Select` component — `{ id, label, value, onChange, options, error?, required? }`, a native `<select>` with a `label`/`aria-describedby` pattern matching `TextField`. Not consumed by any later task in this plan; available for future forms.

- [ ] **Step 1: Create the `Select` component**

Create `src/components/ui/Select.tsx`:

```tsx
'use client';

import React from 'react';

type SelectOption = { value: string; label: string };

type SelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  required?: boolean;
};

export function Select({ id, label, value, onChange, options, error, required }: SelectProps) {
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block font-medium text-text-primary mb-1">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded border px-3 py-2 text-text-primary ${
          error ? 'border-error-border' : 'border-border'
        }`}
      >
        <option value="">None</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the new fields to the verify-identity callback form**

In `src/app/claim/verify-identity/callback/page.tsx`, add the import:

```ts
import { Select } from '@/components/ui/Select';
```

Change the `form` state's initial value from:

```ts
  const [form, setForm] = useState({
    legalName: '',
    dateOfBirth: '',
    ssn: '',
    phone: '',
    mailingAddress: '',
  });
```

to:

```ts
  const [form, setForm] = useState({
    legalName: '',
    dateOfBirth: '',
    ssn: '',
    phone: '',
    mailingAddress: '',
    prefix: '',
    suffix: '',
    gender: '',
  });
```

Add these two constants above the component function:

```ts
const PREFIX_OPTIONS = [
  { value: 'MR', label: 'Mr.' },
  { value: 'MRS', label: 'Mrs.' },
  { value: 'MS', label: 'Ms.' },
  { value: 'DR', label: 'Dr.' },
  { value: 'MX', label: 'Mx.' },
];

const SUFFIX_OPTIONS = [
  { value: 'JR', label: 'Jr.' },
  { value: 'SR', label: 'Sr.' },
  { value: 'II', label: 'II' },
  { value: 'III', label: 'III' },
  { value: 'IV', label: 'IV' },
];
```

Add three new fields to the form, immediately after the existing `mailingAddress` `TextField` and before the `Button`:

```tsx
        <Select
          id="prefix"
          label="Prefix (optional)"
          value={form.prefix}
          onChange={(v) => setForm({ ...form, prefix: v })}
          options={PREFIX_OPTIONS}
          error={fieldErrors.prefix}
        />
        <Select
          id="suffix"
          label="Suffix (optional)"
          value={form.suffix}
          onChange={(v) => setForm({ ...form, suffix: v })}
          options={SUFFIX_OPTIONS}
          error={fieldErrors.suffix}
        />
        <TextField
          id="gender"
          label="Gender (optional)"
          value={form.gender}
          onChange={(v) => setForm({ ...form, gender: v })}
          error={fieldErrors.gender}
        />
```

- [ ] **Step 3: Run the existing accessibility scan to confirm the form still passes**

Run: `rm -rf .next && npx playwright test accessibility.spec.ts --grep "identity verification callback" --reporter=list`
Expected: PASS — the existing scan of this route (`tests/e2e/accessibility.spec.ts`) already covers whatever the form renders; no test file changes needed for this task, this step only confirms the new fields don't introduce a violation.

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, sign up/log in as a claimant, start identity verification, and confirm the two new dropdowns and the gender field render correctly, submit successfully both with and without values filled in.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Select.tsx src/app/claim/verify-identity/callback/page.tsx
git commit -m "Add prefix, suffix, and gender fields to the identity verification form"
```

---

## Task 4: Display on the staff case-detail page

**Files:**
- Modify: `src/app/api/staff/claimants/[id]/route.ts`
- Modify: `src/app/staff/claimants/[id]/page.tsx`
- Test: `tests/integration/staff-claimants.test.ts`

**Interfaces:**
- Consumes: `ClaimantProfile.prefix`/`suffix`/`gender` from Task 1.

- [ ] **Step 1: Add the three fields to the GET route's select block**

In `src/app/api/staff/claimants/[id]/route.ts`, in the `prisma.claimantProfile.findUnique` call's `select` block, change:

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
      user: { select: { email: true } },
```

- [ ] **Step 2: Write a failing test asserting the new fields are returned**

In `tests/integration/staff-claimants.test.ts`, update the `claimantProfile.create` call in `beforeAll` from:

```ts
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName, ssnEncrypted: ssnCiphertext },
    });
```

to:

```ts
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName, ssnEncrypted: ssnCiphertext, prefix: 'DR', suffix: 'JR', gender: 'Non-binary' },
    });
```

Then add these assertions to the existing `'returns a single claimant by id with the same nested shape as the search route'` test, immediately after the existing `expect(claimant.legalName).toBe(legalName);` line:

```ts
    expect(claimant.prefix).toBe('DR');
    expect(claimant.suffix).toBe('JR');
    expect(claimant.gender).toBe('Non-binary');
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: FAIL — `claimant.prefix` is `undefined`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: PASS (the route change from Step 1 is enough — this test only checks the API response, not the rendered page).

- [ ] **Step 5: Update the page's type and add the display formatting**

In `src/app/staff/claimants/[id]/page.tsx`, change the `ClaimantDetail` type from:

```ts
type ClaimantDetail = {
  id: string;
  legalName: string | null;
  claims: {
```

to:

```ts
type ClaimantDetail = {
  id: string;
  legalName: string | null;
  prefix: 'MR' | 'MRS' | 'MS' | 'DR' | 'MX' | null;
  suffix: 'JR' | 'SR' | 'II' | 'III' | 'IV' | null;
  gender: string | null;
  claims: {
```

Add these two constants and one function above the component function:

```ts
const PREFIX_LABELS: Record<string, string> = {
  MR: 'Mr.',
  MRS: 'Mrs.',
  MS: 'Ms.',
  DR: 'Dr.',
  MX: 'Mx.',
};

const SUFFIX_LABELS: Record<string, string> = {
  JR: 'Jr.',
  SR: 'Sr.',
  II: 'II',
  III: 'III',
  IV: 'IV',
};

function formatClaimantName(claimant: ClaimantDetail): string {
  const name = claimant.legalName ?? 'Unnamed claimant';
  const withPrefix = claimant.prefix ? `${PREFIX_LABELS[claimant.prefix]} ${name}` : name;
  return claimant.suffix ? `${withPrefix}, ${SUFFIX_LABELS[claimant.suffix]}` : withPrefix;
}
```

Change the heading from:

```tsx
      <h1 className="text-2xl font-bold mb-4">{claimant.legalName ?? 'Unnamed claimant'}</h1>
```

to:

```tsx
      <h1 className="text-2xl font-bold mb-1">{formatClaimantName(claimant)}</h1>
      <div className="mb-4">
        {claimant.gender && <p className="text-text-secondary">Gender: {claimant.gender}</p>}
      </div>
```

(The wrapping `div` always carries the `mb-4` that used to live on the `h1`, so vertical spacing before the next section is identical whether or not a gender is present — no conditional branching needed for the spacing itself.)

- [ ] **Step 6: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, log in as a caseworker, open a claimant who has a prefix/suffix/gender set (e.g. via the test data from a real identity-verification run), and confirm the heading formats correctly and the gender line appears; open a claimant with none of the three set and confirm the display matches how it looked before this plan (no visible change).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/staff/claimants/[id]/route.ts src/app/staff/claimants/[id]/page.tsx tests/integration/staff-claimants.test.ts
git commit -m "Display prefix, suffix, and gender on the staff case-detail page"
```

---
