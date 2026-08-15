# Employer Marketplace — First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first slice of the employer marketplace — candidate profiles, job postings, two-directional applications, and an employer-initiated hire that automatically creates an `EmploymentEvent`, restricts the claimant's active claims, and notifies them, with no SSN re-entry and no caseworker step.

**Architecture:** Additive to the existing Next.js 14 App Router / Prisma / PostgreSQL codebase. Three new models (`CandidateProfile`, `JobPosting`, `JobApplication`) extend the existing `ClaimantProfile`/`EmployerProfile`. The hire action runs as a single `prisma.$transaction`, using the same atomic compare-and-swap technique the unmatched-events queue's routes already established, extended to guard against a genuinely new race this feature introduces: two different pending applications on the same posting both being hired concurrently.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, PostgreSQL via Prisma, NextAuth.js, Zod, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- Follow every existing convention exactly: `requireRole` at the top of every API route; actor identity always derived from `session.user.id`, never client input.
- Zod validation schemas in `src/lib/validation/`, shared shape between client and server, for any multi-field content body (candidate profile, job posting). Simple ID-reference bodies (apply, reach-out) use plain presence checks, matching this codebase's existing convention of not over-using Zod for trivial single-field bodies.
- Every status-affecting write logs an `AuditLog` row via `writeAuditLog`.
- API routes use `apiError`/`invalidBody`/`parseJson` from `src/lib/apiRequest.ts`; Zod failures return `{ errors: parsed.error.flatten() }`, everything else `{ error: string }`.
- Prisma `select` blocks are always explicit — never `include` a relation that would ship unused PII/data. In particular: every employer-facing view of a candidate returns only `CandidateProfile` fields (`headline`/`skills`/`bio`/`availability`) — never the underlying `ClaimantProfile`'s legal name, SSN, DOB, address, or anything else, at any point before a hire actually happens (the hire route itself is the one place that legitimately reads `legalName`/`ssnHash`, server-side only, never returned in its response).
- WCAG 2.2 AA: semantic HTML, every status/warning uses icon + text + color (never color alone), every form field has a visible label and `aria-describedby` error association.
- axe-core scans every route in `tests/e2e/accessibility.spec.ts` — new pages must pass it.
- FEIN-ownership-style checks (does this `JobPosting`/`JobApplication` belong to the acting employer?) are written inline in each route, not extracted into a shared `rbac.ts` helper — same documented deviation as the existing employer wage-record routes, for the same reason (each check needs a DB lookup first, below the threshold that would justify a shared pure-function helper).
- **Design decision, carried from the spec:** creating a `CandidateProfile` requires `ClaimantProfile.identityVerificationStatus === 'VERIFIED'`. This isn't only a safety gate — it guarantees `ssnHash` is non-null, which the hire transaction needs.
- **Design decision, carried from the spec:** the hire route never asks for or hashes an SSN. It copies the claimant's own already-computed `ssnHash` directly onto the new `EmploymentEvent`.
- **Design decision, carried from the spec:** browsing (both directions) is a plain, unfiltered, most-recent-first list for this slice — no search, no pagination.
- **Design decision, made while writing this plan (not in the original spec, but necessary for correctness):** `JobApplication` gets a `@@unique([jobPostingId, candidateProfileId])` constraint, preventing a duplicate application/outreach for the same posting+candidate pair regardless of which side initiated it.

---

## Task 1: Schema — `CandidateProfile`, `JobPosting`, `JobApplication`

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: enums `JobPostingStatus` (`OPEN | FILLED`), `ApplicationInitiator` (`CANDIDATE | EMPLOYER`), `ApplicationStatus` (`PENDING | HIRED | REJECTED`); models `CandidateProfile`, `JobPosting`, `JobApplication`; `ClaimantProfile.candidateProfile: CandidateProfile?`; `EmployerProfile.jobPostings: JobPosting[]`.

- [ ] **Step 1: Add the three new enums**

In `prisma/schema.prisma`, add near the other enums (after `enum NameSuffix`):

```prisma
enum JobPostingStatus {
  OPEN
  FILLED
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
```

- [ ] **Step 2: Add the back-relations on existing models**

In `ClaimantProfile`, add a field after `matchedEmploymentEvents EmploymentEvent[]`:

```prisma
  candidateProfile CandidateProfile?
```

In `EmployerProfile`, add a field after `employmentEvents EmploymentEvent[]`:

```prisma
  jobPostings JobPosting[]
```

- [ ] **Step 3: Add the three new models**

Add at the end of `prisma/schema.prisma`:

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

model JobPosting {
  id          String           @id @default(cuid())
  employerId  String
  employer    EmployerProfile  @relation(fields: [employerId], references: [id])
  title       String
  description String
  location    String
  status      JobPostingStatus @default(OPEN)
  createdAt   DateTime         @default(now())

  applications JobApplication[]
}

model JobApplication {
  id                 String               @id @default(cuid())
  jobPostingId       String
  jobPosting         JobPosting           @relation(fields: [jobPostingId], references: [id])
  candidateProfileId String
  candidateProfile   CandidateProfile     @relation(fields: [candidateProfileId], references: [id])
  initiatedBy        ApplicationInitiator
  status             ApplicationStatus    @default(PENDING)
  createdAt          DateTime             @default(now())

  @@unique([jobPostingId, candidateProfileId])
}
```

- [ ] **Step 4: Run the migration**

Run: `npx prisma migrate dev --name add_employer_marketplace_slice`
Expected: Completes with no errors; a new migration directory appears under `prisma/migrations/`; Prisma Client regenerates. Open the generated `migration.sql` yourself and confirm it contains: three `CREATE TYPE` statements (the enums), three `CREATE TABLE` statements (`CandidateProfile`, `JobPosting`, `JobApplication`), the `@@unique([jobPostingId, candidateProfileId])` as a `CREATE UNIQUE INDEX`, and the foreign-key constraints for all four relations (`CandidateProfile.claimantProfileId`, `JobPosting.employerId`, `JobApplication.jobPostingId`, `JobApplication.candidateProfileId`). This codebase has repeatedly shipped incomplete migration files on schema tasks — if any of the above is missing, do not proceed; regenerate against a clean state before continuing.

- [ ] **Step 5: Write a failing schema smoke test**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block:

```ts
  it('can create and read back a CandidateProfile, JobPosting, and JobApplication', async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `schema-test-candidate-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CLAIMANT' },
    });
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `schema-test-hash-${Date.now()}` },
    });

    const employerUser = await prisma.user.create({
      data: { email: `schema-test-employer-marketplace-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: claimantProfile.id,
        headline: 'Warehouse associate',
        skills: 'Forklift certified, inventory management',
        availability: 'Immediate',
      },
    });
    expect(candidateProfile.bio).toBeNull();

    const jobPosting = await prisma.jobPosting.create({
      data: {
        employerId: employerProfile.id,
        title: 'Warehouse associate',
        description: 'Day shift, full time',
        location: 'Jefferson City, MO',
      },
    });
    expect(jobPosting.status).toBe('OPEN');

    const application = await prisma.jobApplication.create({
      data: {
        jobPostingId: jobPosting.id,
        candidateProfileId: candidateProfile.id,
        initiatedBy: 'CANDIDATE',
      },
    });
    expect(application.status).toBe('PENDING');

    await expect(
      prisma.jobApplication.create({
        data: {
          jobPostingId: jobPosting.id,
          candidateProfileId: candidateProfile.id,
          initiatedBy: 'EMPLOYER',
        },
      })
    ).rejects.toThrow();

    await prisma.jobApplication.delete({ where: { id: application.id } });
    await prisma.jobPosting.delete({ where: { id: jobPosting.id } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfile.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfile.id } });
    await prisma.user.delete({ where: { id: claimantUser.id } });
  });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/schema.test.ts
git commit -m "Add CandidateProfile, JobPosting, and JobApplication models"
```

---

## Task 2: Candidate profile

**Files:**
- Create: `src/lib/validation/candidateProfile.ts`
- Create: `src/app/api/candidate-profile/route.ts`
- Create: `src/app/claim/candidate-profile/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/integration/candidate-profile.test.ts`

**Interfaces:**
- Produces: `GET /api/candidate-profile` (own profile or 404); `POST /api/candidate-profile` (create own, 403 if not identity-verified, 409 if one already exists).

- [ ] **Step 1: Write the Zod schema**

Create `src/lib/validation/candidateProfile.ts`:

```ts
import { z } from 'zod';

export const candidateProfileSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  skills: z.string().min(1, 'Skills are required'),
  bio: z.string().optional(),
  availability: z.string().min(1, 'Availability is required'),
});

export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/candidate-profile.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as getOwnProfile, POST as createProfile } from '@/app/api/candidate-profile/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('candidate profile routes', () => {
  let verifiedUserId: string;
  let verifiedProfileId: string;
  let unverifiedUserId: string;
  let unverifiedProfileId: string;

  beforeAll(async () => {
    const verifiedUser = await prisma.user.create({
      data: { email: `candidate-verified-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    verifiedUserId = verifiedUser.id;
    const verifiedProfile = await prisma.claimantProfile.create({
      data: {
        userId: verifiedUser.id,
        legalName: 'Verified Candidate',
        ssnHash: `candidate-test-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    verifiedProfileId = verifiedProfile.id;

    const unverifiedUser = await prisma.user.create({
      data: { email: `candidate-unverified-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    unverifiedUserId = unverifiedUser.id;
    const unverifiedProfile = await prisma.claimantProfile.create({ data: { userId: unverifiedUser.id } });
    unverifiedProfileId = unverifiedProfile.id;
  });

  it('rejects creation for an unverified claimant with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: unverifiedUserId, role: 'CLAIMANT', claimantProfileId: unverifiedProfileId, email: 'unverified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Cook', skills: 'Line cooking', availability: 'Weekends' }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(403);
  });

  it('creates a candidate profile for a verified claimant', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: verifiedUserId, role: 'CLAIMANT', claimantProfileId: verifiedProfileId, email: 'verified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Warehouse associate', skills: 'Forklift certified', availability: 'Immediate' }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.headline).toBe('Warehouse associate');

    const getRes = await getOwnProfile();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.claimantProfileId).toBe(verifiedProfileId);
  });

  it('rejects a duplicate profile with 409', async () => {
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline: 'Another headline', skills: 'Other skills', availability: 'Flexible' }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(409);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [verifiedUserId, unverifiedUserId] } } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: verifiedProfileId } });
    await prisma.claimantProfile.delete({ where: { id: verifiedProfileId } });
    await prisma.user.delete({ where: { id: verifiedUserId } });
    await prisma.claimantProfile.delete({ where: { id: unverifiedProfileId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/candidate-profile.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/candidate-profile/route'`.

- [ ] **Step 4: Implement the route**

Create `src/app/api/candidate-profile/route.ts`:

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { candidateProfileSchema } from '@/lib/validation/candidateProfile';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const profile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
  });
  if (!profile) {
    return apiError('Candidate profile not found', 404);
  }

  return Response.json(profile);
}

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.claimantProfileId) {
    return apiError('Claimant profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = candidateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const claimantProfile = await prisma.claimantProfile.findUnique({
    where: { id: session!.user.claimantProfileId },
    select: { identityVerificationStatus: true },
  });
  if (!claimantProfile || claimantProfile.identityVerificationStatus !== 'VERIFIED') {
    return apiError('You must verify your identity before creating a candidate profile', 403);
  }

  let profile;
  try {
    profile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: session!.user.claimantProfileId,
        headline: parsed.data.headline,
        skills: parsed.data.skills,
        bio: parsed.data.bio,
        availability: parsed.data.availability,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('You already have a candidate profile', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CANDIDATE_PROFILE_CREATED',
    targetEntity: 'CandidateProfile',
    targetId: profile.id,
  });

  return Response.json(profile, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/candidate-profile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Create the candidate profile page**

Create `src/app/claim/candidate-profile/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

type CandidateProfile = {
  id: string;
  headline: string;
  skills: string;
  bio: string | null;
  availability: string;
};

export default function CandidateProfilePage() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [headline, setHeadline] = useState('');
  const [skills, setSkills] = useState('');
  const [bio, setBio] = useState('');
  const [availability, setAvailability] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    fetch('/api/candidate-profile')
      .then((res) => (res.ok ? res.json() : null))
      .then(setProfile)
      .finally(() => setLoading(false));
  }, [status, session?.user.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline, skills, bio: bio || undefined, availability }),
    });
    if (res.ok) {
      setProfile(await res.json());
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (!messages?.[0]) continue;
        nextFieldErrors[field] = messages[0];
        summary.push({ id: field, message: messages[0] });
      }
      setFieldErrors(nextFieldErrors);
      setErrors(summary);
      return;
    }
    setErrors([{ id: 'headline', message: body?.error ?? 'We could not save your profile. Please try again.' }]);
  }

  if (status === 'loading' || loading) {
    return (
      <main id="main-content" className="max-w-2xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') {
    return (
      <main id="main-content" className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Candidate profile</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to build your candidate profile.
        </p>
      </main>
    );
  }

  if (profile) {
    return (
      <main id="main-content" className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Your candidate profile</h1>
        <dl className="space-y-2">
          <dt className="font-medium">Headline</dt>
          <dd>{profile.headline}</dd>
          <dt className="font-medium">Skills</dt>
          <dd>{profile.skills}</dd>
          <dt className="font-medium">Availability</dt>
          <dd>{profile.availability}</dd>
          {profile.bio && (
            <>
              <dt className="font-medium">Bio</dt>
              <dd>{profile.bio}</dd>
            </>
          )}
        </dl>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Build your candidate profile</h1>
      <p className="mb-4 text-text-secondary">
        Employers browsing the marketplace will see your headline, skills, availability, and
        bio — never your Social Security number, date of birth, or mailing address.
      </p>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField id="headline" label="Headline" value={headline} onChange={setHeadline} error={fieldErrors.headline} required />
        <TextField id="skills" label="Skills" value={skills} onChange={setSkills} error={fieldErrors.skills} required />
        <TextField id="availability" label="Availability" value={availability} onChange={setAvailability} error={fieldErrors.availability} required />
        <TextField id="bio" label="Bio (optional)" value={bio} onChange={setBio} error={fieldErrors.bio} />
        <Button type="submit">Save profile</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Add a nav link**

In `src/components/layout/AppNav.tsx`, change:

```ts
const CLAIMANT_LINKS: NavLink[] = [
  { href: '/claim/dashboard', label: 'Dashboard' },
  { href: '/claim/new', label: 'File a claim' },
  { href: '/claim/verify-identity', label: 'Verify your identity' },
  { href: '/claim/messages', label: 'Messages' },
];
```

to:

```ts
const CLAIMANT_LINKS: NavLink[] = [
  { href: '/claim/dashboard', label: 'Dashboard' },
  { href: '/claim/new', label: 'File a claim' },
  { href: '/claim/verify-identity', label: 'Verify your identity' },
  { href: '/claim/messages', label: 'Messages' },
  { href: '/claim/candidate-profile', label: 'Candidate profile' },
];
```

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/candidateProfile.ts src/app/api/candidate-profile src/app/claim/candidate-profile src/components/layout/AppNav.tsx tests/integration/candidate-profile.test.ts
git commit -m "Add candidate profile creation, gated on identity verification"
```

---

## Task 3: Job posting creation

**Files:**
- Create: `src/lib/validation/jobPosting.ts`
- Create: `src/app/api/employer/job-postings/route.ts`
- Create: `src/app/employer/job-postings/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/integration/employer-job-postings.test.ts`

**Interfaces:**
- Produces: `GET /api/employer/job-postings` (own postings); `POST /api/employer/job-postings` (create, FEIN-verification gated). Consumed by Task 6 (posting-detail page links here) and Task 5 (reach-out form needs the employer's own open postings).

- [ ] **Step 1: Write the Zod schema**

Create `src/lib/validation/jobPosting.ts`:

```ts
import { z } from 'zod';

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/employer-job-postings.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listOwnPostings, POST as createPosting } from '@/app/api/employer/job-postings/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer job posting routes', () => {
  let verifiedUserId: string;
  let verifiedProfileId: string;
  let unverifiedUserId: string;
  let unverifiedProfileId: string;

  beforeAll(async () => {
    const verifiedUser = await prisma.user.create({
      data: { email: `posting-employer-verified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    verifiedUserId = verifiedUser.id;
    const verifiedProfile = await prisma.employerProfile.create({
      data: { userId: verifiedUser.id, fein: '71-2233445', companyName: 'Posting Test Co', verificationStatus: 'VERIFIED' },
    });
    verifiedProfileId = verifiedProfile.id;

    const unverifiedUser = await prisma.user.create({
      data: { email: `posting-employer-unverified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    unverifiedUserId = unverifiedUser.id;
    const unverifiedProfile = await prisma.employerProfile.create({ data: { userId: unverifiedUser.id } });
    unverifiedProfileId = unverifiedProfile.id;
  });

  it('rejects posting creation for an unverified employer with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: unverifiedUserId, role: 'EMPLOYER', employerProfileId: unverifiedProfileId, email: 'unverified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Cook', description: 'Line cook', location: 'St. Louis, MO' }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(403);
  });

  it('creates a job posting for a verified employer', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: verifiedUserId, role: 'EMPLOYER', employerProfileId: verifiedProfileId, email: 'verified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Warehouse associate', description: 'Day shift', location: 'Jefferson City, MO' }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('OPEN');

    const listRes = await listOwnPostings();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Warehouse associate');
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [verifiedUserId, unverifiedUserId] } } });
    await prisma.jobPosting.deleteMany({ where: { employerId: verifiedProfileId } });
    await prisma.employerProfile.delete({ where: { id: verifiedProfileId } });
    await prisma.user.delete({ where: { id: verifiedUserId } });
    await prisma.employerProfile.delete({ where: { id: unverifiedProfileId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-job-postings.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/job-postings/route'`.

- [ ] **Step 4: Implement the route**

Create `src/app/api/employer/job-postings/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { jobPostingSchema } from '@/lib/validation/jobPosting';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const postings = await prisma.jobPosting.findMany({
    where: { employerId: session!.user.employerProfileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      status: true,
      createdAt: true,
    },
  });

  return Response.json(postings);
}

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

  const parsed = jobPostingSchema.safeParse(body);
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

  const posting = await prisma.jobPosting.create({
    data: {
      employerId: session!.user.employerProfileId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_POSTING_CREATED',
    targetEntity: 'JobPosting',
    targetId: posting.id,
  });

  return Response.json(posting, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-job-postings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the job postings page**

Create `src/app/employer/job-postings/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

type JobPosting = {
  id: string;
  title: string;
  description: string;
  location: string;
  status: 'OPEN' | 'FILLED';
  createdAt: string;
};

export default function JobPostingsPage() {
  const { data: session, status } = useSession();
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function loadPostings() {
    const res = await fetch('/api/employer/job-postings');
    if (!res.ok) {
      setLoadError('We could not load your job postings. Please try again.');
      return;
    }
    setPostings(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadPostings();
  }, [status, session?.user.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title, description, location }),
    });
    if (res.ok) {
      setTitle('');
      setDescription('');
      setLocation('');
      await loadPostings();
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (!messages?.[0]) continue;
        nextFieldErrors[field] = messages[0];
        summary.push({ id: field, message: messages[0] });
      }
      setFieldErrors(nextFieldErrors);
      setErrors(summary);
      return;
    }
    setErrors([{ id: 'title', message: body?.error ?? 'We could not create that posting. Please try again.' }]);
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Job postings</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to manage job postings.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Job postings</h1>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Post a job</h2>
        <ErrorSummary errors={errors} />
        <form onSubmit={handleSubmit} noValidate>
          <TextField id="title" label="Title" value={title} onChange={setTitle} error={fieldErrors.title} required />
          <TextField id="description" label="Description" value={description} onChange={setDescription} error={fieldErrors.description} required />
          <TextField id="location" label="Location" value={location} onChange={setLocation} error={fieldErrors.location} required />
          <Button type="submit">Post job</Button>
        </form>
      </section>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Your postings</h2>
        {loadError && (
          <p role="alert" className="mb-2 text-error-text">
            {loadError}
          </p>
        )}
        {postings === null && !loadError && <p>Loading…</p>}
        {postings !== null && postings.length === 0 && (
          <p className="text-sm text-text-secondary">You haven&apos;t posted any jobs yet.</p>
        )}
        {postings !== null && postings.length > 0 && (
          <ul className="space-y-3">
            {postings.map((p) => (
              <li key={p.id} className="border-t border-border pt-3 text-sm">
                <p className="font-medium">{p.title}</p>
                <p className="text-text-secondary mb-1">
                  {p.location} — {p.status === 'OPEN' ? 'Open' : 'Filled'}
                </p>
                <Link href={`/employer/job-postings/${p.id}`} className="text-link underline">
                  View applications
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Add a nav link**

In `src/components/layout/AppNav.tsx`, change:

```ts
const EMPLOYER_LINKS: NavLink[] = [
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/verify-fein', label: 'Verify your company' },
];
```

to:

```ts
const EMPLOYER_LINKS: NavLink[] = [
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/verify-fein', label: 'Verify your company' },
  { href: '/employer/job-postings', label: 'Job postings' },
];
```

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/jobPosting.ts src/app/api/employer/job-postings src/app/employer/job-postings/page.tsx src/components/layout/AppNav.tsx tests/integration/employer-job-postings.test.ts
git commit -m "Add job posting creation, gated on FEIN verification"
```

---

## Task 4: Claimant browse postings and apply

**Files:**
- Create: `src/app/api/job-postings/route.ts`
- Create: `src/app/api/job-applications/route.ts`
- Create: `src/app/claim/browse-postings/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/integration/browse-and-apply.test.ts`

**Interfaces:**
- Consumes: `CandidateProfile` from Task 2, `JobPosting` from Task 3.
- Produces: `GET /api/job-postings` (all `OPEN` postings, public to any authenticated claimant); `POST /api/job-applications` (apply, `initiatedBy: 'CANDIDATE'`).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/browse-and-apply.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listOpenPostings } from '@/app/api/job-postings/route';
import { POST as applyToPosting } from '@/app/api/job-applications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('claimant browse and apply', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let openPostingId: string;
  let filledPostingId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `browse-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `browse-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Retail associate', skills: 'POS systems', availability: 'Immediate' },
    });
    candidateProfileId = candidateProfile.id;

    const employerUser = await prisma.user.create({
      data: { email: `browse-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '82-3344556', companyName: 'Browse Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const openPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Retail associate', description: 'Front of store', location: 'Columbia, MO' },
    });
    openPostingId = openPosting.id;

    const filledPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Already filled', description: 'N/A', location: 'Columbia, MO', status: 'FILLED' },
    });
    filledPostingId = filledPosting.id;
  });

  it('lists only OPEN postings', async () => {
    const res = await listOpenPostings();
    expect(res.status).toBe(200);
    const postings = await res.json();
    const ids = postings.map((p: { id: string }) => p.id);
    expect(ids).toContain(openPostingId);
    expect(ids).not.toContain(filledPostingId);
  });

  it('creates an application when a candidate applies', async () => {
    const req = new Request('http://localhost/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: openPostingId }),
    });
    const res = await applyToPosting(req);
    expect(res.status).toBe(201);

    const application = await prisma.jobApplication.findFirst({
      where: { jobPostingId: openPostingId, candidateProfileId },
    });
    expect(application?.initiatedBy).toBe('CANDIDATE');
    expect(application?.status).toBe('PENDING');
  });

  it('rejects a duplicate application with 409', async () => {
    const req = new Request('http://localhost/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: openPostingId }),
    });
    const res = await applyToPosting(req);
    expect(res.status).toBe(409);
  });

  it('rejects applying to a non-OPEN posting with 400', async () => {
    const req = new Request('http://localhost/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: filledPostingId }),
    });
    const res = await applyToPosting(req);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [claimantUserId, employerUserId] } } });
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/browse-and-apply.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/job-postings/route'`.

- [ ] **Step 3: Implement the browse route**

Create `src/app/api/job-postings/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const postings = await prisma.jobPosting.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      createdAt: true,
      employer: { select: { companyName: true } },
    },
  });

  return Response.json(postings);
}
```

- [ ] **Step 4: Implement the apply route**

Create `src/app/api/job-applications/route.ts`:

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.claimantProfileId) {
    return apiError('Claimant profile not found', 404);
  }

  const body = await parseJson<{ jobPostingId?: string }>(req);
  if (!body) return invalidBody();
  const { jobPostingId } = body;
  if (!jobPostingId) {
    return apiError('jobPostingId is required', 400);
  }

  const candidateProfile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
    select: { id: true },
  });
  if (!candidateProfile) {
    return apiError('You need a candidate profile before you can apply', 404);
  }

  const posting = await prisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { status: true },
  });
  if (!posting) {
    return apiError('Job posting not found', 404);
  }
  if (posting.status !== 'OPEN') {
    return apiError('This job posting is no longer accepting applications', 400);
  }

  let application;
  try {
    application = await prisma.jobApplication.create({
      data: { jobPostingId, candidateProfileId: candidateProfile.id, initiatedBy: 'CANDIDATE' },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('You have already applied to this posting', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_SUBMITTED',
    targetEntity: 'JobApplication',
    targetId: application.id,
  });

  return Response.json(application, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/browse-and-apply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Create the browse-postings page**

Create `src/app/claim/browse-postings/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type JobPosting = {
  id: string;
  title: string;
  description: string;
  location: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function BrowsePostingsPage() {
  const { data: session, status } = useSession();
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  async function loadPostings() {
    const res = await fetch('/api/job-postings');
    if (!res.ok) {
      setLoadError('We could not load job postings. Please try again.');
      return;
    }
    setPostings(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    loadPostings();
  }, [status, session?.user.role]);

  async function handleApply(jobPostingId: string) {
    setActionError(null);
    const res = await fetch('/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error ?? 'We could not submit your application. Please try again.');
      return;
    }
    setAppliedIds((prev) => new Set(prev).add(jobPostingId));
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Job postings</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to browse job postings.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Job postings</h1>
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
      {postings === null && !loadError && <p>Loading…</p>}
      {postings !== null && postings.length === 0 && (
        <p className="text-sm text-text-secondary">No open postings right now.</p>
      )}
      {postings !== null && postings.length > 0 && (
        <ul className="space-y-4">
          {postings.map((p) => (
            <li key={p.id} className="border border-border rounded p-4">
              <p className="font-medium">{p.title}</p>
              <p className="text-sm text-text-secondary mb-2">
                {p.employer.companyName ?? 'An employer'} — {p.location}
              </p>
              <p className="text-sm mb-2">{p.description}</p>
              {appliedIds.has(p.id) ? (
                <p role="status" className="text-status-active-text font-medium">
                  ✓ Applied
                </p>
              ) : (
                <Button onClick={() => handleApply(p.id)}>Apply</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Add a nav link**

In `src/components/layout/AppNav.tsx`, change:

```ts
const CLAIMANT_LINKS: NavLink[] = [
  { href: '/claim/dashboard', label: 'Dashboard' },
  { href: '/claim/new', label: 'File a claim' },
  { href: '/claim/verify-identity', label: 'Verify your identity' },
  { href: '/claim/messages', label: 'Messages' },
  { href: '/claim/candidate-profile', label: 'Candidate profile' },
];
```

to:

```ts
const CLAIMANT_LINKS: NavLink[] = [
  { href: '/claim/dashboard', label: 'Dashboard' },
  { href: '/claim/new', label: 'File a claim' },
  { href: '/claim/verify-identity', label: 'Verify your identity' },
  { href: '/claim/messages', label: 'Messages' },
  { href: '/claim/candidate-profile', label: 'Candidate profile' },
  { href: '/claim/browse-postings', label: 'Job postings' },
];
```

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/job-postings src/app/api/job-applications src/app/claim/browse-postings src/components/layout/AppNav.tsx tests/integration/browse-and-apply.test.ts
git commit -m "Add claimant browse-and-apply flow for job postings"
```

---

## Task 5: Employer browse candidates and reach out

**Files:**
- Create: `src/app/api/employer/candidates/route.ts`
- Create: `src/app/api/employer/job-applications/route.ts`
- Create: `src/app/employer/browse-candidates/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/integration/employer-browse-and-outreach.test.ts`

**Interfaces:**
- Consumes: `CandidateProfile` from Task 2, `JobPosting` from Task 3.
- Produces: `GET /api/employer/candidates` (all candidate profiles, PII-minimal); `POST /api/employer/job-applications` (reach out, `initiatedBy: 'EMPLOYER'`).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/employer-browse-and-outreach.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listCandidates } from '@/app/api/employer/candidates/route';
import { POST as reachOut } from '@/app/api/employer/job-applications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer browse candidates and reach out', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let otherEmployerUserId: string;
  let otherEmployerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let openPostingId: string;
  let otherEmployerPostingId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `outreach-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '93-4455667', companyName: 'Outreach Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const openPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Retail associate', description: 'Front of store', location: 'Columbia, MO' },
    });
    openPostingId = openPosting.id;

    const otherEmployerUser = await prisma.user.create({
      data: { email: `outreach-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    otherEmployerUserId = otherEmployerUser.id;
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, fein: '94-5566778', companyName: 'Other Co', verificationStatus: 'VERIFIED' },
    });
    otherEmployerProfileId = otherEmployerProfile.id;
    const otherEmployerPosting = await prisma.jobPosting.create({
      data: { employerId: otherEmployerProfileId, title: 'Not mine', description: 'N/A', location: 'Elsewhere' },
    });
    otherEmployerPostingId = otherEmployerPosting.id;

    const claimantUser = await prisma.user.create({
      data: { email: `outreach-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName: 'Outreach Target',
        ssnHash: `outreach-test-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Retail associate', skills: 'POS systems', availability: 'Immediate' },
    });
    candidateProfileId = candidateProfile.id;
  });

  it('lists candidate profiles without leaking claimant PII', async () => {
    const res = await listCandidates();
    expect(res.status).toBe(200);
    const candidates = await res.json();
    const target = candidates.find((c: { id: string }) => c.id === candidateProfileId);
    expect(target.headline).toBe('Retail associate');
    expect(target.legalName).toBeUndefined();
    expect(target.ssnHash).toBeUndefined();
    expect(target.claimantProfileId).toBeUndefined();
  });

  it('creates an outreach application against the employer own posting', async () => {
    const req = new Request('http://localhost/api/employer/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: openPostingId, candidateProfileId }),
    });
    const res = await reachOut(req);
    expect(res.status).toBe(201);

    const application = await prisma.jobApplication.findFirst({
      where: { jobPostingId: openPostingId, candidateProfileId },
    });
    expect(application?.initiatedBy).toBe('EMPLOYER');
  });

  it('rejects reaching out against a posting belonging to a different employer with 403', async () => {
    const req = new Request('http://localhost/api/employer/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId: otherEmployerPostingId, candidateProfileId }),
    });
    const res = await reachOut(req);
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, otherEmployerUserId] } } });
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.deleteMany({ where: { employerId: { in: [employerProfileId, otherEmployerProfileId] } } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfileId } });
    await prisma.user.delete({ where: { id: otherEmployerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-browse-and-outreach.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/candidates/route'`.

- [ ] **Step 3: Implement the browse-candidates route**

Create `src/app/api/employer/candidates/route.ts`:

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

  const candidates = await prisma.candidateProfile.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
      createdAt: true,
    },
  });

  return Response.json(candidates);
}
```

- [ ] **Step 4: Implement the reach-out route**

Create `src/app/api/employer/job-applications/route.ts`:

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
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

  const body = await parseJson<{ jobPostingId?: string; candidateProfileId?: string }>(req);
  if (!body) return invalidBody();
  const { jobPostingId, candidateProfileId } = body;
  if (!jobPostingId || !candidateProfileId) {
    return apiError('jobPostingId and candidateProfileId are required', 400);
  }

  const posting = await prisma.jobPosting.findUnique({
    where: { id: jobPostingId },
    select: { employerId: true, status: true },
  });
  if (!posting) {
    return apiError('Job posting not found', 404);
  }
  if (posting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (posting.status !== 'OPEN') {
    return apiError('This job posting is no longer open', 400);
  }

  const candidate = await prisma.candidateProfile.findUnique({
    where: { id: candidateProfileId },
    select: { id: true },
  });
  if (!candidate) {
    return apiError('Candidate not found', 404);
  }

  let application;
  try {
    application = await prisma.jobApplication.create({
      data: { jobPostingId, candidateProfileId, initiatedBy: 'EMPLOYER' },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('You have already reached out to this candidate for this posting', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_EMPLOYER_OUTREACH',
    targetEntity: 'JobApplication',
    targetId: application.id,
  });

  return Response.json(application, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-browse-and-outreach.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Create the browse-candidates page**

Create `src/app/employer/browse-candidates/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type Candidate = {
  id: string;
  headline: string;
  skills: string;
  bio: string | null;
  availability: string;
};

type JobPosting = {
  id: string;
  title: string;
  status: 'OPEN' | 'FILLED';
};

export default function BrowseCandidatesPage() {
  const { data: session, status } = useSession();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [selectedPostingId, setSelectedPostingId] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reachedOutIds, setReachedOutIds] = useState<Set<string>>(new Set());

  async function loadData() {
    const [candidatesRes, postingsRes] = await Promise.all([
      fetch('/api/employer/candidates'),
      fetch('/api/employer/job-postings'),
    ]);
    if (!candidatesRes.ok || !postingsRes.ok) {
      setLoadError('We could not load candidates. Please try again.');
      return;
    }
    setCandidates(await candidatesRes.json());
    setPostings((await postingsRes.json()).filter((p: JobPosting) => p.status === 'OPEN'));
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadData();
  }, [status, session?.user.role]);

  async function handleReachOut(candidateProfileId: string) {
    const jobPostingId = selectedPostingId[candidateProfileId];
    if (!jobPostingId) {
      setActionError('Choose a posting before reaching out.');
      return;
    }
    setActionError(null);
    const res = await fetch('/api/employer/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId, candidateProfileId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error ?? 'We could not reach out to this candidate. Please try again.');
      return;
    }
    setReachedOutIds((prev) => new Set(prev).add(candidateProfileId));
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Browse candidates</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to browse candidates.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Browse candidates</h1>
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
      {postings !== null && postings.length === 0 && (
        <p className="mb-4 text-sm text-text-secondary">
          You need at least one open job posting before you can reach out to a candidate.
        </p>
      )}
      {candidates === null && !loadError && <p>Loading…</p>}
      {candidates !== null && candidates.length === 0 && (
        <p className="text-sm text-text-secondary">No candidates on the marketplace yet.</p>
      )}
      {candidates !== null && candidates.length > 0 && (
        <ul className="space-y-4">
          {candidates.map((c) => (
            <li key={c.id} className="border border-border rounded p-4">
              <p className="font-medium">{c.headline}</p>
              <p className="text-sm text-text-secondary mb-1">Skills: {c.skills}</p>
              <p className="text-sm text-text-secondary mb-2">Availability: {c.availability}</p>
              {c.bio && <p className="text-sm mb-2">{c.bio}</p>}
              {reachedOutIds.has(c.id) ? (
                <p role="status" className="text-status-active-text font-medium">
                  ✓ Reached out
                </p>
              ) : postings !== null && postings.length > 0 ? (
                <div className="flex items-end gap-3">
                  <div className="mb-4">
                    <label htmlFor={`posting-${c.id}`} className="block font-medium text-text-primary mb-1">
                      For which posting?
                    </label>
                    <select
                      id={`posting-${c.id}`}
                      value={selectedPostingId[c.id] ?? ''}
                      onChange={(e) =>
                        setSelectedPostingId((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      className="w-full rounded border border-border px-3 py-2"
                    >
                      <option value="">Select a posting</option>
                      {postings.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button onClick={() => handleReachOut(c.id)}>Reach out</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Add a nav link**

In `src/components/layout/AppNav.tsx`, change:

```ts
const EMPLOYER_LINKS: NavLink[] = [
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/verify-fein', label: 'Verify your company' },
  { href: '/employer/job-postings', label: 'Job postings' },
];
```

to:

```ts
const EMPLOYER_LINKS: NavLink[] = [
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/verify-fein', label: 'Verify your company' },
  { href: '/employer/job-postings', label: 'Job postings' },
  { href: '/employer/browse-candidates', label: 'Browse candidates' },
];
```

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/employer/candidates src/app/api/employer/job-applications src/app/employer/browse-candidates src/components/layout/AppNav.tsx tests/integration/employer-browse-and-outreach.test.ts
git commit -m "Add employer browse-candidates and outreach flow"
```

---

## Task 6: Employer application review and reject

**Files:**
- Create: `src/app/api/employer/job-postings/[id]/applications/route.ts`
- Create: `src/app/api/employer/job-applications/[id]/reject/route.ts`
- Create: `src/app/employer/job-postings/[id]/page.tsx`
- Test: `tests/integration/employer-application-review.test.ts`

**Interfaces:**
- Consumes: `JobApplication`/`JobPosting` from Tasks 1, 3, 4, 5.
- Produces: `GET /api/employer/job-postings/[id]/applications`; `POST /api/employer/job-applications/[id]/reject`. Produces the posting-detail page Task 7 extends with a Hire button.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/employer-application-review.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listApplications } from '@/app/api/employer/job-postings/[id]/applications/route';
import { POST as rejectApplication } from '@/app/api/employer/job-applications/[id]/reject/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer application review', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let otherEmployerUserId: string;
  let otherEmployerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let postingId: string;
  let applicationId: string;
  let alreadyResolvedApplicationId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `review-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '15-9988776', companyName: 'Review Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otherEmployerUser = await prisma.user.create({
      data: { email: `review-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    otherEmployerUserId = otherEmployerUser.id;
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, fein: '16-8877665', companyName: 'Other Review Co', verificationStatus: 'VERIFIED' },
    });
    otherEmployerProfileId = otherEmployerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `review-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `review-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Applicant', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Reviewed posting', description: 'N/A', location: 'Springfield, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;

    const secondCandidateUser = await prisma.user.create({
      data: { email: `review-claimant-2-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const secondClaimantProfile = await prisma.claimantProfile.create({
      data: { userId: secondCandidateUser.id, ssnHash: `review-test-hash-2-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    const secondCandidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId: secondClaimantProfile.id, headline: 'Second applicant', skills: 'Various', availability: 'Now' },
    });
    const alreadyResolvedApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId: secondCandidateProfile.id, initiatedBy: 'CANDIDATE', status: 'REJECTED' },
    });
    alreadyResolvedApplicationId = alreadyResolvedApplication.id;
  });

  it('lists applications for the employer own posting, without claimant PII', async () => {
    const res = await listApplications(
      new Request(`http://localhost/api/employer/job-postings/${postingId}/applications`),
      { params: { id: postingId } }
    );
    expect(res.status).toBe(200);
    const applications = await res.json();
    expect(applications).toHaveLength(2);
    const target = applications.find((a: { id: string }) => a.id === applicationId);
    expect(target.candidateProfile.headline).toBe('Applicant');
    expect(target.candidateProfile.legalName).toBeUndefined();
  });

  it('rejects an application', async () => {
    const res = await rejectApplication(
      new Request(`http://localhost/api/employer/job-applications/${applicationId}/reject`, { method: 'POST' }),
      { params: { id: applicationId } }
    );
    expect(res.status).toBe(200);

    const updated = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    expect(updated?.status).toBe('REJECTED');
  });

  it('returns 409 rejecting an already-resolved application', async () => {
    const res = await rejectApplication(
      new Request(`http://localhost/api/employer/job-applications/${alreadyResolvedApplicationId}/reject`, { method: 'POST' }),
      { params: { id: alreadyResolvedApplicationId } }
    );
    expect(res.status).toBe(409);
  });

  it('rejects listing applications for a posting belonging to a different employer with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherEmployerUserId, role: 'EMPLOYER', employerProfileId: otherEmployerProfileId, email: otherEmployerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listApplications(
      new Request(`http://localhost/api/employer/job-postings/${postingId}/applications`),
      { params: { id: postingId } }
    );
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, otherEmployerUserId] } } });
    await prisma.jobApplication.deleteMany({ where: { jobPostingId: postingId } });
    await prisma.jobPosting.delete({ where: { id: postingId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    const secondClaimant = await prisma.claimantProfile.findFirst({ where: { candidateProfile: { headline: 'Second applicant' } } });
    if (secondClaimant) {
      await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: secondClaimant.id } });
      await prisma.user.delete({ where: { id: secondClaimant.userId } });
      await prisma.claimantProfile.delete({ where: { id: secondClaimant.id } });
    }
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfileId } });
    await prisma.user.delete({ where: { id: otherEmployerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-application-review.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/job-postings/[id]/applications/route'`.

- [ ] **Step 3: Implement the applications-list route**

Create `src/app/api/employer/job-postings/[id]/applications/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const posting = await prisma.jobPosting.findUnique({
    where: { id: params.id },
    select: { employerId: true, title: true, status: true },
  });
  if (!posting) {
    return apiError('Job posting not found', 404);
  }
  if (posting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }

  const applications = await prisma.jobApplication.findMany({
    where: { jobPostingId: params.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      initiatedBy: true,
      createdAt: true,
      candidateProfile: {
        select: { headline: true, skills: true, bio: true, availability: true },
      },
    },
  });

  return Response.json(applications);
}
```

- [ ] **Step 4: Implement the reject route**

Create `src/app/api/employer/job-applications/[id]/reject/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: { status: true, jobPosting: { select: { employerId: true } } },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }
  if (application.jobPosting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (application.status !== 'PENDING') {
    return apiError('This application has already been resolved', 409);
  }

  // Atomic compare-and-swap, matching the pattern already established by the
  // unmatched-events queue's routes: the findUnique check above is still
  // needed for the 404/403/fast-path-409 responses, but the write itself is
  // guarded against a concurrent Hire on this same application racing past
  // that check.
  const updated = await prisma.jobApplication.updateMany({
    where: { id: params.id, status: 'PENDING' },
    data: { status: 'REJECTED' },
  });
  if (updated.count === 0) {
    return apiError('This application has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_REJECTED',
    targetEntity: 'JobApplication',
    targetId: params.id,
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-application-review.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Create the posting-detail page**

Create `src/app/employer/job-postings/[id]/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type Application = {
  id: string;
  status: 'PENDING' | 'HIRED' | 'REJECTED';
  initiatedBy: 'CANDIDATE' | 'EMPLOYER';
  createdAt: string;
  candidateProfile: {
    headline: string;
    skills: string;
    bio: string | null;
    availability: string;
  };
};

export default function JobPostingDetailPage({ params }: { params: { id: string } }) {
  const { data: session, status } = useSession();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadApplications() {
    setLoadError(null);
    const res = await fetch(`/api/employer/job-postings/${params.id}/applications`);
    if (!res.ok) {
      setLoadError('We could not load applications for this posting. Please try again.');
      return;
    }
    setApplications(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadApplications();
  }, [status, session?.user.role]);

  async function handleReject(id: string) {
    setActionError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/employer/job-applications/${id}/reject`, { method: 'POST' });
      if (!res.ok) {
        setActionError(
          res.status === 409
            ? 'This application was already resolved.'
            : 'We could not reject this application. Please try again.'
        );
        if (res.status === 409) await loadApplications();
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Applications</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to review applications.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Applications</h1>
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
      {applications === null && !loadError && <p>Loading…</p>}
      {applications !== null && applications.length === 0 && (
        <p className="text-sm text-text-secondary">No applications for this posting yet.</p>
      )}
      {applications !== null && applications.length > 0 && (
        <ul className="space-y-4">
          {applications.map((a) => (
            <li key={a.id} className="border border-border rounded p-4">
              <p className="font-medium">{a.candidateProfile.headline}</p>
              <p className="text-sm text-text-secondary mb-1">Skills: {a.candidateProfile.skills}</p>
              <p className="text-sm text-text-secondary mb-2">Availability: {a.candidateProfile.availability}</p>
              {a.status === 'PENDING' && (
                <div className="flex gap-3">
                  <Button disabled={pendingId === a.id} onClick={() => handleReject(a.id)} variant="secondary">
                    Reject
                  </Button>
                </div>
              )}
              {a.status === 'HIRED' && (
                <p role="status" className="text-status-active-text font-medium">
                  ✓ Hired
                </p>
              )}
              {a.status === 'REJECTED' && (
                <p role="status" className="text-text-secondary font-medium">
                  — Rejected
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/employer/job-postings/[id]/applications src/app/api/employer/job-applications/[id]/reject src/app/employer/job-postings/[id]/page.tsx tests/integration/employer-application-review.test.ts
git commit -m "Add employer application review and reject action"
```

---

## Task 7: The hire transaction

**Files:**
- Create: `src/app/api/employer/job-applications/[id]/hire/route.ts`
- Modify: `src/app/employer/job-postings/[id]/page.tsx`
- Test: `tests/integration/employer-hire.test.ts`

**Interfaces:**
- Consumes: `JobApplication`/`JobPosting`/`CandidateProfile` from prior tasks; `Claim`, `EmploymentEvent`, `Message`, `AuditLog` (all pre-existing models).
- Produces: `POST /api/employer/job-applications/[id]/hire`.

This is the most consequential route in this plan — read this task's brief carefully before writing any code, especially the race-condition reasoning below. Do not simplify the transaction's step order; it's shaped the way it is for a specific correctness reason, not by accident.

**The race this route must prevent:** two different `PENDING` applications on the *same* posting could both pass an ownership/status check and both be hired concurrently if the only compare-and-swap guard is on the individual `JobApplication` row. Since a `JobPosting` can only ever have one true hire, the *posting* itself — not the individual application — is the actual contended resource. This task's transaction therefore gates on `JobPosting.status` first (`OPEN → FILLED`, atomically), and only then re-checks the specific application. If the application-level check fails *after* the posting-level check already succeeded (e.g. someone had already rejected this specific application through a stale UI, even though the posting itself was still open), the whole transaction must roll back — including the posting flip — not just stop partway. Prisma automatically rolls back everything in a `$transaction` callback when it throws, so the abort path in this route deliberately throws a sentinel error inside the transaction, rather than returning `null` and trying to distinguish "ran but did nothing" from "rolled back" after the fact.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/employer-hire.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as hireApplication } from '@/app/api/employer/job-applications/[id]/hire/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/job-applications/[id]/hire', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let claimId: string;
  let postingId: string;
  let applicationId: string;
  let otherApplicationId: string;
  const claimantSsn = '447-88-2211';

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `hire-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '27-1122334', companyName: 'Hire Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claimantUser = await prisma.user.create({
      data: { email: `hire-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName: 'Hire Target',
        ssnHash: hashSSN(claimantSsn),
        identityVerificationStatus: 'VERIFIED',
      },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Candidate', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Hired posting', description: 'N/A', location: 'Rolla, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;

    const secondUser = await prisma.user.create({
      data: { email: `hire-claimant-2-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const secondClaimant = await prisma.claimantProfile.create({
      data: { userId: secondUser.id, ssnHash: `hire-test-hash-2-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    const secondCandidate = await prisma.candidateProfile.create({
      data: { claimantProfileId: secondClaimant.id, headline: 'Second candidate', skills: 'Various', availability: 'Now' },
    });
    const otherApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId: secondCandidate.id, initiatedBy: 'CANDIDATE' },
    });
    otherApplicationId = otherApplication.id;
  });

  it('hires the application and cascades every side effect', async () => {
    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${applicationId}/hire`, { method: 'POST' }),
      { params: { id: applicationId } }
    );
    expect(res.status).toBe(200);

    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    expect(application?.status).toBe('HIRED');

    const otherApplication = await prisma.jobApplication.findUnique({ where: { id: otherApplicationId } });
    expect(otherApplication?.status).toBe('REJECTED');

    const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
    expect(posting?.status).toBe('FILLED');

    const event = await prisma.employmentEvent.findFirst({ where: { matchedClaimantProfileId: claimantProfileId } });
    expect(event?.type).toBe('HIRE');
    expect(event?.ssnHash).toBe(hashSSN(claimantSsn));
    expect(event?.employerId).toBe(employerProfileId);

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('RESTRICTED');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.caseworkerId).toBeNull();
    expect(message?.subject).toBeTruthy();

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'JobApplication', targetId: applicationId, action: 'JOB_APPLICATION_HIRED' },
    });
    expect(log).not.toBeNull();
  });

  it('returns 409 hiring an already-resolved application', async () => {
    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${applicationId}/hire`, { method: 'POST' }),
      { params: { id: applicationId } }
    );
    expect(res.status).toBe(409);
  });

  it('returns 409 hiring the other application on the now-FILLED posting, with no side effects', async () => {
    const res = await hireApplication(
      new Request(`http://localhost/api/employer/job-applications/${otherApplicationId}/hire`, { method: 'POST' }),
      { params: { id: otherApplicationId } }
    );
    expect(res.status).toBe(409);

    // The posting was already FILLED by the first hire — confirm this second
    // attempt did not create a second EmploymentEvent/Claim-restriction for
    // the second candidate.
    const events = await prisma.employmentEvent.findMany({ where: { employerId: employerProfileId } });
    expect(events).toHaveLength(1);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUserId } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.jobApplication.deleteMany({ where: { jobPostingId: postingId } });
    await prisma.jobPosting.delete({ where: { id: postingId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    const secondClaimant = await prisma.claimantProfile.findFirst({ where: { candidateProfile: { headline: 'Second candidate' } } });
    if (secondClaimant) {
      await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: secondClaimant.id } });
      await prisma.user.delete({ where: { id: secondClaimant.userId } });
      await prisma.claimantProfile.delete({ where: { id: secondClaimant.id } });
    }
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-hire.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/job-applications/[id]/hire/route'`.

- [ ] **Step 3: Implement the hire route**

Create `src/app/api/employer/job-applications/[id]/hire/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

// Thrown from inside the transaction below to force a full rollback — never
// caught anywhere except this file's own try/catch. See this task's brief
// for why a thrown error is used instead of returning null.
class ApplicationAlreadyResolvedError extends Error {}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      jobPostingId: true,
      jobPosting: { select: { employerId: true } },
      candidateProfile: {
        select: {
          claimantProfileId: true,
          claimantProfile: { select: { legalName: true, ssnHash: true } },
        },
      },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }
  if (application.jobPosting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (application.status !== 'PENDING') {
    return apiError('This application has already been resolved', 409);
  }
  if (!application.candidateProfile.claimantProfile.ssnHash) {
    // Should be unreachable: candidate profile creation requires identity
    // verification, which is what populates ssnHash. Guarded anyway since
    // EmploymentEvent.ssnHash is a required, non-null column.
    return apiError('This candidate has not completed identity verification', 409);
  }

  const claimantProfileId = application.candidateProfile.claimantProfileId;
  const legalName = application.candidateProfile.claimantProfile.legalName ?? 'Unknown';
  const ssnHash = application.candidateProfile.claimantProfile.ssnHash;
  const jobPostingId = application.jobPostingId;
  const employerProfileId = session!.user.employerProfileId;

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // The JobPosting is the actual contended resource — only one
      // application on a posting can ever be hired. Gating here first, before
      // touching the specific application, is what prevents two different
      // PENDING applications on the same posting from both being hired by a
      // race between two concurrent requests.
      const filledPosting = await tx.jobPosting.updateMany({
        where: { id: jobPostingId, status: 'OPEN' },
        data: { status: 'FILLED' },
      });
      if (filledPosting.count === 0) {
        throw new ApplicationAlreadyResolvedError();
      }

      const hiredApplication = await tx.jobApplication.updateMany({
        where: { id: params.id, status: 'PENDING' },
        data: { status: 'HIRED' },
      });
      if (hiredApplication.count === 0) {
        // The posting-level gate above already succeeded, but this specific
        // application had independently already been resolved (e.g.
        // rejected before this request arrived) — throwing here rolls back
        // the posting flip too, so the transaction has no partial effect.
        throw new ApplicationAlreadyResolvedError();
      }

      await tx.jobApplication.updateMany({
        where: { jobPostingId, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });

      const event = await tx.employmentEvent.create({
        data: {
          employerId: employerProfileId,
          type: 'HIRE',
          employeeName: legalName,
          ssnHash,
          eventDate: new Date(),
          matchedClaimantProfileId: claimantProfileId,
        },
      });

      await tx.claim.updateMany({
        where: { claimantId: claimantProfileId, status: 'ACTIVE' },
        data: { status: 'RESTRICTED' },
      });

      const message = await tx.message.create({
        data: {
          claimantId: claimantProfileId,
          caseworkerId: null,
          subject: 'Your claim status has changed',
          body: 'Your claim status was updated to Restricted because you were hired through the Emplement marketplace. If you believe this is a mistake, please contact your caseworker.',
        },
      });

      return { event, message };
    });
  } catch (err) {
    if (err instanceof ApplicationAlreadyResolvedError) {
      return apiError('This application has already been resolved', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_HIRED',
    targetEntity: 'JobApplication',
    targetId: params.id,
    metadata: { employmentEventId: result.event.id, claimantProfileId },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-hire.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire a Hire button into the posting-detail page**

In `src/app/employer/job-postings/[id]/page.tsx`, add a `handleHire` function alongside `handleReject`:

```ts
  async function handleHire(id: string) {
    setActionError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/employer/job-applications/${id}/hire`, { method: 'POST' });
      if (!res.ok) {
        setActionError(
          res.status === 409
            ? 'This application (or its posting) was already resolved.'
            : 'We could not hire this candidate. Please try again.'
        );
        if (res.status === 409) await loadApplications();
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
  }
```

Change the `PENDING`-status action block from:

```tsx
              {a.status === 'PENDING' && (
                <div className="flex gap-3">
                  <Button disabled={pendingId === a.id} onClick={() => handleReject(a.id)} variant="secondary">
                    Reject
                  </Button>
                </div>
              )}
```

to:

```tsx
              {a.status === 'PENDING' && (
                <div className="flex gap-3">
                  <Button disabled={pendingId === a.id} onClick={() => handleHire(a.id)}>
                    Hire
                  </Button>
                  <Button disabled={pendingId === a.id} onClick={() => handleReject(a.id)} variant="secondary">
                    Reject
                  </Button>
                </div>
              )}
```

- [ ] **Step 6: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/employer/job-applications/[id]/hire src/app/employer/job-postings/[id]/page.tsx tests/integration/employer-hire.test.ts
git commit -m "Add hire transaction: EmploymentEvent, claim restriction, and claimant message"
```

---

## Task 8: E2E test and accessibility scans

**Files:**
- Create: `tests/e2e/employer-marketplace-flow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1-7.

- [ ] **Step 1: Write the E2E flow test**

Create `tests/e2e/employer-marketplace-flow.spec.ts`:

```ts
// tests/e2e/employer-marketplace-flow.spec.ts
import { test, expect } from '@playwright/test';
import { prisma } from '../../src/lib/prisma';
import { waitForHydration } from './helpers';

const claimantEmail = `e2e-marketplace-claimant-${Date.now()}@example.com`;
const claimantPassword = 'E2EMarketplacePass123';
const employerEmail = `e2e-marketplace-employer-${Date.now()}@example.com`;
const employerPassword = 'E2EMarketplacePass123';
const employerFein = '61-2233445';
const claimantSsn = '512-90-4471';

let claimantUserId: string;
let claimantProfileId: string;
let claimId: string;
let employerUserId: string;

test.beforeAll(async () => {
  const claimantUser = await prisma.user.create({
    data: { email: claimantEmail, passwordHash: 'placeholder', role: 'CLAIMANT' },
  });
  claimantUserId = claimantUser.id;
  const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
  claimantProfileId = claimantProfile.id;

  const claim = await prisma.claim.create({
    data: {
      claimantId: claimantProfileId,
      status: 'ACTIVE',
      benefitYearStart: new Date('2026-08-15'),
      benefitYearEnd: new Date('2027-08-15'),
      weeklyBenefitAmount: 300,
    },
  });
  claimId = claim.id;
});

test('claimant builds a candidate profile, applies, and employer hires them through the marketplace', async ({
  page,
}) => {
  // Sign up and verify identity as the claimant (real UI flow, so the
  // password is really set via bcrypt through the signup route rather than a
  // placeholder hash, and ssnHash gets populated the normal way).
  await page.goto('/claim/signup');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill(claimantEmail);
  await page.getByLabel('Password').fill(claimantPassword);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/claim\/login/);

  await waitForHydration(page);
  await page.getByLabel('Email address').fill(claimantEmail);
  await page.getByLabel('Password').fill(claimantPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/claim\/dashboard/);

  await page.goto('/claim/verify-identity');
  await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();
  await page.getByRole('button', { name: /continue to identity verification/i }).click();

  // The button click starts a mocked external verification and redirects to
  // a callback page — the identity form (legal name/DOB/SSN/phone/address)
  // lives there, not on /claim/verify-identity itself.
  await page.waitForURL(/\/claim\/verify-identity\/callback/);
  await page.waitForLoadState('networkidle');
  await waitForHydration(page);
  await page.getByLabel('Legal name').fill('Marketplace E2E Claimant');
  await page.getByLabel(/date of birth/i).fill('1991-02-14');
  await page.getByLabel(/social security number/i).fill(claimantSsn);
  await page.getByLabel(/phone number/i).fill('5735557788');
  await page.getByLabel(/mailing address/i).fill('300 Flow St, Jefferson City, MO 65101');
  await page.getByRole('button', { name: /verify identity/i }).click();
  await expect(page).toHaveURL(/\/claim\/new/);

  // Build a candidate profile.
  await page.goto('/claim/candidate-profile');
  await waitForHydration(page);
  await page.getByLabel('Headline').fill('Warehouse associate');
  await page.getByLabel('Skills').fill('Forklift certified, inventory management');
  await page.getByLabel('Availability').fill('Immediate');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Warehouse associate')).toBeVisible();

  // Sign up and verify FEIN as the employer.
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
  await expect(page).toHaveURL(/\/employer\/dashboard/);

  await page.goto('/employer/verify-fein');
  await waitForHydration(page);
  await page.getByLabel(/FEIN/i).fill(employerFein);
  await page.getByLabel('Company name').fill('Marketplace Flow Co');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/employer\/dashboard/);

  // Post a job.
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByLabel('Title').fill('Warehouse associate');
  await page.getByLabel('Description').fill('Day shift, full time');
  await page.getByLabel('Location').fill('Jefferson City, MO');
  await page.getByRole('button', { name: 'Post job' }).click();
  await expect(page.getByText('Warehouse associate').first()).toBeVisible();

  // Apply as the claimant.
  const claimantPage = await page.context().browser()!.newContext().then((c) => c.newPage());
  await claimantPage.goto('/claim/login');
  await waitForHydration(claimantPage);
  await claimantPage.getByLabel('Email address').fill(claimantEmail);
  await claimantPage.getByLabel('Password').fill(claimantPassword);
  await claimantPage.getByRole('button', { name: 'Log in' }).click();
  await expect(claimantPage).toHaveURL(/\/claim\/dashboard/);

  await claimantPage.goto('/claim/browse-postings');
  await waitForHydration(claimantPage);
  await expect(claimantPage.getByText('Warehouse associate').first()).toBeVisible();
  await claimantPage.getByRole('button', { name: 'Apply' }).click();
  await expect(claimantPage.getByText('✓ Applied')).toBeVisible();

  // Hire as the employer.
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByRole('link', { name: 'View applications' }).first().click();
  await waitForHydration(page);
  await expect(page.getByText('Warehouse associate').first()).toBeVisible();
  await page.getByRole('button', { name: 'Hire' }).click();
  await expect(page.getByText('✓ Hired')).toBeVisible();

  // Confirm the claim was restricted and the claimant was messaged.
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  expect(claim?.status).toBe('RESTRICTED');

  const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
  expect(message).not.toBeNull();

  await claimantPage.close();
});

test.afterAll(async () => {
  const employerUser = await prisma.user.findUnique({ where: { email: employerEmail }, include: { employerProfile: true } });
  employerUserId = employerUser?.id ?? '';

  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [claimantUserId, employerUserId].filter(Boolean) } },
  });
  await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });

  if (employerUser?.employerProfile) {
    await prisma.jobApplication.deleteMany({
      where: { jobPosting: { employerId: employerUser.employerProfile.id } },
    });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerUser.employerProfile.id } });
    await prisma.jobPosting.deleteMany({ where: { employerId: employerUser.employerProfile.id } });
    await prisma.employerProfile.delete({ where: { id: employerUser.employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
  }

  await prisma.candidateProfile.deleteMany({ where: { claimantProfileId } });
  await prisma.claim.deleteMany({ where: { id: claimId } });
  await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: claimantProfileId } });
  await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
  await prisma.user.delete({ where: { id: claimantUserId } });
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Run the E2E test to verify it passes in isolation**

Run: `rm -rf .next && npx playwright test employer-marketplace-flow.spec.ts --reporter=list`
Expected: PASS. If any selector doesn't match (e.g. the exact button/label text on the claimant signup/login/verify-identity forms), read the actual current page source for that route and correct the selector to match — this plan's earlier tasks read those forms' current code, but this E2E test is transcribed from memory of that same session's established patterns and should be double-checked against the live DOM.

- [ ] **Step 3: Add accessibility scans for the new pages**

In `tests/e2e/accessibility.spec.ts`, inside the existing `test.describe('claimant pages', ...)` block, add:

```ts
  test('/claim/candidate-profile has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/claim/candidate-profile');
    await expect(page.getByRole('heading', { name: /candidate profile/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('/claim/browse-postings has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/claim/browse-postings');
    await expect(page.getByRole('heading', { name: /job postings/i })).toBeVisible();
    await expectNoViolations(page);
  });
```

Inside the existing `test.describe('employer pages', ...)` block, add:

```ts
  test('/employer/job-postings has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/employer/job-postings');
    await expect(page.getByRole('heading', { name: /job postings/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('/employer/browse-candidates has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/employer/browse-candidates');
    await expect(page.getByRole('heading', { name: /browse candidates/i })).toBeVisible();
    await expectNoViolations(page);
  });
```

Read the file first to confirm the exact current names/structure of both describe blocks before inserting — this plan's earlier reads confirmed a `staff pages` block exists between `claimant pages` and `employer pages` at the time this plan was written, but insert into whichever block is actually named `claimant pages` / `employer pages` in the current file.

- [ ] **Step 4: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`
Expected: All tests pass, including the new marketplace flow and the four new accessibility scans.

- [ ] **Step 5: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/employer-marketplace-flow.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "Add E2E test and accessibility scans for the employer marketplace slice"
```

---
