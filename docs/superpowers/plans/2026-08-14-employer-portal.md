# Employer Portal (Claims-Response) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give employers a self-service portal to confirm/dispute the wage records already on file for their FEIN and report hire/separation events that get matched to claimant records — closing the "Unverified — no employer response system available yet" placeholder already live on the caseworker Review Certification page.

**Architecture:** Additive to the existing Next.js 14 App Router / Prisma / PostgreSQL codebase. A new `EMPLOYER` role and `EmployerProfile` model (1:1 with `User`, mirroring `ClaimantProfile`) gated behind a mocked FEIN-verification step (same architecture as the existing mocked identity verification). Wage-record confirm/dispute reuses the existing `WageRecord` row with new employer-side fields alongside the existing claimant-side ones. Hire/separation events are matched to claimants via a new deterministic SSN hash — the existing SSN encryption uses a random IV per call and cannot support equality lookups.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, PostgreSQL via Prisma, NextAuth.js, Zod, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- Follow every existing convention exactly: `requireRole` at the top of every API route; actor identity always derived from `session.user.id`, never client input.
- Zod validation schemas in `src/lib/validation/`, shared shape between client and server.
- Every status-affecting write logs an `AuditLog` row via `writeAuditLog`.
- API routes use `apiError`/`invalidBody`/`parseJson` from `src/lib/apiRequest.ts`; Zod failures return `{ errors: parsed.error.flatten() }`, everything else `{ error: string }`.
- Prisma `select` blocks are always explicit — never `include` a relation that would ship unused PII/data.
- WCAG 2.2 AA: semantic HTML, every status/warning uses icon + text + color (never color alone), every form field has a visible label and `aria-describedby` error association.
- axe-core scans every route in `tests/e2e/accessibility.spec.ts` — new pages must pass it.
- **Deviation from the design spec, decided during planning:** `EmployerProfile.fein` and `companyName` are nullable, not required at creation. The spec's schema sketch listed `fein String @unique` as always-present, but the flow itself (signup, *then* a separate FEIN-verification step) means the FEIN isn't known at signup time — exactly the same shape as `ClaimantProfile`, which is created with `legalName`/`ssnEncrypted` all `null` at signup and filled in by identity verification. `fein` stays `@unique` (Postgres allows multiple `NULL`s in a unique column; only non-null values must be distinct), so uniqueness is still enforced once a FEIN is actually set.
- **Deviation from the design spec, decided during planning:** the FEIN-ownership check for the two employer wage-record routes is written inline in each route rather than extracted into a shared `rbac.ts` helper. `requireRole`/`requireOwnership` in `rbac.ts` are deliberately synchronous, pure functions operating only on the `Session` object; the FEIN check needs an `EmployerProfile` DB lookup first, which would break that file's established purity contract for only two call sites (below the "three occurrences" threshold that justified extracting `requireOwnership` in the first place, per its own comment).

---

## Task 1: Schema — EmployerProfile, EmploymentEvent, and related fields

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: enum `EmploymentEventType` (`HIRE` | `SEPARATION`); `EmployerVerifiedStatus` extended to `UNVERIFIED | VERIFIED | DISPUTED`; models `EmployerProfile`, `EmploymentEvent`; `WageRecord.employerDisputeNote: String?`; `ClaimantProfile.ssnHash: String? @unique` and `ClaimantProfile.matchedEmploymentEvents: EmploymentEvent[]`; `User.employerProfile: EmployerProfile?`.

- [ ] **Step 1: Extend the `EmployerVerifiedStatus` enum**

In `prisma/schema.prisma`, change:

```prisma
enum EmployerVerifiedStatus {
  UNVERIFIED
}
```

to:

```prisma
enum EmployerVerifiedStatus {
  UNVERIFIED
  VERIFIED
  DISPUTED
}
```

- [ ] **Step 2: Add the new `EmploymentEventType` enum**

Add near the other enums (after `enum PaymentStatus`):

```prisma
enum EmploymentEventType {
  HIRE
  SEPARATION
}
```

- [ ] **Step 3: Add `WageRecord.employerDisputeNote`**

In the `WageRecord` model, add a field immediately after `employerVerifiedStatus EmployerVerifiedStatus @default(UNVERIFIED)`:

```prisma
  employerDisputeNote    String?
```

- [ ] **Step 4: Add `ClaimantProfile.ssnHash` and its back-relation**

In the `ClaimantProfile` model, add a field after `ssnEncrypted String?`:

```prisma
  ssnHash                    String?            @unique
```

Add a new relation field at the end of the model's relation block (after `messages Message[] @relation("ClaimantMessages")`):

```prisma
  matchedEmploymentEvents EmploymentEvent[]
```

- [ ] **Step 5: Add `User.employerProfile`**

In the `User` model, add a relation field after `claimantProfile ClaimantProfile?`:

```prisma
  employerProfile   EmployerProfile?
```

- [ ] **Step 6: Add the `EmployerProfile` and `EmploymentEvent` models**

Add at the end of the file:

```prisma
model EmployerProfile {
  id                 String             @id @default(cuid())
  userId             String             @unique
  user               User               @relation(fields: [userId], references: [id])
  fein               String?            @unique
  companyName        String?
  verificationStatus VerificationStatus @default(PENDING)
  createdAt          DateTime           @default(now())

  employmentEvents EmploymentEvent[]
}

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
}
```

- [ ] **Step 7: Run the migration**

Run: `npx prisma migrate dev --name add_employer_portal`
Expected: Completes with no errors; a new migration directory appears under `prisma/migrations/`; Prisma Client regenerates.

- [ ] **Step 8: Write a failing schema smoke test**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block:

```ts
  it('can create and read back an EmployerProfile and EmploymentEvent', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-employer-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'EMPLOYER',
      },
    });

    const employer = await prisma.employerProfile.create({
      data: { userId: user.id },
    });
    expect(employer.fein).toBeNull();
    expect(employer.verificationStatus).toBe('PENDING');

    const verifiedEmployer = await prisma.employerProfile.update({
      where: { id: employer.id },
      data: { fein: '99-9999999', companyName: 'Schema Test Co', verificationStatus: 'VERIFIED' },
    });
    expect(verifiedEmployer.fein).toBe('99-9999999');

    const claimantUser = await prisma.user.create({
      data: {
        email: `schema-test-claimant-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });
    const claimant = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `test-hash-${Date.now()}` },
    });

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employer.id,
        type: 'HIRE',
        employeeName: 'Test Employee',
        ssnHash: claimant.ssnHash!,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimant.id,
      },
    });
    expect(event.matchedClaimantProfileId).toBe(claimant.id);

    await prisma.employmentEvent.delete({ where: { id: event.id } });
    await prisma.claimantProfile.delete({ where: { id: claimant.id } });
    await prisma.user.delete({ where: { id: claimantUser.id } });
    await prisma.employerProfile.delete({ where: { id: employer.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/schema.test.ts
git commit -m "Add EmployerProfile, EmploymentEvent, and related schema fields"
```

---

## Task 2: SSN hash utility

**Files:**
- Create: `src/lib/ssnHash.ts`
- Test: `tests/unit/ssnHash.test.ts`

**Interfaces:**
- Produces: `hashSSN(plain: string): string`. Consumed by Task 3 (identity verification) and Task 8 (event matching).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ssnHash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashSSN } from '@/lib/ssnHash';

describe('hashSSN', () => {
  it('is deterministic: the same SSN always produces the same hash', () => {
    const first = hashSSN('123-45-6789');
    const second = hashSSN('123-45-6789');
    expect(first).toBe(second);
  });

  it('produces different hashes for different SSNs', () => {
    const a = hashSSN('123-45-6789');
    const b = hashSSN('987-65-4321');
    expect(a).not.toBe(b);
  });

  it('produces a hex-encoded SHA-256-length string', () => {
    const hash = hashSSN('123-45-6789');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ssnHash.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ssnHash'`.

- [ ] **Step 3: Implement the hash utility**

Create `src/lib/ssnHash.ts`:

```ts
import crypto from 'crypto';

function getHashKey(): string {
  const key = process.env.SSN_HASH_KEY;
  if (!key) {
    throw new Error('SSN_HASH_KEY must be set');
  }
  return key;
}

/**
 * Deterministic, one-way HMAC-SHA256 of a plaintext SSN, for equality
 * matching only (e.g. an employer-reported hire/separation event against an
 * existing claimant record) — never used for display or reversed. Uses a
 * separate secret from SSN_ENCRYPTION_KEY: encryption (reversible, for
 * display) and hashing (one-way, for matching) are different security
 * properties and shouldn't share a key.
 */
export function hashSSN(plain: string): string {
  const key = getHashKey();
  return crypto.createHmac('sha256', key).update(plain).digest('hex');
}
```

- [ ] **Step 4: Add `SSN_HASH_KEY` to the local `.env` file**

The `.env` file is gitignored and not part of this diff — add the line yourself so tests can run. Generate a random 64-character hex string (matching the existing `SSN_ENCRYPTION_KEY` format) and append a line to `.env`:

```
SSN_HASH_KEY="<a different random 64-character hex string than SSN_ENCRYPTION_KEY — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`>"
```

Also add the same variable to `vitest.config.ts`'s `test.env` block (which currently only sets `SSN_ENCRYPTION_KEY`), so the test suite has it without relying on `.env` loading timing:

```ts
    env: {
      SSN_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SSN_HASH_KEY:
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    },
```

(Note: `vitest.config.ts`'s `test.env` values are test-only fixtures, unrelated to the real `.env` value — both need to exist, but they don't need to match.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ssnHash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ssnHash.ts tests/unit/ssnHash.test.ts vitest.config.ts
git commit -m "Add deterministic SSN hash utility for employer event matching"
```

Note: `.env` is gitignored and won't appear in `git status` — that's expected, not a missed file.

---

## Task 3: Wire SSN hash into identity verification

**Files:**
- Modify: `src/app/api/identity-verification/callback/route.ts`
- Modify: `tests/integration/identity-verification.test.ts`
- Create: `prisma/backfillSsnHash.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `hashSSN` from Task 2.
- Produces: every newly-verified `ClaimantProfile` gets `ssnHash` set alongside `ssnEncrypted`. Consumed by Task 8 (event matching) — a claimant with no `ssnHash` (never went through this path, or verified before this change) simply can't be matched, which the backfill script closes for existing rows.

- [ ] **Step 1: Wire the hash into the callback route**

In `src/app/api/identity-verification/callback/route.ts`, add the import:

```ts
import { hashSSN } from '@/lib/ssnHash';
```

Change the `prisma.claimantProfile.update` call's `data` block from:

```ts
    data: {
      legalName: parsed.data.legalName,
      dateOfBirth: new Date(parsed.data.dateOfBirth),
      ssnEncrypted: encryptSSN(parsed.data.ssn),
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
      identityVerificationStatus: 'VERIFIED',
    },
```

- [ ] **Step 2: Write a failing test asserting `ssnHash` is set**

Read `tests/integration/identity-verification.test.ts` first to find its existing "verifies identity" test (it POSTs to the callback route with a fixed SSN and asserts the profile updates). Add this assertion to that existing test, after its existing checks on the returned/updated profile — importing `hashSSN` from `@/lib/ssnHash` and asserting the profile's `ssnHash` in the database equals `hashSSN('123-45-6789')` (or whatever fixed SSN that existing test already submits — use the exact same literal string the test already POSTs, don't introduce a new one).

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/identity-verification.test.ts`
Expected: FAIL — `ssnHash` is `null` on the fetched profile.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/identity-verification.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the backfill script**

Create `prisma/backfillSsnHash.ts`:

```ts
// One-time backfill: computes ssnHash for every ClaimantProfile that has an
// encrypted SSN on file but no hash yet (rows verified before this feature
// shipped). Decrypts each SSN once, in memory, only long enough to hash it —
// never logged, never written back in plaintext.
import { prisma } from '../src/lib/prisma';
import { decryptSSN } from '../src/lib/encryption';
import { hashSSN } from '../src/lib/ssnHash';

async function main() {
  const profiles = await prisma.claimantProfile.findMany({
    where: { ssnEncrypted: { not: null }, ssnHash: null },
  });
  console.log(`Backfilling ssnHash for ${profiles.length} claimant profile(s)...`);

  for (const profile of profiles) {
    const plain = decryptSSN(profile.ssnEncrypted!);
    const hash = hashSSN(plain);
    await prisma.claimantProfile.update({ where: { id: profile.id }, data: { ssnHash: hash } });
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Add a package.json script and run it locally**

In `package.json`'s `scripts` block, add a line after `"db:seed": "tsx prisma/seed.ts",`:

```json
    "db:backfill-ssn-hash": "tsx prisma/backfillSsnHash.ts",
```

Run: `npm run db:backfill-ssn-hash`
Expected: Reports backfilling N profiles (likely 1-2, from this session's seed/test data) and completes with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/identity-verification/callback/route.ts tests/integration/identity-verification.test.ts prisma/backfillSsnHash.ts package.json
git commit -m "Compute ssnHash at identity verification, add backfill script for existing rows"
```

---

## Task 4: Employer auth foundation — signup, login, session

**Files:**
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/auth.ts`
- Create: `src/app/api/employer/signup/route.ts`
- Create: `src/app/employer/signup/page.tsx`
- Create: `src/app/employer/login/page.tsx`
- Test: `tests/integration/employer-signup.test.ts`
- Test: `tests/unit/rbac.test.ts` (extend)

**Interfaces:**
- Produces: `Role` type now includes `'EMPLOYER'`; `Session.user.employerProfileId?: string`; `POST /api/employer/signup`. Consumed by every later task's routes (`requireRole(session, ['EMPLOYER'])`) and pages (`session.user.employerProfileId`).

- [ ] **Step 1: Extend the Role type in `next-auth.d.ts`**

Replace the full contents of `src/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' | 'EMPLOYER';
      claimantProfileId?: string;
      employerProfileId?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' | 'EMPLOYER';
    claimantProfileId?: string;
    employerProfileId?: string;
  }
}
```

- [ ] **Step 2: Extend the Role type in `rbac.ts`**

In `src/lib/rbac.ts`, change:

```ts
type Role = 'CLAIMANT' | 'CASEWORKER' | 'ADMIN';
```

to:

```ts
type Role = 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' | 'EMPLOYER';
```

- [ ] **Step 3: Write a confirming test for the extended Role type**

Steps 1-2 already extended the `Role` type, so this step is a confirming test, not a red/green TDD cycle — there's no meaningful way to test "the type doesn't include EMPLOYER yet" separately from just adding the type and testing the new value.

Read `tests/unit/rbac.test.ts` first to see its existing test structure for `requireRole`. Add a test asserting `requireRole(session, ['EMPLOYER'])` returns `{ ok: true }` for a session with `role: 'EMPLOYER'`, and `{ ok: false, status: 403 }` for a session with a different role — following the exact same pattern as the file's existing tests for `CASEWORKER`/`ADMIN`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/rbac.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `employerProfileId` into `auth.ts`**

Replace the full contents of `src/lib/auth.ts`:

```ts
import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, clearRateLimit } from '@/lib/rateLimit';

export async function authorizeCredentials(email: string, password: string) {
  // Basic login rate limiting (spec: "Basic rate limiting on login and
  // identity-verification endpoints"). Keyed by email so one account cannot be
  // brute-forced from many addresses; returning null surfaces to the client as
  // the same 401 as a bad password, which also avoids telling an attacker
  // whether the account exists.
  const rateLimitKey = `login:${email.toLowerCase()}`;
  if (!checkRateLimit(rateLimitKey).allowed) return null;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  // Successful login: clear the window so failed attempts before this one
  // don't keep counting against the account. Without this, a legitimate
  // user (or a shared demo account) who mistypes a password a few times
  // before succeeding, repeated over normal use, could eventually trip the
  // limiter even though every login has ultimately been valid.
  clearRateLimit(rateLimitKey);
  const claimantProfile = await prisma.claimantProfile.findUnique({ where: { userId: user.id } });
  const employerProfile = await prisma.employerProfile.findUnique({ where: { userId: user.id } });
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    claimantProfileId: claimantProfile?.id,
    employerProfileId: employerProfile?.id,
  };
}

export const authOptions: NextAuthOptions = {
  // 30 minutes, in seconds (NextAuth's unit). Without an explicit maxAge
  // NextAuth defaults to a 30-DAY session, which is far too long for a benefits
  // portal handling SSNs — and it left SessionTimeoutWarning warning about an
  // expiry that was never going to happen. The warning component now derives
  // its timing from the real `session.expires` this produces.
  session: { strategy: 'jwt', maxAge: 30 * 60 },
  pages: { signIn: '/claim/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return authorizeCredentials(credentials.email, credentials.password);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as unknown as { role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' | 'EMPLOYER' }).role;
        token.claimantProfileId = (user as { claimantProfileId?: string }).claimantProfileId;
        token.employerProfileId = (user as { employerProfileId?: string }).employerProfileId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' | 'EMPLOYER';
        session.user.claimantProfileId = token.claimantProfileId as string | undefined;
        session.user.employerProfileId = token.employerProfileId as string | undefined;
      }
      return session;
    },
  },
};

export function getServerAuthSession() {
  return getServerSession(authOptions);
}
```

- [ ] **Step 6: Write the failing test for employer signup**

Create `tests/integration/employer-signup.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/employer/signup/route';

describe('POST /api/employer/signup', () => {
  const email = `employer-signup-${Date.now()}@example.com`;
  let userId: string;
  let employerProfileId: string;

  it('creates an EMPLOYER user with an EmployerProfile', async () => {
    const req = new Request('http://localhost/api/employer/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'EmployerPass123' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    userId = body.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.role).toBe('EMPLOYER');

    const profile = await prisma.employerProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile?.fein).toBeNull();
    expect(profile?.verificationStatus).toBe('PENDING');
    employerProfileId = profile!.id;
  });

  it('rejects a duplicate email with 409', async () => {
    const req = new Request('http://localhost/api/employer/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'AnotherPass123' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('rejects a malformed JSON body with a clean 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/employer/signup', { method: 'POST', body: '<<<not json' })
    );
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    if (employerProfileId) {
      await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-signup.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/signup/route'`.

- [ ] **Step 8: Implement the employer signup route**

Create `src/app/api/employer/signup/route.ts`:

```ts
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signupSchema } from '@/lib/validation/auth';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

// Deliberately separate from /api/signup, which is hardcoded to
// role: 'CLAIMANT' specifically to prevent self-provisioning any other
// role — extending it to accept a role field would weaken that guarantee.
export async function POST(req: Request) {
  const body = await parseJson<{ email?: string; password?: string }>(req);
  if (!body) return invalidBody();

  const credsParsed = signupSchema.safeParse({ email: body.email, password: body.password });
  if (!credsParsed.success) {
    return Response.json({ errors: credsParsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: credsParsed.data.email } });
  if (existing) {
    return apiError('An account with this email already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(credsParsed.data.password, 12);
  const user = await prisma.user.create({
    data: { email: credsParsed.data.email, passwordHash, role: 'EMPLOYER' },
  });

  await prisma.employerProfile.create({ data: { userId: user.id } });

  return Response.json({ id: user.id, email: user.email }, { status: 201 });
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-signup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Create the employer signup page**

Create `src/app/employer/signup/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function EmployerSignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);
    const res = await fetch('/api/employer/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSubmitting(false);
    if (res.ok) {
      router.push('/employer/login?registered=1');
      return;
    }
    const data = await res.json();
    if (res.status === 409) {
      setErrors([{ id: 'email', message: data.error }]);
    } else {
      setErrors([{ id: 'email', message: 'Please check your email and password and try again.' }]);
    }
  }

  const emailError = errors.find((e) => e.id === 'email')?.message;
  const passwordError = errors.find((e) => e.id === 'password')?.message;

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Create an employer account</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
          error={emailError}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          error={passwordError}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 11: Create the employer login page**

Create `src/app/employer/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function EmployerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const result = await signIn('credentials', { redirect: false, email, password });
    if (result?.error) {
      setErrors([{ id: 'email', message: 'Invalid email or password.' }]);
      return;
    }
    router.push('/employer/dashboard');
  }

  const emailError = errors.find((e) => e.id === 'email')?.message;
  const passwordError = errors.find((e) => e.id === 'password')?.message;

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Employer log in</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" required error={emailError} />
        <TextField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required error={passwordError} />
        <Button type="submit">Log in</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 12: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS — the `Role` type extension is additive; every existing route/test using the narrower literal roles is unaffected since `'EMPLOYER'` is simply a new member of the union, not a change to existing values.

- [ ] **Step 13: Commit**

```bash
git add src/types/next-auth.d.ts src/lib/rbac.ts src/lib/auth.ts src/app/api/employer/signup src/app/employer/signup src/app/employer/login tests/integration/employer-signup.test.ts tests/unit/rbac.test.ts
git commit -m "Add EMPLOYER role, session wiring, and employer signup/login"
```

---

## Task 5: FEIN verification

**Files:**
- Create: `src/lib/mockFeinVerify.ts`
- Create: `src/lib/validation/feinVerification.ts`
- Create: `src/app/api/employer/verify-fein/route.ts`
- Create: `src/app/employer/verify-fein/page.tsx`
- Create: `src/app/employer/dashboard/page.tsx` (placeholder shell — Task 6 fills in its content)
- Test: `tests/unit/mockFeinVerify.test.ts`
- Test: `tests/integration/employer-verify-fein.test.ts`

**Interfaces:**
- Consumes: `session.user.employerProfileId` from Task 4.
- Produces: `POST /api/employer/verify-fein`; `EmployerProfile.verificationStatus: 'VERIFIED'` once complete. Consumed by Task 6/8's routes, which reject unverified employers.

- [ ] **Step 1: Write the failing test for the mock verifier**

Create `tests/unit/mockFeinVerify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifyFein } from '@/lib/mockFeinVerify';

describe('verifyFein', () => {
  it('succeeds for a well-formed FEIN and a non-empty company name', () => {
    expect(verifyFein('43-1234567', 'Acme Corp')).toEqual({ verified: true });
  });

  it('fails for a malformed FEIN', () => {
    expect(verifyFein('not-a-fein', 'Acme Corp')).toEqual({ verified: false });
  });

  it('fails for an empty company name', () => {
    expect(verifyFein('43-1234567', '   ')).toEqual({ verified: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/mockFeinVerify.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mockFeinVerify'`.

- [ ] **Step 3: Implement the mock verifier**

Create `src/lib/mockFeinVerify.ts`:

```ts
// Deterministic, simulated FEIN verification — no real business-registry
// integration (a later-phase concern). Mirrors the existing MockIDProof
// pattern: this app's mocked external services model the happy path
// consistently rather than simulating failure branches with no real backing
// service to fail against — the format/presence checks below exist as a
// defensive fallback behind the same checks Zod already performs, not as a
// meaningful "verification" of business legitimacy.
export function verifyFein(fein: string, companyName: string): { verified: boolean } {
  return { verified: /^\d{2}-\d{7}$/.test(fein) && companyName.trim().length > 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/mockFeinVerify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the Zod schema**

Create `src/lib/validation/feinVerification.ts`:

```ts
import { z } from 'zod';

export const feinVerificationSchema = z.object({
  fein: z.string().regex(/^\d{2}-\d{7}$/, 'FEIN must be in 12-3456789 format'),
  companyName: z.string().min(1, 'Company name is required'),
});

export type FeinVerificationInput = z.infer<typeof feinVerificationSchema>;
```

- [ ] **Step 6: Write the failing integration test**

Create `tests/integration/employer-verify-fein.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/employer/verify-fein/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/verify-fein', () => {
  let userId: string;
  let employerProfileId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `verify-fein-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    userId = user.id;
    const profile = await prisma.employerProfile.create({ data: { userId: user.id } });
    employerProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'EMPLOYER', employerProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('verifies a well-formed FEIN and updates the employer profile', async () => {
    const req = new Request('http://localhost/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein: '43-1234567', companyName: 'Acme Corp' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const profile = await prisma.employerProfile.findUnique({ where: { id: employerProfileId } });
    expect(profile?.fein).toBe('43-1234567');
    expect(profile?.companyName).toBe('Acme Corp');
    expect(profile?.verificationStatus).toBe('VERIFIED');
  });

  it('rejects a malformed FEIN with a 400', async () => {
    const req = new Request('http://localhost/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein: 'not-a-fein', companyName: 'Acme Corp' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-verify-fein.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/verify-fein/route'`.

- [ ] **Step 8: Implement the route**

Create `src/app/api/employer/verify-fein/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { feinVerificationSchema } from '@/lib/validation/feinVerification';
import { verifyFein } from '@/lib/mockFeinVerify';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = feinVerificationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const { verified } = verifyFein(parsed.data.fein, parsed.data.companyName);
  if (!verified) {
    return apiError('We could not verify that FEIN. Please check it and try again.', 400);
  }

  await prisma.employerProfile.update({
    where: { id: session!.user.employerProfileId },
    data: {
      fein: parsed.data.fein,
      companyName: parsed.data.companyName,
      verificationStatus: 'VERIFIED',
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYER_FEIN_VERIFIED',
    targetEntity: 'EmployerProfile',
    targetId: session!.user.employerProfileId,
  });

  return Response.json({ status: 'VERIFIED' }, { status: 200 });
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-verify-fein.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Create the verify-fein page**

Create `src/app/employer/verify-fein/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function VerifyFeinPage() {
  const router = useRouter();
  const [fein, setFein] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein, companyName }),
    });
    if (res.ok) {
      router.push('/employer/dashboard');
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (messages?.[0]) {
          nextFieldErrors[field] = messages[0];
          summary.push({ id: field, message: messages[0] });
        }
      }
      setFieldErrors(nextFieldErrors);
      setErrors(summary);
      return;
    }
    setErrors([{ id: 'fein', message: body?.error ?? 'Please check the information you entered and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verify your company</h1>
      <p className="mb-4 text-text-secondary">
        Before you can respond to wage records or report employment events, we need to confirm
        your Federal Employer Identification Number (FEIN) and company name.
      </p>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="fein"
          label="FEIN (12-3456789)"
          value={fein}
          onChange={setFein}
          error={fieldErrors.fein}
          required
        />
        <TextField
          id="companyName"
          label="Company name"
          value={companyName}
          onChange={setCompanyName}
          error={fieldErrors.companyName}
          required
        />
        <Button type="submit">Verify</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 11: Create the dashboard page shell**

Create `src/app/employer/dashboard/page.tsx` — a minimal shell for now; Task 6 replaces this with the full wage-record list and Task 8 adds the event-reporting form:

```tsx
'use client';

export default function EmployerDashboardPage() {
  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Employer dashboard</h1>
    </main>
  );
}
```

- [ ] **Step 12: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/lib/mockFeinVerify.ts src/lib/validation/feinVerification.ts src/app/api/employer/verify-fein src/app/employer/verify-fein src/app/employer/dashboard tests/unit/mockFeinVerify.test.ts tests/integration/employer-verify-fein.test.ts
git commit -m "Add mocked FEIN verification and employer dashboard shell"
```

---

## Task 6: Employer wage-record confirm/dispute

**Files:**
- Create: `src/lib/validation/employerWageRecord.ts`
- Create: `src/app/api/employer/wage-records/route.ts`
- Create: `src/app/api/employer/wage-records/[id]/route.ts`
- Modify: `src/app/employer/dashboard/page.tsx`
- Test: `tests/integration/employer-wage-records.test.ts`

**Interfaces:**
- Consumes: `session.user.employerProfileId`, `EmployerProfile.fein`/`verificationStatus` from Tasks 4-5.
- Produces: `GET /api/employer/wage-records`, `PATCH /api/employer/wage-records/[id]`. `WageRecord.employerVerifiedStatus`/`employerDisputeNote` become real values, consumed by Task 7.

- [ ] **Step 1: Write the Zod schema**

Create `src/lib/validation/employerWageRecord.ts`:

```ts
import { z } from 'zod';

export const employerWageRecordUpdateSchema = z.object({
  disputeNote: z.string().min(1).optional(),
});

export type EmployerWageRecordUpdateInput = z.infer<typeof employerWageRecordUpdateSchema>;
```

- [ ] **Step 2: Write the failing test for both routes**

Create `tests/integration/employer-wage-records.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET } from '@/app/api/employer/wage-records/route';
import { PATCH } from '@/app/api/employer/wage-records/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer wage-record routes', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let wageRecordId: string;
  let otherWageRecordId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `employer-wage-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '55-5555555', companyName: 'Test Employer', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUser.id, role: 'EMPLOYER', employerProfileId: employerProfile.id, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claimantUser = await prisma.user.create({
      data: { email: `employer-wage-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
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

    const wageRecord = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'Test Employer',
        fein: '55-5555555',
        workLocation: 'Somewhere, MO',
        jobTitle: 'Tester',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 20,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    wageRecordId = wageRecord.id;

    const otherWageRecord = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'A Different Employer',
        fein: '11-1111111',
        workLocation: 'Elsewhere, MO',
        jobTitle: 'Other',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 20,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
      },
    });
    otherWageRecordId = otherWageRecord.id;
  });

  it('GET lists only wage records matching the employer own FEIN', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const records = await res.json();
    expect(records.map((r: { id: string }) => r.id)).toEqual([wageRecordId]);
  });

  it('PATCH confirms a wage record with no dispute note', async () => {
    const req = new Request(`http://localhost/api/employer/wage-records/${wageRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: { id: wageRecordId } });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.employerVerifiedStatus).toBe('VERIFIED');
    expect(updated.employerDisputeNote).toBeNull();
  });

  it('PATCH rejects a wage record belonging to a different FEIN', async () => {
    const req = new Request(`http://localhost/api/employer/wage-records/${otherWageRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: { id: otherWageRecordId } });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUserId } });
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-wage-records.test.ts`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 4: Implement the GET route**

Create `src/app/api/employer/wage-records/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { fein: true, verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED' || !employerProfile.fein) {
    return apiError('Employer account is not verified', 403);
  }

  const wageRecords = await prisma.wageRecord.findMany({
    where: { fein: employerProfile.fein },
    select: {
      id: true,
      employerName: true,
      workLocation: true,
      jobTitle: true,
      firstDayWorked: true,
      lastDayWorked: true,
      wageRate: true,
      hoursPerWeek: true,
      separationReason: true,
      recallDate: true,
      employerVerifiedStatus: true,
      employerDisputeNote: true,
    },
  });

  return Response.json(wageRecords);
}
```

- [ ] **Step 5: Implement the PATCH route**

Create `src/app/api/employer/wage-records/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { employerWageRecordUpdateSchema } from '@/lib/validation/employerWageRecord';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = employerWageRecordUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { fein: true, verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED' || !employerProfile.fein) {
    return apiError('Employer account is not verified', 403);
  }

  const record = await prisma.wageRecord.findUnique({
    where: { id: params.id },
    select: { fein: true },
  });
  if (!record) {
    return apiError('Wage record not found', 404);
  }
  if (record.fein !== employerProfile.fein) {
    return apiError('Forbidden', 403);
  }

  const updated = await prisma.wageRecord.update({
    where: { id: params.id },
    data: {
      employerVerifiedStatus: parsed.data.disputeNote ? 'DISPUTED' : 'VERIFIED',
      employerDisputeNote: parsed.data.disputeNote ?? null,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: parsed.data.disputeNote ? 'WAGE_RECORD_DISPUTED_BY_EMPLOYER' : 'WAGE_RECORD_VERIFIED_BY_EMPLOYER',
    targetEntity: 'WageRecord',
    targetId: params.id,
  });

  return Response.json(updated, { status: 200 });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-wage-records.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Replace the dashboard shell with the wage-record list**

Replace the full contents of `src/app/employer/dashboard/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
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
  employerVerifiedStatus: 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED';
  employerDisputeNote: string | null;
};

export default function EmployerDashboardPage() {
  const [records, setRecords] = useState<WageRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadRecords() {
    const res = await fetch('/api/employer/wage-records');
    if (!res.ok) {
      setLoadError('We could not load your wage records. Please try again.');
      return;
    }
    setRecords(await res.json());
  }

  useEffect(() => {
    loadRecords();
  }, []);

  async function handleVerify(id: string) {
    setActionError(null);
    const res = await fetch(`/api/employer/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      setActionError('We could not record your confirmation. Please try again.');
      return;
    }
    const updated = await res.json();
    setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
  }

  async function handleDispute(id: string) {
    if (!disputeNote.trim()) return;
    setActionError(null);
    const res = await fetch(`/api/employer/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ disputeNote }),
    });
    if (!res.ok) {
      setActionError('We could not record your dispute. Please try again.');
      return;
    }
    const updated = await res.json();
    setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
    setCorrectingId(null);
    setDisputeNote('');
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Employer dashboard</h1>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Wage records on file</h2>
        {loadError && (
          <p role="alert" className="mb-2 text-error-text">
            {loadError}
          </p>
        )}
        {records === null && !loadError && <p>Loading…</p>}
        {records !== null && records.length === 0 && (
          <p className="text-sm text-text-secondary">No wage records are on file for your company yet.</p>
        )}
        {actionError && (
          <p role="alert" className="mb-2 text-error-text">
            {actionError}
          </p>
        )}
        {records !== null && records.length > 0 && (
          <ul className="space-y-4">
            {records.map((r) => (
              <li key={r.id} className="border-t border-border pt-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
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
                {r.employerVerifiedStatus === 'VERIFIED' && (
                  <p role="status" className="text-status-active-text font-medium">
                    ✓ Confirmed
                  </p>
                )}
                {r.employerVerifiedStatus === 'DISPUTED' && (
                  <p role="status" className="text-error-text font-medium">
                    ⚠ Disputed: {r.employerDisputeNote}
                  </p>
                )}
                {r.employerVerifiedStatus === 'UNVERIFIED' && correctingId === r.id && (
                  <div>
                    <TextField
                      id={`dispute-${r.id}`}
                      label="What's incorrect?"
                      value={disputeNote}
                      onChange={setDisputeNote}
                      required
                    />
                    <Button onClick={() => handleDispute(r.id)}>Submit dispute</Button>
                  </div>
                )}
                {r.employerVerifiedStatus === 'UNVERIFIED' && correctingId !== r.id && (
                  <div className="flex gap-3">
                    <Button onClick={() => handleVerify(r.id)}>Confirm</Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCorrectingId(r.id);
                        setDisputeNote('');
                      }}
                    >
                      This isn&apos;t right
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Manually verify in the browser**

Run: `npm run dev`, sign up a new employer account at `/employer/signup`, verify a FEIN at `/employer/verify-fein`, and confirm the dashboard loads at `/employer/dashboard` (it will show "No wage records are on file for your company yet" unless the FEIN happens to match an existing seeded/test `WageRecord` — that's expected and correct).

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/employerWageRecord.ts src/app/api/employer/wage-records src/app/employer/dashboard/page.tsx tests/integration/employer-wage-records.test.ts
git commit -m "Add employer wage-record confirm/dispute"
```

---

## Task 7: Review Certification page — real employer-verification display

**Files:**
- Modify: `src/app/api/certifications/[id]/review/route.ts`
- Modify: `src/app/staff/certifications/[id]/review/page.tsx`
- Modify: `tests/integration/review-evidence.test.ts`

**Interfaces:**
- Consumes: `WageRecord.employerVerifiedStatus`/`employerDisputeNote` from Task 6.

- [ ] **Step 1: Add `employerDisputeNote` to the GET route's select**

In `src/app/api/certifications/[id]/review/route.ts`, in the `wageRecords` select block, add a line after `employerVerifiedStatus: true,`:

```ts
              employerDisputeNote: true,
```

- [ ] **Step 2: Write a failing assertion**

In `tests/integration/review-evidence.test.ts`, find the `beforeAll` block's `wageRecord.create` call and add `employerVerifiedStatus: 'DISPUTED', employerDisputeNote: 'Wage rate is wrong.',` to its `data`. In the existing evidence-bundle test, add an assertion after the existing wage-record checks:

```ts
    expect(body.wageRecords[0].employerVerifiedStatus).toBe('DISPUTED');
    expect(body.wageRecords[0].employerDisputeNote).toBe('Wage rate is wrong.');
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/review-evidence.test.ts`
Expected: FAIL — `employerDisputeNote` is `undefined` in the response.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/review-evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the review page's type and rendering**

In `src/app/staff/certifications/[id]/review/page.tsx`, in the `ReviewEvidence` type's `wageRecords` array shape, add a field after `claimantDisputeNote: string | null;`:

```ts
    employerDisputeNote: string | null;
```

Replace the hardcoded employer-verified-status block:

```tsx
                        <dt>Employer-verified status</dt>
                        <dd>Unverified — no employer response system available yet</dd>
```

with:

```tsx
                        <dt>Employer-verified status</dt>
                        <dd>
                          {w.employerVerifiedStatus === 'VERIFIED' && (
                            <span className="text-status-active-text">✓ Verified by employer</span>
                          )}
                          {w.employerVerifiedStatus === 'DISPUTED' && (
                            <span className="text-error-text">⚠ Disputed by employer</span>
                          )}
                          {w.employerVerifiedStatus === 'UNVERIFIED' && (
                            <span className="text-text-secondary">— Not yet reviewed by employer</span>
                          )}
                        </dd>
```

Add a new employer-dispute warning immediately after the existing claimant-dispute warning block (`{w.claimantDisputeNote && (...)}`), before the `{conflict && (...)}` block:

```tsx
                      {w.employerDisputeNote && (
                        <p role="alert" className="text-error-text">
                          ⚠ Employer dispute: {w.employerDisputeNote}
                        </p>
                      )}
```

- [ ] **Step 6: Run the full unit + integration suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/certifications/[id]/review/route.ts src/app/staff/certifications/[id]/review/page.tsx tests/integration/review-evidence.test.ts
git commit -m "Show real employer-verification status on the Review Certification page"
```

---

## Task 8: Employer event reporting + claimant matching

**Files:**
- Create: `src/lib/validation/employmentEvent.ts`
- Create: `src/app/api/employer/events/route.ts`
- Modify: `src/app/employer/dashboard/page.tsx`
- Test: `tests/integration/employer-events.test.ts`

**Interfaces:**
- Consumes: `hashSSN` from Task 2, `ClaimantProfile.ssnHash` from Task 3, `session.user.employerProfileId` from Task 4.
- Produces: `POST /api/employer/events`. Consumed by Task 9 (matched events surfaced on the staff case-detail page).

- [ ] **Step 1: Write the Zod schema**

Create `src/lib/validation/employmentEvent.ts`:

```ts
import { z } from 'zod';

export const employmentEventSchema = z.object({
  employeeName: z.string().min(1, 'Employee name is required'),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  type: z.enum(['HIRE', 'SEPARATION']),
  eventDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
});

export type EmploymentEventInput = z.infer<typeof employmentEventSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/employer-events.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST } from '@/app/api/employer/events/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/events', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  const eventIds: string[] = [];
  const matchableSsn = '123-45-6789';

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `employer-events-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '77-7777777', companyName: 'Events Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUser.id, role: 'EMPLOYER', employerProfileId: employerProfile.id, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claimantUser = await prisma.user.create({
      data: { email: `employer-events-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'Matchable Claimant', ssnHash: hashSSN(matchableSsn) },
    });
    claimantProfileId = profile.id;
  });

  it('creates a matched event when the SSN corresponds to an existing claimant', async () => {
    const req = new Request('http://localhost/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({
        employeeName: 'Matchable Claimant',
        ssn: matchableSsn,
        type: 'HIRE',
        eventDate: '2026-08-01',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    eventIds.push(body.id);

    const event = await prisma.employmentEvent.findUnique({ where: { id: body.id } });
    expect(event?.matchedClaimantProfileId).toBe(claimantProfileId);
  });

  it('creates an unmatched event when the SSN does not correspond to any claimant, without revealing that to the caller', async () => {
    const req = new Request('http://localhost/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({
        employeeName: 'Nobody On File',
        ssn: '999-99-9999',
        type: 'SEPARATION',
        eventDate: '2026-08-01',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    eventIds.push(body.id);
    expect(body).not.toHaveProperty('matched');
    expect(body).not.toHaveProperty('matchedClaimantProfileId');

    const event = await prisma.employmentEvent.findUnique({ where: { id: body.id } });
    expect(event?.matchedClaimantProfileId).toBeNull();
  });

  it('rejects a malformed SSN with a 400', async () => {
    const req = new Request('http://localhost/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({
        employeeName: 'Bad SSN',
        ssn: 'not-an-ssn',
        type: 'HIRE',
        eventDate: '2026-08-01',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-events.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/events/route'`.

- [ ] **Step 4: Implement the route**

Create `src/app/api/employer/events/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { employmentEventSchema } from '@/lib/validation/employmentEvent';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = employmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED') {
    return apiError('Employer account is not verified', 403);
  }

  const ssnHash = hashSSN(parsed.data.ssn);
  // Whether a match was found is never returned to the caller (see the
  // spec's error-handling note): revealing that would let anyone probe
  // whether a given SSN belongs to a claimant in the system.
  const matchedClaimant = await prisma.claimantProfile.findUnique({ where: { ssnHash } });

  const event = await prisma.employmentEvent.create({
    data: {
      employerId: session!.user.employerProfileId,
      type: parsed.data.type,
      employeeName: parsed.data.employeeName,
      ssnHash,
      eventDate: new Date(parsed.data.eventDate),
      matchedClaimantProfileId: matchedClaimant?.id,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_REPORTED',
    targetEntity: 'EmploymentEvent',
    targetId: event.id,
    metadata: { type: parsed.data.type, matched: Boolean(matchedClaimant) },
  });

  return Response.json({ id: event.id }, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Add the event-reporting form to the dashboard**

In `src/app/employer/dashboard/page.tsx`, add these imports alongside the existing ones:

```tsx
import { Fieldset } from '@/components/ui/Fieldset';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
```

Add this state, alongside the existing state declarations at the top of the component:

```tsx
  const [employeeName, setEmployeeName] = useState('');
  const [ssn, setSsn] = useState('');
  const [eventType, setEventType] = useState('HIRE');
  const [eventDate, setEventDate] = useState('');
  const [eventErrors, setEventErrors] = useState<{ id: string; message: string }[]>([]);
  const [eventSuccess, setEventSuccess] = useState<string | null>(null);
```

Add this constant above the component function:

```tsx
const EVENT_TYPES = [
  { value: 'HIRE', label: 'Hire' },
  { value: 'SEPARATION', label: 'Separation' },
];
```

Add this handler alongside the existing `handleVerify`/`handleDispute` functions:

```tsx
  async function handleReportEvent(e: React.FormEvent) {
    e.preventDefault();
    setEventErrors([]);
    setEventSuccess(null);
    const res = await fetch('/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({ employeeName, ssn, type: eventType, eventDate }),
    });
    if (res.ok) {
      setEventSuccess('Event reported.');
      setEmployeeName('');
      setSsn('');
      setEventDate('');
      return;
    }
    const body = await res.json().catch(() => null);
    const fieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (fieldErrors) {
      const summary = Object.entries(fieldErrors)
        .filter(([, msgs]) => msgs?.[0])
        .map(([id, msgs]) => ({ id, message: msgs![0]! }));
      setEventErrors(summary);
      return;
    }
    setEventErrors([{ id: 'employeeName', message: body?.error ?? 'We could not report that event. Please try again.' }]);
  }
```

Add a new `<section>` immediately after the existing wage-records `<section>`, before the closing `</main>`:

```tsx
      <section className="border border-border rounded p-4 mt-6">
        <h2 className="font-medium mb-2">Report a hire or separation</h2>
        {eventSuccess && (
          <p role="status" className="mb-2 text-status-active-text">
            {eventSuccess}
          </p>
        )}
        <ErrorSummary errors={eventErrors} />
        <form onSubmit={handleReportEvent} noValidate>
          <TextField id="employeeName" label="Employee name" value={employeeName} onChange={setEmployeeName} required />
          <TextField id="ssn" label="Employee Social Security number (123-45-6789)" value={ssn} onChange={setSsn} required />
          <Fieldset legend="Event type" name="eventType" options={EVENT_TYPES} value={eventType} onChange={setEventType} />
          <TextField id="eventDate" label="Event date" type="date" value={eventDate} onChange={setEventDate} required />
          <Button type="submit">Report event</Button>
        </form>
      </section>
```

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, log in as a verified employer, submit the event-reporting form with an SSN matching the seeded claimant (`123-45-6789`, per `prisma/seed.ts`), and confirm the form clears and shows "Event reported." with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/employmentEvent.ts src/app/api/employer/events src/app/employer/dashboard/page.tsx tests/integration/employer-events.test.ts
git commit -m "Add employer hire/separation event reporting with claimant matching"
```

---

## Task 9: Surface matched events on the staff case-detail page

**Files:**
- Modify: `src/app/api/staff/claimants/[id]/route.ts`
- Modify: `src/app/staff/claimants/[id]/page.tsx`
- Test: `tests/integration/staff-claimants.test.ts`

**Interfaces:**
- Consumes: `EmploymentEvent.matchedClaimantProfileId` from Task 8.

- [ ] **Step 1: Add `matchedEmploymentEvents` to the GET route's select**

In `src/app/api/staff/claimants/[id]/route.ts`, in the `prisma.claimantProfile.findUnique` call's `select` block, add a field after the closing of `claims: { ... }`:

```ts
      matchedEmploymentEvents: {
        orderBy: { eventDate: 'desc' },
        select: {
          id: true,
          type: true,
          eventDate: true,
          employer: { select: { companyName: true } },
        },
      },
```

- [ ] **Step 2: Write a failing assertion**

Read `tests/integration/staff-claimants.test.ts` first to see its existing fixture setup for the single-claimant GET test. Add a fixture: create an `EmployerProfile` (verified, with a `companyName`) and an `EmploymentEvent` with `matchedClaimantProfileId` pointing at the test's claimant, in the same `beforeAll` block. In the existing single-claimant-fetch test, add an assertion:

```ts
    expect(claimant.matchedEmploymentEvents).toHaveLength(1);
    expect(claimant.matchedEmploymentEvents[0].type).toBe('HIRE');
```

Add FK-safe cleanup for the new `EmployerProfile`/`EmploymentEvent`/employer `User` rows to the file's existing `afterAll` block, following its established ordering pattern (delete `EmploymentEvent` rows before the `EmployerProfile` they reference, and the `EmployerProfile` before its `User`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: FAIL — `claimant.matchedEmploymentEvents` is `undefined`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the events on the case-detail page**

In `src/app/staff/claimants/[id]/page.tsx`, add a field to the `ClaimantDetail` type after `claims: {...}[];`:

```ts
  matchedEmploymentEvents: {
    id: string;
    type: 'HIRE' | 'SEPARATION';
    eventDate: string;
    employer: { companyName: string | null };
  }[];
```

Add a new `<section>` immediately after the SSN section (`</section>` that closes the "Social Security number" block) and before the `{claimant.claims.map(...)}` block:

```tsx
      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Employer-reported events</h2>
        {claimant.matchedEmploymentEvents.length === 0 ? (
          <p className="text-sm text-text-secondary">No employer-reported events on file.</p>
        ) : (
          <ul className="space-y-2">
            {claimant.matchedEmploymentEvents.map((event) => (
              <li key={event.id} className="text-sm border-t border-border pt-2">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'} by{' '}
                {event.employer.companyName ?? 'an employer'} on{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 6: Run the full unit + integration suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/staff/claimants/[id]/route.ts src/app/staff/claimants/[id]/page.tsx tests/integration/staff-claimants.test.ts
git commit -m "Surface employer-reported hire/separation events on the staff case-detail page"
```

---

## Task 10: E2E tests

**Files:**
- Create: `tests/e2e/employer-flow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1-9.

- [ ] **Step 1: Write the employer flow E2E test**

Create `tests/e2e/employer-flow.spec.ts`:

```ts
// tests/e2e/employer-flow.spec.ts
import { test, expect } from '@playwright/test';
import { prisma } from '../../src/lib/prisma';
import { hashSSN } from '../../src/lib/ssnHash';
import { waitForHydration } from './helpers';

const employerEmail = `e2e-employer-${Date.now()}@example.com`;
const employerPassword = 'E2EEmployerPass123';
const employerFein = '88-8888888';

let claimantUserId: string;
let claimantProfileId: string;
let claimId: string;
let wageRecordId: string;

test.beforeAll(async () => {
  const claimantUser = await prisma.user.create({
    data: {
      email: `e2e-employer-fixture-claimant-${Date.now()}@example.com`,
      passwordHash: 'x',
      role: 'CLAIMANT',
    },
  });
  claimantUserId = claimantUser.id;
  const profile = await prisma.claimantProfile.create({
    data: { userId: claimantUser.id, legalName: 'Employer Flow Fixture Claimant', ssnHash: hashSSN('321-54-9876') },
  });
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
  const wageRecord = await prisma.wageRecord.create({
    data: {
      claimId,
      employerName: 'E2E Test Employer',
      fein: employerFein,
      workLocation: 'Test City, MO',
      jobTitle: 'Tester',
      firstDayWorked: new Date('2024-01-01'),
      wageRate: 25,
      hoursPerWeek: 40,
      separationReason: 'Laid off',
      source: 'Simulated state wage database lookup',
    },
  });
  wageRecordId = wageRecord.id;
});

test('employer can sign up, verify FEIN, confirm a wage record, and report a hire matched to a claimant', async ({
  page,
}) => {
  await page.goto('/employer/signup');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill(employerEmail);
  await page.getByLabel('Password').fill(employerPassword);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/employer\/login/);

  await waitForHydration(page);
  await page.getByLabel('Email address').fill(employerEmail);
  await page.getByLabel('Password').fill(employerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/employer\/verify-fein/);

  await waitForHydration(page);
  await page.getByLabel(/FEIN/i).fill(employerFein);
  await page.getByLabel('Company name').fill('E2E Test Employer');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/employer\/dashboard/);

  await waitForHydration(page);
  await expect(page.getByText('E2E Test Employer').first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).first().click();
  await expect(page.getByText('✓ Confirmed')).toBeVisible();

  await page.getByLabel('Employee name').fill('Employer Flow Fixture Claimant');
  await page.getByLabel(/Social Security number/i).fill('321-54-9876');
  await page.getByLabel('Hire').check();
  await page.getByLabel('Event date').fill('2026-08-01');
  await page.getByRole('button', { name: 'Report event' }).click();
  await expect(page.getByText('Event reported.')).toBeVisible();

  const record = await prisma.wageRecord.findUnique({ where: { id: wageRecordId } });
  expect(record?.employerVerifiedStatus).toBe('VERIFIED');

  const event = await prisma.employmentEvent.findFirst({
    where: { matchedClaimantProfileId: claimantProfileId },
  });
  expect(event).not.toBeNull();
  expect(event?.type).toBe('HIRE');
});

test.afterAll(async () => {
  const employerUser = await prisma.user.findUnique({
    where: { email: employerEmail },
    include: { employerProfile: true },
  });
  if (employerUser?.employerProfile) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUser.id } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerUser.employerProfile.id } });
    await prisma.employerProfile.delete({ where: { id: employerUser.employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
  }
  await prisma.wageRecord.deleteMany({ where: { claimId } });
  await prisma.claim.delete({ where: { id: claimId } });
  await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
  await prisma.user.delete({ where: { id: claimantUserId } });
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run the E2E test to verify it passes in isolation**

Run: `rm -rf .next && npx playwright test employer-flow.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 3: Add accessibility scans for the new employer routes**

In `tests/e2e/accessibility.spec.ts`, add these tests inside the existing `PUBLIC_ROUTES`-style loop or as new standalone tests near the existing `/claim/signup`/`/staff/login` public-route tests (match whichever pattern the file currently uses for simple, no-fixture-needed public pages):

```ts
  test('/employer/signup has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/employer/signup');
    await expectNoViolations(page);
  });

  test('/employer/login has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/employer/login');
    await expectNoViolations(page);
  });
```

For the FEIN-gated dashboard/verify-fein pages, which need an authenticated session, follow the file's existing pattern for authenticated route groups (`test.describe` with `test.use({ storageState: ... })`) — read how the existing `claimant pages`/`staff pages` describe blocks set up their `storageState` fixtures in this same file's `beforeAll`, and add an equivalent `employer pages` describe block: create a verified `EmployerProfile` fixture and its logged-in `storageState` the same way the existing claimant/caseworker fixtures do, then add:

```ts
  test('/employer/verify-fein has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/employer/verify-fein');
    await expectNoViolations(page);
  });

  test('/employer/dashboard has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/employer/dashboard');
    await waitForHydration(page);
    await expectNoViolations(page);
  });
```

Add FK-safe cleanup for the new employer fixture (`EmployerProfile`, its `User`, any `EmploymentEvent`/audit rows it created) to the file's existing `afterAll` block.

- [ ] **Step 4: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`
Expected: All tests pass, including the new employer flow and accessibility scans.

- [ ] **Step 5: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/employer-flow.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "Add E2E tests for the employer portal flow and accessibility scans"
```
