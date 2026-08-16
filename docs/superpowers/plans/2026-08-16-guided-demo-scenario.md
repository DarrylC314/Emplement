# Guided Demo Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a presenter click one button on the homepage and walk a viewer through the complete apply → interview → hire → benefit-status story for one seeded claimant, across all three roles, via a persistent on-screen guide — plus fix the pre-existing gap where Employer has no one-click demo login.

**Architecture:** A floating widget mounted once in the app's `Providers` tree drives a 5-step sequence defined as plain data. Each step names a role, an instruction, and a target page; advancing a step signs into a different seeded account when the role changes and navigates via `next/navigation`. Two new API routes support it: one resolves the two database IDs the widget needs to deep-link (by known seed identity, not hardcoded), one reverts the specific records the walkthrough's two real actions (Accept, Hire) mutate, so the whole sequence is replayable.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma/PostgreSQL, NextAuth credentials provider, Vitest + Testing Library, Playwright.

## Global Constraints

- No new API routes beyond `GET /api/demo/scenario-links` and `POST /api/demo/reset` — no other route's behavior changes.
- Hire/Reject remain fully independent of interview status — unchanged from the interview-scheduling spec. This plan only sequences demo narrative, never adds a new dependency between the two.
- `claimant2@example.com`'s existing seed data (confirmed-interview application) is untouched — it moves out of the primary guided sequence but is not deleted or restructured.
- Guided-demo progress lives only in `sessionStorage` under the key `emplement-guided-demo-step` — no server-side session state, no persistence across browser sessions.
- The reset route targets exactly the records steps 1–3 can mutate (Interview, JobApplication, JobPosting, Claim, the hire-generated EmploymentEvent, the hire-generated Message) — it is not a general-purpose undo tool, and it deliberately never touches `AuditLog`.
- `/demo/tools` is not linked from the homepage or any nav component.

---

### Task 1: Seed data — Seed Claimant's claim starts ACTIVE

**Files:**
- Modify: `prisma/seed.ts:40-51` (claim creation), `prisma/seed.ts:223-228` (comment above the warehouse application), `prisma/seed.ts:376` (console.log)

**Interfaces:**
- Produces: `claimant@example.com`'s seeded `Claim.status` is `'ACTIVE'` (was `'RESTRICTED'`) at first-ever creation. Later tasks' reset route relies on `'ACTIVE'` being the correct restore target.

This is a one-line data change plus two comment/log updates. Confirmed safe: no test in this repo depends on the *seeded* `claimant@example.com` row having a `RESTRICTED` claim — every test that needs a `RESTRICTED` claim creates its own isolated fixture with its own randomly-suffixed email (grep `RESTRICTED` across `tests/` and `prisma/seed.ts` to verify this yourself before starting, if you want to double check). The flagged-certification/wage-conflict demo this claimant also serves (`/staff/certifications/[id]/review`) reads from the `WeeklyCertification.autoDecision` and `WageRecord` rows seeded separately below this block — neither depends on `Claim.status`.

Because `prisma/seed.ts`'s claim-creation block only ever runs once per environment (`existingClaim ?? create`, never updates an existing row), this change only affects environments seeded *after* this task lands. An already-seeded environment (including the current production database) keeps its existing `RESTRICTED` row until Task 2's reset route is called against it — call `POST /api/demo/reset` once after merging and deploying this plan to bring production's existing claimant row in line; this is an operational step, not part of any task here.

- [ ] **Step 1: Change the claim's seeded status**

In `prisma/seed.ts`, find:

```ts
  const existingClaim = await prisma.claim.findFirst({ where: { claimantId: profile.id } });
  const claim =
    existingClaim ??
    (await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    }));
```

Replace with:

```ts
  const existingClaim = await prisma.claim.findFirst({ where: { claimantId: profile.id } });
  const claim =
    existingClaim ??
    (await prisma.claim.create({
      data: {
        claimantId: profile.id,
        // ACTIVE (not RESTRICTED): the guided demo scenario hires this same
        // claimant later (see the Interview seeded further below) and needs
        // a visible ACTIVE -> RESTRICTED transition to show — the hire
        // route only flips claims that start ACTIVE.
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    }));
```

- [ ] **Step 2: Update the now-inaccurate comment above the warehouse application**

Find:

```ts
  // The claimant has already applied to the first posting, so logging in as
  // the seeded employer immediately shows a real applicant to review. Note:
  // claimant@example.com's claim is seeded RESTRICTED above (for the
  // separate flagged-wage-conflict demo), so hiring THIS applicant won't
  // show a visible claim-status change — see the second demo claimant below
  // for that story.
```

Replace with:

```ts
  // The claimant has already applied to the first posting, so logging in as
  // the seeded employer immediately shows a real applicant to review. This
  // is also the guided demo scenario's claimant/application: their claim
  // starts ACTIVE above specifically so hiring them later (once the
  // Interview seeded just below is accepted) produces a visible
  // ACTIVE -> RESTRICTED transition.
```

- [ ] **Step 3: Update the final console.log line for this claimant**

Find:

```ts
  console.log('Seed complete: claimant@example.com / ClaimantPass123 (flagged certification, claim RESTRICTED; has a PROPOSED interview to Accept/Decline on My Applications)');
```

Replace with:

```ts
  console.log('Seed complete: claimant@example.com / ClaimantPass123 (flagged certification, claim ACTIVE; has a PROPOSED interview to Accept/Decline on My Applications — this is the guided demo scenario claimant)');
```

- [ ] **Step 4: Run the seed script against local dev and confirm it succeeds**

Run: `npx tsx prisma/seed.ts`
Expected: exits 0, final log line reads "claim ACTIVE" for `claimant@example.com`.

- [ ] **Step 5: Verify the claim status directly**

Run:
```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { email: 'claimant@example.com' }, include: { claimantProfile: { include: { claims: true } } } });
  console.log(user.claimantProfile.claims[0].status);
  await prisma.\$disconnect();
})();
"
```
Expected: prints `ACTIVE`. (If it still prints `RESTRICTED`, this environment's row predates this change — that's expected per Step 3 of this task's own note above; it does not mean this task failed. Confirm instead that a *fresh* database would get `ACTIVE` by reading the changed code.)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (this task changes no test-visible behavior — no test depends on the seeded claim's status, per this task's own grounding above).

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts
git commit -m "Seed Seed Claimant's claim as ACTIVE for the guided demo scenario"
```

---

### Task 2: Demo API routes — scenario-links and reset

**Files:**
- Create: `src/app/api/demo/scenario-links/route.ts`
- Create: `src/app/api/demo/reset/route.ts`
- Test: `tests/integration/demo-scenario-links.test.ts`
- Test: `tests/integration/demo-reset.test.ts`

**Interfaces:**
- Produces: `GET /api/demo/scenario-links` → `200 { warehousePostingId: string; claimantProfileId: string }`, or `404 { error: string }` if the seed data isn't present. `POST /api/demo/reset` → `200 { reset: true }` on success, `401 { error: string }` if unauthenticated, `404 { error: string }` if the seed data isn't present. Both routes are consumed by Task 3's `GuidedDemoWidget` and Task 5's `/demo/tools` page.
- Consumes: `getServerAuthSession` from `src/lib/auth.ts`, `apiError` from `src/lib/apiRequest.ts`, `prisma` from `src/lib/prisma.ts`.

Both routes resolve records by the same fixed seed identities `prisma/seed.ts` creates: the user with email `claimant@example.com`, the `JobPosting` titled `"Warehouse Associate"` owned by the employer named `"Riverbend Logistics Inc."`. Neither route accepts or needs any request body or query parameter.

- [ ] **Step 1: Write the scenario-links route**

Create `src/app/api/demo/scenario-links/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/apiRequest';

// Resolves the two database ids the guided-demo widget needs to deep-link
// into pages, by the fixed identities prisma/seed.ts creates — never by a
// hardcoded id, since cuids differ per database. Unauthenticated: neither
// id is sensitive (this app already treats posting ids as freely visible
// via /claim/browse-postings), and the widget needs this before any
// particular login has necessarily completed.
export async function GET() {
  const posting = await prisma.jobPosting.findFirst({
    where: { title: 'Warehouse Associate', employer: { companyName: 'Riverbend Logistics Inc.' } },
    select: { id: true },
  });
  if (!posting) {
    return apiError('Guided demo data is not available in this environment.', 404);
  }

  const claimantUser = await prisma.user.findUnique({
    where: { email: 'claimant@example.com' },
    select: { claimantProfile: { select: { id: true } } },
  });
  if (!claimantUser?.claimantProfile) {
    return apiError('Guided demo data is not available in this environment.', 404);
  }

  return Response.json({
    warehousePostingId: posting.id,
    claimantProfileId: claimantUser.claimantProfile.id,
  });
}
```

- [ ] **Step 2: Write the scenario-links integration test**

Create `tests/integration/demo-scenario-links.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { GET as scenarioLinks } from '@/app/api/demo/scenario-links/route';

describe('GET /api/demo/scenario-links', () => {
  beforeAll(async () => {
    // Upserted (not created) by the exact identities prisma/seed.ts uses,
    // so this test works whether or not the real seed script has already
    // run against this database, and never collides with it on a shared
    // unique email/id.
    const claimantUser = await prisma.user.upsert({
      where: { email: 'claimant@example.com' },
      update: {},
      create: { email: 'claimant@example.com', passwordHash: 'x', role: 'CLAIMANT' },
    });
    await prisma.claimantProfile.upsert({
      where: { userId: claimantUser.id },
      update: {},
      create: { userId: claimantUser.id, legalName: 'Seed Claimant', identityVerificationStatus: 'VERIFIED' },
    });

    const employerUser = await prisma.user.upsert({
      where: { email: 'employer@example.com' },
      update: {},
      create: { email: 'employer@example.com', passwordHash: 'x', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.upsert({
      where: { userId: employerUser.id },
      update: {},
      create: {
        userId: employerUser.id,
        fein: '47-1002233',
        companyName: 'Riverbend Logistics Inc.',
        verificationStatus: 'VERIFIED',
      },
    });

    const existingPosting = await prisma.jobPosting.findFirst({
      where: { employerId: employerProfile.id, title: 'Warehouse Associate' },
    });
    if (!existingPosting) {
      await prisma.jobPosting.create({
        data: {
          employerId: employerProfile.id,
          title: 'Warehouse Associate',
          description: 'N/A',
          location: 'Jefferson City, MO',
        },
      });
    }
  });

  it('resolves the warehouse posting id and Seed Claimant\'s profile id', async () => {
    const res = await scenarioLinks();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.warehousePostingId).toBe('string');
    expect(typeof body.claimantProfileId).toBe('string');
  });
});
```

- [ ] **Step 3: Run the scenario-links test**

Run: `npx vitest run tests/integration/demo-scenario-links.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Write the reset route**

Create `src/app/api/demo/reset/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { apiError } from '@/lib/apiRequest';

// Reverts exactly what the guided demo's Accept (POST
// /api/job-applications/[id]/interview/accept) and Hire (POST
// /api/employer/job-applications/[id]/hire) steps can mutate for Seed
// Claimant's Warehouse Associate application, so the guided demo is
// replayable. Not a general-purpose undo tool — scoped to this one
// walkthrough's own records. AuditLog rows are deliberately left alone:
// an appropriate permanent record even in a demo, and nothing in the
// walkthrough's own visibility depends on their absence.
export async function POST() {
  const session = await getServerAuthSession();
  if (!session) {
    return apiError('You must be logged in as a demo account first.', 401);
  }

  const claimantUser = await prisma.user.findUnique({
    where: { email: 'claimant@example.com' },
    select: {
      claimantProfile: {
        select: {
          id: true,
          claims: { select: { id: true }, take: 1 },
          candidateProfile: {
            select: {
              applications: {
                where: { jobPosting: { title: 'Warehouse Associate' } },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const claimantProfile = claimantUser?.claimantProfile;
  const claim = claimantProfile?.claims[0];
  const application = claimantProfile?.candidateProfile?.applications[0];
  if (!claimantProfile || !claim || !application) {
    return apiError('Guided demo data is not available in this environment.', 404);
  }

  await prisma.interview.update({
    where: { jobApplicationId: application.id },
    data: { status: 'PROPOSED', confirmedSlot: null },
  });

  const jobApplication = await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: 'PENDING' },
    select: { jobPostingId: true },
  });

  await prisma.jobPosting.update({
    where: { id: jobApplication.jobPostingId },
    data: { status: 'OPEN' },
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: { status: 'ACTIVE' },
  });

  await prisma.employmentEvent.deleteMany({
    where: { matchedClaimantProfileId: claimantProfile.id, type: 'HIRE' },
  });

  await prisma.message.deleteMany({
    where: { claimantId: claimantProfile.id, subject: 'Your claim status has changed' },
  });

  return Response.json({ reset: true });
}
```

- [ ] **Step 5: Write the reset route integration test**

Create `tests/integration/demo-reset.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as resetDemo } from '@/app/api/demo/reset/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/demo/reset', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let employerProfileId: string;
  let postingId: string;
  let applicationId: string;
  let interviewId: string;

  beforeAll(async () => {
    // Same upserted-by-identity pattern as the scenario-links test — works
    // whether or not the real seed script has already run.
    const claimantUser = await prisma.user.upsert({
      where: { email: 'claimant@example.com' },
      update: {},
      create: { email: 'claimant@example.com', passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;

    const claimantProfile = await prisma.claimantProfile.upsert({
      where: { userId: claimantUserId },
      update: {},
      create: { userId: claimantUserId, legalName: 'Seed Claimant', identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;

    const claim =
      (await prisma.claim.findFirst({ where: { claimantId: claimantProfileId } })) ??
      (await prisma.claim.create({
        data: {
          claimantId: claimantProfileId,
          status: 'ACTIVE',
          benefitYearStart: new Date('2026-08-01'),
          benefitYearEnd: new Date('2027-08-01'),
          weeklyBenefitAmount: 320,
        },
      }));
    claimId = claim.id;

    const employerUser = await prisma.user.upsert({
      where: { email: 'employer@example.com' },
      update: {},
      create: { email: 'employer@example.com', passwordHash: 'x', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.upsert({
      where: { userId: employerUser.id },
      update: {},
      create: {
        userId: employerUser.id,
        fein: '47-1002233',
        companyName: 'Riverbend Logistics Inc.',
        verificationStatus: 'VERIFIED',
      },
    });
    employerProfileId = employerProfile.id;

    const posting =
      (await prisma.jobPosting.findFirst({ where: { employerId: employerProfileId, title: 'Warehouse Associate' } })) ??
      (await prisma.jobPosting.create({
        data: {
          employerId: employerProfileId,
          title: 'Warehouse Associate',
          description: 'N/A',
          location: 'Jefferson City, MO',
        },
      }));
    postingId = posting.id;

    const candidateProfile = await prisma.candidateProfile.upsert({
      where: { claimantProfileId },
      update: {},
      create: {
        claimantProfileId,
        headline: 'Warehouse & Logistics Associate',
        skills: 'Forklift certified',
        availability: 'Immediate',
      },
    });

    const application =
      (await prisma.jobApplication.findFirst({
        where: { jobPostingId: postingId, candidateProfileId: candidateProfile.id },
      })) ??
      (await prisma.jobApplication.create({
        data: { jobPostingId: postingId, candidateProfileId: candidateProfile.id, initiatedBy: 'CANDIDATE' },
      }));
    applicationId = application.id;

    const interview =
      (await prisma.interview.findUnique({ where: { jobApplicationId: applicationId } })) ??
      (await prisma.interview.create({
        data: {
          jobApplicationId: applicationId,
          status: 'PROPOSED',
          slots: { create: [{ startTime: new Date('2026-08-19T15:00:00Z') }] },
        },
      }));
    interviewId = interview.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('reverts a hired/confirmed state back to the seeded PROPOSED starting point', async () => {
    // Arrange: simulate exactly what Accept + Hire produce.
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: 'CONFIRMED', confirmedSlot: new Date('2026-08-19T15:00:00Z') },
    });
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: 'HIRED' } });
    await prisma.jobPosting.update({ where: { id: postingId }, data: { status: 'FILLED' } });
    await prisma.claim.update({ where: { id: claimId }, data: { status: 'RESTRICTED' } });
    await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Seed Claimant',
        ssnHash: hashSSN('999-11-2222'),
        eventDate: new Date(),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    await prisma.message.create({
      data: {
        claimantId: claimantProfileId,
        subject: 'Your claim status has changed',
        body: 'Your claim status was updated to Restricted because you were hired through the Emplement marketplace.',
      },
    });

    const res = await resetDemo();
    expect(res.status).toBe(200);

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    expect(interview?.status).toBe('PROPOSED');
    expect(interview?.confirmedSlot).toBeNull();

    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    expect(application?.status).toBe('PENDING');

    const posting = await prisma.jobPosting.findUnique({ where: { id: postingId } });
    expect(posting?.status).toBe('OPEN');

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    expect(claim?.status).toBe('ACTIVE');

    const event = await prisma.employmentEvent.findFirst({
      where: { matchedClaimantProfileId: claimantProfileId, type: 'HIRE' },
    });
    expect(event).toBeNull();

    const message = await prisma.message.findFirst({
      where: { claimantId: claimantProfileId, subject: 'Your claim status has changed' },
    });
    expect(message).toBeNull();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce(null);
    const res = await resetDemo();
    expect(res.status).toBe(401);
  });

  afterAll(async () => {
    // Deliberately does not delete the shared identity rows (User,
    // profiles, claim, posting, application, interview) — they're the real
    // demo fixtures the guided-demo scenario and other tests/manual use
    // rely on, and this test's own last action already leaves them in the
    // correct canonical PROPOSED/PENDING/OPEN/ACTIVE state.
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 6: Run the reset route test**

Run: `npx vitest run tests/integration/demo-reset.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/demo/scenario-links/route.ts src/app/api/demo/reset/route.ts tests/integration/demo-scenario-links.test.ts tests/integration/demo-reset.test.ts
git commit -m "Add demo scenario-links and reset API routes"
```

---

### Task 3: GuidedDemoWidget component and step data

**Files:**
- Create: `src/lib/demoScenario.ts`
- Create: `src/components/demo/GuidedDemoWidget.tsx`
- Test: `tests/unit/guided-demo-widget.test.tsx`

**Interfaces:**
- Consumes: `GET /api/demo/scenario-links` (Task 2) — response shape `{ warehousePostingId: string; claimantProfileId: string }`.
- Produces: `DEMO_STEPS: DemoStep[]`, `DEMO_ACCOUNT_CREDENTIALS: Record<DemoRole, { email: string; password: string }>`, and `type ScenarioLinks = { warehousePostingId: string; claimantProfileId: string }` from `src/lib/demoScenario.ts` — all three names are exact and used by this task's own widget and later by Task 4 (homepage) and Task 5 (`/demo/tools`) only for `DEMO_ACCOUNT_CREDENTIALS`. `GuidedDemoWidget` (default export: none — named export `GuidedDemoWidget`) reads and writes `sessionStorage` key `'emplement-guided-demo-step'` — Task 4's homepage writes the same key to start the sequence.

- [ ] **Step 1: Write the step data module**

Create `src/lib/demoScenario.ts`:

```ts
export type DemoRole = 'claimant' | 'employer' | 'caseworker';

export type ScenarioLinks = {
  warehousePostingId: string;
  claimantProfileId: string;
};

export type DemoStep = {
  step: number;
  role: DemoRole;
  roleLabel: string;
  title: string;
  instruction: string;
  /** The page to navigate to for this step. Returns null for a step that
   * stays on the same page as the previous one (no navigation needed). */
  targetPath: (links: ScenarioLinks) => string | null;
  buttonLabel: string;
};

export const DEMO_ACCOUNT_CREDENTIALS: Record<DemoRole, { email: string; password: string }> = {
  claimant: { email: 'claimant@example.com', password: 'ClaimantPass123' },
  employer: { email: 'employer@example.com', password: 'EmployerPass123' },
  caseworker: { email: 'caseworker@example.com', password: 'CaseworkerPass123' },
};

export const DEMO_STEPS: DemoStep[] = [
  {
    step: 1,
    role: 'claimant',
    roleLabel: 'Seed Claimant, claimant@example.com',
    title: 'Accept a proposed interview time',
    instruction:
      "Seed Claimant applied to Warehouse Associate at Riverbend Logistics. The employer has proposed two interview times below — accept one (or note it's already confirmed if you're replaying this demo).",
    targetPath: () => '/claim/applications',
    buttonLabel: 'Next: switch to the employer',
  },
  {
    step: 2,
    role: 'employer',
    roleLabel: 'Riverbend Logistics Inc., employer@example.com',
    title: 'See the interview confirmed',
    instruction: 'See the interview status reflect what the claimant just chose.',
    targetPath: (links) => `/employer/job-postings/${links.warehousePostingId}`,
    buttonLabel: 'Next: hire the candidate',
  },
  {
    step: 3,
    role: 'employer',
    roleLabel: 'Riverbend Logistics Inc., employer@example.com',
    title: 'Hire the candidate',
    instruction: "Click Hire below to complete the process — watch what happens to Seed Claimant's benefit claim next.",
    targetPath: () => null,
    buttonLabel: 'Next: switch back to the claimant',
  },
  {
    step: 4,
    role: 'claimant',
    roleLabel: 'Seed Claimant, claimant@example.com',
    title: 'See the benefit claim change',
    instruction: "Seed Claimant's claim was Active — see it flip to Restricted the moment they were hired.",
    targetPath: () => '/claim/dashboard',
    buttonLabel: 'Next: switch to the caseworker',
  },
  {
    step: 5,
    role: 'caseworker',
    roleLabel: 'Caseworker, caseworker@example.com',
    title: 'Review the resulting case',
    instruction:
      'See how a caseworker reviews the resulting record: the hire event, claim status, wage records, certifications, and the audit trail behind every automated decision.',
    targetPath: (links) => `/staff/claimants/${links.claimantProfileId}`,
    buttonLabel: 'Finish',
  },
];
```

- [ ] **Step 2: Write the failing widget test**

Create `tests/unit/guided-demo-widget.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuidedDemoWidget } from '@/components/demo/GuidedDemoWidget';

const { pushMock, signInMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

const links = { warehousePostingId: 'posting-1', claimantProfileId: 'claimant-1' };

function mockLinksFetch(ok = true) {
  vi.mocked(fetch).mockResolvedValue({ ok, json: async () => links } as Response);
}

describe('GuidedDemoWidget', () => {
  beforeEach(() => {
    sessionStorage.clear();
    pushMock.mockClear();
    signInMock.mockReset();
    signInMock.mockResolvedValue({ error: undefined });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when no guided demo is in progress', () => {
    mockLinksFetch();
    const { container } = render(<GuidedDemoWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders step 1 content when sessionStorage has an active step', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    expect(await screen.findByText('Accept a proposed interview time')).toBeInTheDocument();
    expect(screen.getByText(/Now viewing as: Seed Claimant/)).toBeInTheDocument();
  });

  it('advancing to a different-role step signs in and navigates', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        redirect: false,
        email: 'employer@example.com',
        password: 'EmployerPass123',
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/employer/job-postings/posting-1'));
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('2');
  });

  it('advancing between two steps with the same role does not sign in or navigate', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');

    fireEvent.click(screen.getByRole('button', { name: /Next: hire the candidate/i }));

    await screen.findByText('Hire the candidate');
    expect(signInMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('3');
  });

  it('shows an error and does not advance when sign-in fails', async () => {
    mockLinksFetch();
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    expect(await screen.findByText(/demo login is temporarily unavailable/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('1');
  });

  it('exiting the demo clears the stored step and unmounts', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));

    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Accept a proposed interview time')).not.toBeInTheDocument());
  });

  it('shows a data-unavailable message and disables the primary action when scenario-links fails', async () => {
    mockLinksFetch(false);
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    expect(await screen.findByText(/isn't available in this environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next: switch to the employer/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/guided-demo-widget.test.tsx`
Expected: FAIL — `Cannot find module '@/components/demo/GuidedDemoWidget'` (the component doesn't exist yet).

- [ ] **Step 4: Write the widget component**

Create `src/components/demo/GuidedDemoWidget.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { DEMO_STEPS, DEMO_ACCOUNT_CREDENTIALS, type ScenarioLinks } from '@/lib/demoScenario';

const STORAGE_KEY = 'emplement-guided-demo-step';

export function GuidedDemoWidget() {
  const router = useRouter();
  const [stepNumber, setStepNumber] = useState<number | null>(null);
  const [links, setLinks] = useState<ScenarioLinks | null>(null);
  const [linksError, setLinksError] = useState(false);
  const [pending, setPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setStepNumber(Number(stored));
  }, []);

  useEffect(() => {
    if (stepNumber === null) return;
    let cancelled = false;
    fetch('/api/demo/scenario-links')
      .then((res) => {
        if (!res.ok) throw new Error('scenario-links request failed');
        return res.json();
      })
      .then((data: ScenarioLinks) => {
        if (!cancelled) setLinks(data);
      })
      .catch(() => {
        if (!cancelled) setLinksError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stepNumber]);

  if (stepNumber === null) return null;

  const currentStep = DEMO_STEPS.find((s) => s.step === stepNumber);
  if (!currentStep) return null;

  async function goToStep(nextStepNumber: number) {
    const nextStep = DEMO_STEPS.find((s) => s.step === nextStepNumber);
    if (!nextStep || !currentStep) return;
    setTransitionError(null);
    setPending(true);
    try {
      const roleChanging = nextStep.role !== currentStep.role;
      if (roleChanging) {
        const { email, password } = DEMO_ACCOUNT_CREDENTIALS[nextStep.role];
        const result = await signIn('credentials', { redirect: false, email, password });
        if (result?.error) {
          setTransitionError('The demo login is temporarily unavailable. Please try again.');
          return;
        }
      }
      const path = links ? nextStep.targetPath(links) : null;
      sessionStorage.setItem(STORAGE_KEY, String(nextStepNumber));
      setStepNumber(nextStepNumber);
      if (path) {
        router.push(path);
      } else {
        // No navigation on this transition (same page as the previous
        // step) — RouteFocusManager only moves focus on a real route
        // change, so move it to this widget's own updated heading instead;
        // otherwise a screen-reader user gets no cue the instruction
        // changed.
        headingRef.current?.focus();
      }
    } finally {
      setPending(false);
    }
  }

  function exitDemo() {
    sessionStorage.removeItem(STORAGE_KEY);
    setStepNumber(null);
  }

  const isLastStep = stepNumber === DEMO_STEPS.length;

  return (
    <div
      role="region"
      aria-label="Guided demo"
      className="fixed bottom-4 right-4 z-40 max-w-sm bg-surface border border-border rounded p-4 shadow-lg"
    >
      <p className="text-xs text-text-secondary mb-1">
        Step {currentStep.step} of {DEMO_STEPS.length} — Now viewing as: {currentStep.roleLabel}
      </p>
      <h2 ref={headingRef} tabIndex={-1} className="font-bold mb-2">
        {currentStep.title}
      </h2>
      {linksError ? (
        <p role="alert" className="text-error-text text-sm mb-3">
          Guided demo data isn&apos;t available in this environment.
        </p>
      ) : (
        <p className="text-sm mb-3">{currentStep.instruction}</p>
      )}
      {transitionError && (
        <p role="alert" className="text-error-text text-sm mb-3">
          {transitionError}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="button"
          onClick={() => (isLastStep ? exitDemo() : goToStep(stepNumber + 1))}
          disabled={pending || linksError}
        >
          {pending ? 'Working…' : currentStep.buttonLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={exitDemo} disabled={pending}>
          Exit demo
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/guided-demo-widget.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/demoScenario.ts src/components/demo/GuidedDemoWidget.tsx tests/unit/guided-demo-widget.test.tsx
git commit -m "Add GuidedDemoWidget and its 5-step scenario data"
```

---

### Task 4: Wire the widget in, add homepage buttons

**Files:**
- Modify: `src/app/providers.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `GuidedDemoWidget` (named export) from `src/components/demo/GuidedDemoWidget.tsx` (Task 3).
- Produces: the homepage writes `sessionStorage` key `'emplement-guided-demo-step'` = `'1'` when "Start Guided Demo" is clicked — the same key `GuidedDemoWidget` (Task 3) reads.

- [ ] **Step 1: Mount the widget in Providers**

In `src/app/providers.tsx`, find:

```tsx
'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { AppNav } from '@/components/layout/AppNav';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';
import { RouteFocusManager } from '@/components/layout/RouteFocusManager';
```

Replace with:

```tsx
'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { AppNav } from '@/components/layout/AppNav';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';
import { RouteFocusManager } from '@/components/layout/RouteFocusManager';
import { GuidedDemoWidget } from '@/components/demo/GuidedDemoWidget';
```

Then find:

```tsx
    <SessionProvider>
      <RouteFocusManager />
      <AppNav />
      {children}
      <SessionTimeoutWarning />
    </SessionProvider>
```

Replace with:

```tsx
    <SessionProvider>
      <RouteFocusManager />
      <AppNav />
      {children}
      <SessionTimeoutWarning />
      <GuidedDemoWidget />
    </SessionProvider>
```

- [ ] **Step 2: Add the Employer demo button and the Start Guided Demo button to the homepage**

In `src/app/page.tsx`, find:

```tsx
type DemoRole = 'claimant' | 'caseworker';

const DEMO_ACCOUNTS: Record<DemoRole, { email: string; password: string; dashboard: string }> = {
  claimant: { email: 'claimant@example.com', password: 'ClaimantPass123', dashboard: '/claim/dashboard' },
  caseworker: { email: 'caseworker@example.com', password: 'CaseworkerPass123', dashboard: '/staff/dashboard' },
};

export default function Home() {
  const router = useRouter();
  const [pendingDemo, setPendingDemo] = useState<DemoRole | null>(null);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function enterDemo(role: DemoRole) {
    setErrors([]);
    setPendingDemo(role);
    const { email, password, dashboard } = DEMO_ACCOUNTS[role];
    const result = await signIn('credentials', { redirect: false, email, password });
    if (result?.error) {
      setErrors([{ id: 'demo', message: 'The demo login is temporarily unavailable. Please try again.' }]);
      setPendingDemo(null);
      return;
    }
    router.push(dashboard);
  }

  return (
```

Replace with:

```tsx
type DemoRole = 'claimant' | 'caseworker' | 'employer';

const DEMO_ACCOUNTS: Record<DemoRole, { email: string; password: string; dashboard: string }> = {
  claimant: { email: 'claimant@example.com', password: 'ClaimantPass123', dashboard: '/claim/dashboard' },
  caseworker: { email: 'caseworker@example.com', password: 'CaseworkerPass123', dashboard: '/staff/dashboard' },
  employer: { email: 'employer@example.com', password: 'EmployerPass123', dashboard: '/employer/dashboard' },
};

const GUIDED_DEMO_STORAGE_KEY = 'emplement-guided-demo-step';

export default function Home() {
  const router = useRouter();
  const [pendingDemo, setPendingDemo] = useState<DemoRole | 'guided' | null>(null);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function enterDemo(role: DemoRole) {
    setErrors([]);
    setPendingDemo(role);
    const { email, password, dashboard } = DEMO_ACCOUNTS[role];
    const result = await signIn('credentials', { redirect: false, email, password });
    if (result?.error) {
      setErrors([{ id: 'demo', message: 'The demo login is temporarily unavailable. Please try again.' }]);
      setPendingDemo(null);
      return;
    }
    router.push(dashboard);
  }

  async function startGuidedDemo() {
    setErrors([]);
    setPendingDemo('guided');
    const { email, password } = DEMO_ACCOUNTS.claimant;
    const result = await signIn('credentials', { redirect: false, email, password });
    if (result?.error) {
      setErrors([{ id: 'demo', message: 'The demo login is temporarily unavailable. Please try again.' }]);
      setPendingDemo(null);
      return;
    }
    sessionStorage.setItem(GUIDED_DEMO_STORAGE_KEY, '1');
    router.push('/claim/applications');
  }

  return (
```

- [ ] **Step 3: Add the "Start Guided Demo" section above the role grid**

In `src/app/page.tsx`, find:

```tsx
      <ErrorSummary errors={errors} />

      <div className="grid gap-6 sm:grid-cols-2">
```

Replace with:

```tsx
      <div className="mb-8 border border-border rounded p-4 bg-surface-alt">
        <h2 className="font-medium mb-1">See the complete story</h2>
        <p className="text-sm text-text-secondary mb-4">
          Walk through one claimant&apos;s full journey — apply, schedule an interview, get hired, and see
          their benefit claim react — across all three roles, guided step by step.
        </p>
        <Button type="button" onClick={startGuidedDemo} disabled={pendingDemo !== null}>
          {pendingDemo === 'guided' ? 'Starting…' : 'Start Guided Demo'}
        </Button>
      </div>

      <ErrorSummary errors={errors} />

      <div className="grid gap-6 sm:grid-cols-2">
```

- [ ] **Step 4: Add the Employer demo button**

In `src/app/page.tsx`, find:

```tsx
        <section className="border border-border rounded p-4">
          <h2 className="font-medium mb-1">Employers</h2>
          <p className="text-sm text-text-secondary mb-4">
            Verify your company, respond to wage records, and report hire or separation events.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/employer/login" className={primaryLinkClasses}>
              Log in
            </Link>
            <Link href="/employer/signup" className={secondaryLinkClasses}>
              Create an account
            </Link>
          </div>
        </section>
```

Replace with:

```tsx
        <section className="border border-border rounded p-4">
          <h2 className="font-medium mb-1">Employers</h2>
          <p className="text-sm text-text-secondary mb-4">
            Verify your company, respond to wage records, and report hire or separation events.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/employer/login" className={primaryLinkClasses}>
              Log in
            </Link>
            <Link href="/employer/signup" className={secondaryLinkClasses}>
              Create an account
            </Link>
            <Button
              type="button"
              variant="secondary"
              onClick={() => enterDemo('employer')}
              disabled={pendingDemo !== null}
            >
              {pendingDemo === 'employer' ? 'Entering demo…' : 'Enter Employer Demo'}
            </Button>
          </div>
        </section>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/app/page.tsx` or `src/app/providers.tsx` (pre-existing unrelated errors elsewhere in the repo, if any, are not this task's concern).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Manually smoke-test the homepage**

Start the dev server (`npm run dev`), open `/`, confirm: an "Enter Employer Demo" button now appears under Employers; a "Start Guided Demo" section appears above the three role columns; clicking "Start Guided Demo" logs in as `claimant@example.com` and lands on `/claim/applications` with the guided-demo widget visible in the bottom-right corner showing step 1.

- [ ] **Step 8: Commit**

```bash
git add src/app/providers.tsx src/app/page.tsx
git commit -m "Wire GuidedDemoWidget into the app and add homepage demo buttons"
```

---

### Task 5: `/demo/tools` internal page

**Files:**
- Create: `src/app/demo/tools/page.tsx`
- Test: `tests/unit/demo-tools-page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/demo/reset` (Task 2), NextAuth `signIn`.

Not linked from the homepage, `AppNav`, or any other page — reachable only by navigating to `/demo/tools` directly.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/demo-tools-page.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DemoToolsPage from '@/app/demo/tools/page';

const { pushMock, signInMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

describe('DemoToolsPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signInMock.mockReset();
    signInMock.mockResolvedValue({ error: undefined });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in as claimant2@example.com and navigates to the claimant dashboard', async () => {
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /log in as seed claimant two/i }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        redirect: false,
        email: 'claimant2@example.com',
        password: 'Claimant2Pass123',
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/claim/dashboard'));
  });

  it('shows an error if the claimant2 login fails', async () => {
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /log in as seed claimant two/i }));

    expect(await screen.findByText(/demo login is temporarily unavailable/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('calls the reset endpoint and shows a success message', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ reset: true }) } as Response);
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /reset guided demo data/i }));

    expect(fetch).toHaveBeenCalledWith('/api/demo/reset', { method: 'POST' });
    expect(await screen.findByText(/reset to its starting state/i)).toBeInTheDocument();
  });

  it('shows the server error message when reset fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'You must be logged in as a demo account first.' }),
    } as Response);
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /reset guided demo data/i }));

    expect(await screen.findByText('You must be logged in as a demo account first.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/demo-tools-page.test.tsx`
Expected: FAIL — `Cannot find module '@/app/demo/tools/page'`.

- [ ] **Step 3: Write the page**

Create `src/app/demo/tools/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function DemoToolsPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [resetResult, setResetResult] = useState<string | null>(null);

  async function loginAsClaimant2() {
    setErrors([]);
    setPending(true);
    const result = await signIn('credentials', {
      redirect: false,
      email: 'claimant2@example.com',
      password: 'Claimant2Pass123',
    });
    if (result?.error) {
      setErrors([{ id: 'claimant2', message: 'The demo login is temporarily unavailable. Please try again.' }]);
      setPending(false);
      return;
    }
    router.push('/claim/dashboard');
  }

  async function resetGuidedDemoData() {
    setErrors([]);
    setResetResult(null);
    setPending(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setResetResult(body?.error ?? 'Reset failed. Please try again.');
        return;
      }
      setResetResult('Guided demo data has been reset to its starting state.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Demo tools</h1>
      <p className="text-sm text-text-secondary mb-8">
        Internal utilities for testing the guided demo — not linked from the homepage.
      </p>

      <ErrorSummary errors={errors} />

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-1">Seed Claimant Two</h2>
        <p className="text-sm text-text-secondary mb-4">
          Logs in directly as claimant2@example.com — a second demo claimant used for testing, outside the
          primary guided-demo sequence.
        </p>
        <Button type="button" onClick={loginAsClaimant2} disabled={pending}>
          {pending ? 'Logging in…' : 'Log in as Seed Claimant Two'}
        </Button>
      </section>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-1">Reset guided demo data</h2>
        <p className="text-sm text-text-secondary mb-4">
          Reverts Seed Claimant&apos;s Warehouse Associate interview, application, and claim status back to
          their starting state, so the guided demo can be run again from a clean slate.
        </p>
        {resetResult && (
          <p role="status" className="text-sm mb-3">
            {resetResult}
          </p>
        )}
        <Button type="button" variant="secondary" onClick={resetGuidedDemoData} disabled={pending}>
          {pending ? 'Resetting…' : 'Reset guided demo data'}
        </Button>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/demo-tools-page.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/demo/tools/page.tsx tests/unit/demo-tools-page.test.tsx
git commit -m "Add unlinked /demo/tools page (claimant2 login, reset button)"
```

---

### Task 6: E2E walkthrough test and accessibility coverage

**Files:**
- Create: `tests/e2e/guided-demo-walkthrough.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts:10` (add `/demo/tools` to `PUBLIC_ROUTES`)

**Interfaces:**
- Consumes: everything from Tasks 1–5 — the homepage's "Start Guided Demo" and "Enter Employer Demo" buttons, `GuidedDemoWidget`, both demo API routes, `/demo/tools`.

- [ ] **Step 1: Add `/demo/tools` to the public accessibility scan**

In `tests/e2e/accessibility.spec.ts`, find:

```ts
const PUBLIC_ROUTES = ['/', '/claim/signup', '/claim/login', '/staff/login', '/employer/signup', '/employer/login'];
```

Replace with:

```ts
const PUBLIC_ROUTES = [
  '/',
  '/claim/signup',
  '/claim/login',
  '/staff/login',
  '/employer/signup',
  '/employer/login',
  '/demo/tools',
];
```

- [ ] **Step 2: Write the E2E walkthrough test**

Create `tests/e2e/guided-demo-walkthrough.spec.ts`:

```ts
// tests/e2e/guided-demo-walkthrough.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers';

test('the guided demo walks through apply -> interview -> hire -> benefit status -> case review for Seed Claimant', async ({
  page,
}) => {
  // Start from the seeded PROPOSED/PENDING/OPEN/ACTIVE state regardless of
  // what a previous run of this test (or a manual demo session) left
  // behind — this is exactly what the reset route exists for.
  await page.goto('/claim/login');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill('claimant@example.com');
  await page.getByLabel('Password').fill('ClaimantPass123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/claim\/dashboard/);
  // page.request (not the standalone `request` fixture) shares the page's
  // browser-context cookies, which the reset route's session-cookie auth
  // check needs — the standalone fixture is a separate, unauthenticated
  // APIRequestContext.
  const resetRes = await page.request.post('/api/demo/reset');
  expect(resetRes.ok()).toBe(true);

  // Start the guided demo from the homepage.
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Start Guided Demo' }).click();
  await expect(page).toHaveURL(/\/claim\/applications/);

  // Scoped locators throughout: the widget renders as a sibling of each
  // page's own <main id="main-content">, not inside it (see
  // src/app/providers.tsx), but several step titles/instructions share
  // words with real page content (e.g. step 2's title is literally "See
  // the interview confirmed", which — unscoped — collides with the
  // employer page's own "✓ Interview confirmed: ..." text and throws a
  // Playwright strict-mode violation). Keeping widget and page assertions
  // in clearly separate locators avoids that for every step, not just the
  // one collision that happens to exist today.
  const widget = page.getByRole('region', { name: 'Guided demo' });
  const mainContent = page.locator('#main-content');
  await expect(widget.getByText('Accept a proposed interview time')).toBeVisible();

  // Accessibility scan of a representative guided-demo state, with the
  // widget visible alongside real page content.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);

  // Step 1: accept the first proposed slot (or confirm it's already
  // accepted, on a replay before this run's own reset above — the reset
  // above guarantees PROPOSED here, so this is the live-click path).
  await mainContent.getByRole('button', { name: 'Accept' }).first().click();
  await expect(mainContent.getByText(/interview confirmed/i)).toBeVisible();

  // Advance to step 2: employer view of the Warehouse Associate posting.
  await widget.getByRole('button', { name: /Next: switch to the employer/i }).click();
  await expect(page).toHaveURL(/\/employer\/job-postings\//);
  await expect(mainContent.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await expect(mainContent.getByText(/interview confirmed/i)).toBeVisible();
  await expect(widget.getByText('See the interview confirmed')).toBeVisible();

  // Advance to step 3 (same page, no navigation) and hire the candidate.
  await widget.getByRole('button', { name: /Next: hire the candidate/i }).click();
  await expect(widget.getByText('Hire the candidate')).toBeVisible();
  await mainContent.getByRole('button', { name: 'Hire' }).click();
  await expect(mainContent.getByText('✓ Hired')).toBeVisible();

  // Advance to step 4: back to the claimant, see the claim flip.
  await widget.getByRole('button', { name: /Next: switch back to the claimant/i }).click();
  await expect(page).toHaveURL(/\/claim\/dashboard/);
  await expect(mainContent.getByText('Restricted')).toBeVisible();
  await expect(widget.getByText('See the benefit claim change')).toBeVisible();

  // Advance to step 5: the caseworker's view of the resulting case.
  await widget.getByRole('button', { name: /Next: switch to the caseworker/i }).click();
  await expect(page).toHaveURL(/\/staff\/claimants\//);
  await expect(mainContent.getByRole('heading', { name: 'Seed Claimant' })).toBeVisible();
  await expect(mainContent.getByText(/Hired by Riverbend Logistics Inc\.? on/i)).toBeVisible();

  // Finish the demo.
  await widget.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('region', { name: 'Guided demo' })).toHaveCount(0);

  // Confirm the walkthrough is replayable: reset again and verify the
  // records really did revert (the reset route's own correctness is
  // covered in depth by tests/integration/demo-reset.test.ts — this is a
  // lightweight end-to-end confirmation that this full run left reset-able
  // state, not a second full UI walkthrough).
  const secondReset = await page.request.post('/api/demo/reset');
  expect(secondReset.ok()).toBe(true);
});

test('Enter Employer Demo logs in and reaches the employer dashboard', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Enter Employer Demo' }).click();
  await expect(page).toHaveURL(/\/employer\/dashboard/);
});
```

- [ ] **Step 3: Run the new E2E tests**

Run: `npx playwright test tests/e2e/guided-demo-walkthrough.spec.ts`
Expected: 2 passed.

- [ ] **Step 4: Run the accessibility spec**

Run: `npx playwright test tests/e2e/accessibility.spec.ts`
Expected: all pass, including the new `/demo/tools` entry.

- [ ] **Step 5: Run the full E2E suite**

Run: `npx playwright test`
Expected: all pass. (If the OneDrive/Windows `.next` readlink error from earlier in this session's history recurs, `rm -rf .next` and retry — this is a known, unrelated environment quirk, not a code issue.)

- [ ] **Step 6: Run the full unit/integration suite one more time**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/guided-demo-walkthrough.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "Add guided-demo E2E walkthrough and /demo/tools accessibility coverage"
```
