# Live Interview Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employer propose 2-3 interview time slots for a `PENDING` job application, and let the candidate accept one or decline all, entirely inside the app — closing the "coordinate off-platform" gap named in the marketplace roadmap.

**Architecture:** Two new Prisma models (`Interview`, `InterviewSlot`) attach 1:1 to the existing `JobApplication`, with no change to `JobApplication.status` or the existing Hire/Reject routes. Three new API routes (propose, accept, decline) plus a GET added to the existing claimant apply route. A new claimant-facing "My Applications" page is the first place in this app a claimant can see their own applications at all.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Prisma/PostgreSQL, Zod, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- No change to `JobApplication.status`, the `hire` route, or the `reject` route. Hire and Reject remain available on a `PENDING` application at any time, regardless of interview state.
- Re-proposing after a `DECLINED` interview replaces the previous `InterviewSlot` rows and resets `status` to `PROPOSED` — no history of past rounds is kept in the data model (every action is still recorded in `AuditLog`).
- The location/link field is free text the employer fills in themselves — never a real calendar or video-call integration.
- No employer-facing notification exists anywhere in this app today, and this plan does not add one. The employer sees interview status on their next visit to the application-review page.
- Accept/decline use the atomic `updateMany`-based compare-and-swap pattern already established by the Reject/Hire routes (`where: { id, status: 'PROPOSED' }`, checking `count === 0` for a 409) — this guards against a double-click or duplicate-tab race on the claimant's own action.
- Follow every existing convention: `requireRole` at the top of every route; `requireOwnership` for claimant-owned-resource checks; explicit Prisma `select` blocks; the two-shape error convention (`{ errors: parsed.error.flatten() }` for Zod, `{ error: string }` via `apiError` otherwise); `writeAuditLog` on every status-affecting write.
- WCAG 2.2 AA: every new form field has a visible label and `aria-describedby` error association via the existing `TextField` component.

---

## Task 1: Schema — `Interview`, `InterviewSlot`, `InterviewStatus`

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: enum `InterviewStatus` (`PROPOSED | CONFIRMED | DECLINED`); model `Interview` (1:1 with `JobApplication` via `jobApplicationId String @unique`, `status`, `location String?`, `confirmedSlot DateTime?`); model `InterviewSlot` (belongs to `Interview`, `startTime DateTime`); `JobApplication.interview: Interview?` back-relation.

- [ ] **Step 1: Add the `InterviewStatus` enum**

In `prisma/schema.prisma`, add immediately after the existing `enum TagCategory { ... }` block (the last enum before `model User`):

```prisma
enum InterviewStatus {
  PROPOSED
  CONFIRMED
  DECLINED
}
```

- [ ] **Step 2: Add the `interview` back-relation to `JobApplication`**

Change:

```prisma
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

to:

```prisma
model JobApplication {
  id                 String               @id @default(cuid())
  jobPostingId       String
  jobPosting         JobPosting           @relation(fields: [jobPostingId], references: [id])
  candidateProfileId String
  candidateProfile   CandidateProfile     @relation(fields: [candidateProfileId], references: [id])
  initiatedBy        ApplicationInitiator
  status             ApplicationStatus    @default(PENDING)
  createdAt          DateTime             @default(now())

  interview Interview?

  @@unique([jobPostingId, candidateProfileId])
}
```

- [ ] **Step 3: Add the `Interview` and `InterviewSlot` models**

Add at the end of `prisma/schema.prisma`:

```prisma
model Interview {
  id               String          @id @default(cuid())
  jobApplicationId String          @unique
  jobApplication   JobApplication  @relation(fields: [jobApplicationId], references: [id])
  status           InterviewStatus @default(PROPOSED)
  location         String?
  confirmedSlot    DateTime?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  slots InterviewSlot[]
}

model InterviewSlot {
  id          String    @id @default(cuid())
  interviewId String
  interview   Interview @relation(fields: [interviewId], references: [id])
  startTime   DateTime
}
```

- [ ] **Step 4: Run the migration**

Run: `npx prisma migrate dev --name add_interview_scheduling`
Expected: Completes with no errors. Open the generated `migration.sql` and confirm it contains: a `CREATE TYPE "InterviewStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'DECLINED')`, two `CREATE TABLE` statements (`Interview`, `InterviewSlot`), a unique index on `Interview.jobApplicationId`, and the foreign-key constraints for both new relations (`Interview.jobApplicationId → JobApplication.id`, `InterviewSlot.interviewId → Interview.id`). This codebase has repeatedly shipped incomplete migration files on schema tasks — verify all of the above is present before continuing.

- [ ] **Step 5: Write a failing schema smoke test**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block, after the `'can create and read back tags on CandidateProfile and JobPosting'` test and before `afterAll`:

```ts
  it('can create and read back an Interview with slots, and enforces one interview per application', async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `schema-test-interview-claimant-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CLAIMANT' },
    });
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `schema-test-interview-hash-${Date.now()}` },
    });
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId: claimantProfile.id, headline: 'Test', skills: 'Test', availability: 'Test' },
    });

    const employerUser = await prisma.user.create({
      data: { email: `schema-test-interview-employer-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });
    const jobPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfile.id, title: 'Test', description: 'Test', location: 'Test' },
    });

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: jobPosting.id, candidateProfileId: candidateProfile.id, initiatedBy: 'CANDIDATE' },
    });

    const interview = await prisma.interview.create({
      data: {
        jobApplicationId: application.id,
        location: 'Video call',
        slots: {
          create: [
            { startTime: new Date('2026-09-01T14:00:00Z') },
            { startTime: new Date('2026-09-02T14:00:00Z') },
          ],
        },
      },
      include: { slots: true },
    });
    expect(interview.status).toBe('PROPOSED');
    expect(interview.confirmedSlot).toBeNull();
    expect(interview.slots).toHaveLength(2);

    await expect(
      prisma.interview.create({ data: { jobApplicationId: application.id } })
    ).rejects.toThrow();

    await prisma.interviewSlot.deleteMany({ where: { interviewId: interview.id } });
    await prisma.interview.delete({ where: { id: interview.id } });
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
git commit -m "Add Interview and InterviewSlot models"
```

---

## Task 2: Employer proposes interview times

**Files:**
- Create: `src/lib/validation/interview.ts`
- Create: `src/app/api/employer/job-applications/[id]/interview/route.ts`
- Modify: `src/app/api/employer/job-postings/[id]/applications/route.ts`
- Modify: `src/app/employer/job-postings/[id]/page.tsx`
- Test: `tests/integration/interview-propose.test.ts`

**Interfaces:**
- Consumes: `Interview`/`InterviewSlot` from Task 1.
- Produces: `POST /api/employer/job-applications/[id]/interview` (propose or re-propose). Extends `GET /api/employer/job-postings/[id]/applications` to return `interview`. Consumed by Task 4's E2E coverage.

- [ ] **Step 1: Write the Zod schema**

Create `src/lib/validation/interview.ts`:

```ts
import { z } from 'zod';

export const proposeInterviewSchema = z.object({
  slots: z
    .array(z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date/time'))
    .min(2, 'Propose at least 2 time slots')
    .max(3, 'Propose at most 3 time slots'),
  location: z.string().optional(),
});

export type ProposeInterviewInput = z.infer<typeof proposeInterviewSchema>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/interview-propose.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as proposeInterview } from '@/app/api/employer/job-applications/[id]/interview/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/job-applications/[id]/interview', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let otherEmployerUserId: string;
  let otherEmployerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let postingId: string;
  let otherPostingId: string;
  let applicationId: string;
  let otherEmployerApplicationId: string;
  let hiredApplicationId: string;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `interview-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '11-2233445', companyName: 'Interview Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUserId, role: 'EMPLOYER', employerProfileId, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otherEmployerUser = await prisma.user.create({
      data: { email: `interview-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    otherEmployerUserId = otherEmployerUser.id;
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, fein: '12-3344556', companyName: 'Other Interview Co', verificationStatus: 'VERIFIED' },
    });
    otherEmployerProfileId = otherEmployerProfile.id;
    const otherPosting = await prisma.jobPosting.create({
      data: { employerId: otherEmployerProfileId, title: 'Not mine', description: 'N/A', location: 'Elsewhere' },
    });
    otherPostingId = otherPosting.id;

    const claimantUser = await prisma.user.create({
      data: { email: `interview-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `interview-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Candidate', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Interview posting', description: 'N/A', location: 'Springfield, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;

    const otherEmployerApplication = await prisma.jobApplication.create({
      data: { jobPostingId: otherPostingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    otherEmployerApplicationId = otherEmployerApplication.id;

    const hiredApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE', status: 'REJECTED' },
    });
    hiredApplicationId = hiredApplication.id;
  });

  it('rejects proposing for an application belonging to a different employer with 403', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${otherEmployerApplicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-01T14:00', '2026-09-02T14:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: otherEmployerApplicationId } });
    expect(res.status).toBe(403);
  });

  it('rejects proposing for a non-PENDING application with 409', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${hiredApplicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-01T14:00', '2026-09-02T14:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: hiredApplicationId } });
    expect(res.status).toBe(409);
  });

  it('proposes interview slots and notifies the claimant', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-01T14:00', '2026-09-02T15:30'], location: 'Video call' }),
    });
    const res = await proposeInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('PROPOSED');

    const interview = await prisma.interview.findUnique({
      where: { jobApplicationId: applicationId },
      include: { slots: true },
    });
    expect(interview?.slots).toHaveLength(2);
    expect(interview?.location).toBe('Video call');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message).not.toBeNull();
    expect(message?.caseworkerId).toBeNull();
  });

  it('rejects a second proposal while the interview is still PROPOSED with 409', async () => {
    const req = new Request(`http://localhost/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-03T14:00', '2026-09-04T14:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(409);
  });

  it('allows re-proposing after the interview is DECLINED, replacing the slots', async () => {
    await prisma.interview.update({
      where: { jobApplicationId: applicationId },
      data: { status: 'DECLINED' },
    });

    const req = new Request(`http://localhost/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots: ['2026-09-10T09:00', '2026-09-11T09:00', '2026-09-12T09:00'] }),
    });
    const res = await proposeInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(201);

    const interview = await prisma.interview.findUnique({
      where: { jobApplicationId: applicationId },
      include: { slots: true },
    });
    expect(interview?.status).toBe('PROPOSED');
    expect(interview?.slots).toHaveLength(3);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, otherEmployerUserId] } } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    const interview = await prisma.interview.findUnique({ where: { jobApplicationId: applicationId } });
    if (interview) {
      await prisma.interviewSlot.deleteMany({ where: { interviewId: interview.id } });
      await prisma.interview.delete({ where: { id: interview.id } });
    }
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

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/interview-propose.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/employer/job-applications/[id]/interview/route'`.

- [ ] **Step 4: Implement the propose route**

Create `src/app/api/employer/job-applications/[id]/interview/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { proposeInterviewSchema } from '@/lib/validation/interview';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = proposeInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      jobPosting: { select: { employerId: true } },
      candidateProfile: { select: { claimantProfileId: true } },
      interview: { select: { id: true, status: true } },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }
  if (application.jobPosting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (application.status !== 'PENDING') {
    return apiError('This application is no longer open', 409);
  }
  if (application.interview && application.interview.status !== 'DECLINED') {
    return apiError('This application already has an active interview', 409);
  }

  const slotDates = parsed.data.slots.map((s) => new Date(s));

  let interview;
  if (application.interview) {
    await prisma.interviewSlot.deleteMany({ where: { interviewId: application.interview.id } });
    interview = await prisma.interview.update({
      where: { id: application.interview.id },
      data: {
        status: 'PROPOSED',
        location: parsed.data.location,
        confirmedSlot: null,
        slots: { create: slotDates.map((startTime) => ({ startTime })) },
      },
    });
  } else {
    interview = await prisma.interview.create({
      data: {
        jobApplicationId: params.id,
        location: parsed.data.location,
        slots: { create: slotDates.map((startTime) => ({ startTime })) },
      },
    });
  }

  await prisma.message.create({
    data: {
      claimantId: application.candidateProfile.claimantProfileId,
      caseworkerId: null,
      subject: 'An employer proposed interview times',
      body: 'An employer has proposed interview times for one of your applications. Visit My Applications to respond.',
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'INTERVIEW_PROPOSED',
    targetEntity: 'JobApplication',
    targetId: params.id,
    metadata: { interviewId: interview.id, slotCount: slotDates.length },
  });

  return Response.json({ id: interview.id, status: interview.status }, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/interview-propose.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Extend the applications-list route to return interview state**

In `src/app/api/employer/job-postings/[id]/applications/route.ts`, change:

```ts
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
```

to:

```ts
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
      interview: {
        select: {
          id: true,
          status: true,
          location: true,
          confirmedSlot: true,
          slots: { select: { id: true, startTime: true } },
        },
      },
    },
  });
```

- [ ] **Step 7: Add propose-interview UI to the application-review page**

In `src/app/employer/job-postings/[id]/page.tsx`, change the `Application` type:

```tsx
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
```

to:

```tsx
type Interview = {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'DECLINED';
  location: string | null;
  confirmedSlot: string | null;
  slots: { id: string; startTime: string }[];
};

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
  interview: Interview | null;
};
```

Add the `TextField` import and propose-form state, changing:

```tsx
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
```

to:

```tsx
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
```

Add state after the existing `pendingId` state:

```tsx
  const [pendingId, setPendingId] = useState<string | null>(null);
```

to:

```tsx
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [slot1, setSlot1] = useState('');
  const [slot2, setSlot2] = useState('');
  const [slot3, setSlot3] = useState('');
  const [interviewLocation, setInterviewLocation] = useState('');
  const [proposeError, setProposeError] = useState<string | null>(null);
```

Add a `handlePropose` function after the existing `handleHire` function:

```tsx
  async function handlePropose(applicationId: string) {
    setProposeError(null);
    const slots = [slot1, slot2, slot3].filter((s) => s.trim() !== '');
    const res = await fetch(`/api/employer/job-applications/${applicationId}/interview`, {
      method: 'POST',
      body: JSON.stringify({ slots, location: interviewLocation || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setProposeError(body?.error ?? 'We could not propose interview times. Please try again.');
      return;
    }
    setProposingId(null);
    setSlot1('');
    setSlot2('');
    setSlot3('');
    setInterviewLocation('');
    await loadApplications();
  }
```

Change the per-application render block from:

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
```

to:

```tsx
              {a.status === 'PENDING' && (
                <div className="flex gap-3 mb-3">
                  <Button disabled={pendingId === a.id} onClick={() => handleHire(a.id)}>
                    Hire
                  </Button>
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

              {(!a.interview || a.interview.status === 'DECLINED') && proposingId !== a.id && (
                <Button variant="secondary" onClick={() => setProposingId(a.id)}>
                  {a.interview?.status === 'DECLINED' ? 'Propose new interview times' : 'Propose interview'}
                </Button>
              )}
              {proposingId === a.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {proposeError && (
                    <p role="alert" className="mb-2 text-error-text">
                      {proposeError}
                    </p>
                  )}
                  <TextField
                    id={`slot1-${a.id}`}
                    label="Slot 1"
                    type="datetime-local"
                    value={slot1}
                    onChange={setSlot1}
                    required
                  />
                  <TextField
                    id={`slot2-${a.id}`}
                    label="Slot 2"
                    type="datetime-local"
                    value={slot2}
                    onChange={setSlot2}
                    required
                  />
                  <TextField
                    id={`slot3-${a.id}`}
                    label="Slot 3 (optional)"
                    type="datetime-local"
                    value={slot3}
                    onChange={setSlot3}
                  />
                  <TextField
                    id={`location-${a.id}`}
                    label="Location or video link (optional)"
                    value={interviewLocation}
                    onChange={setInterviewLocation}
                  />
                  <div className="flex gap-3">
                    <Button onClick={() => handlePropose(a.id)}>Send proposal</Button>
                    <Button variant="secondary" onClick={() => setProposingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {a.interview?.status === 'PROPOSED' && (
                <p role="status" className="text-sm text-text-secondary mt-2">
                  Interview proposed, waiting for candidate response.
                </p>
              )}
              {a.interview?.status === 'CONFIRMED' && (
                <p role="status" className="text-status-active-text font-medium mt-2">
                  ✓ Interview confirmed: {new Date(a.interview.confirmedSlot!).toLocaleString()}
                  {a.interview.location && ` — ${a.interview.location}`}
                </p>
              )}
```

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation/interview.ts src/app/api/employer/job-applications/[id]/interview src/app/api/employer/job-postings/[id]/applications/route.ts src/app/employer/job-postings/[id]/page.tsx tests/integration/interview-propose.test.ts
git commit -m "Add employer interview proposal route and UI"
```

---

## Task 3: Claimant accepts/declines and the applications list route

**Files:**
- Create: `src/app/api/job-applications/[id]/interview/accept/route.ts`
- Create: `src/app/api/job-applications/[id]/interview/decline/route.ts`
- Modify: `src/app/api/job-applications/route.ts`
- Test: `tests/integration/interview-respond.test.ts`

**Interfaces:**
- Consumes: `Interview`/`InterviewSlot` from Task 1; the propose route from Task 2 (tests seed interviews directly via Prisma rather than calling it, matching this codebase's established pattern of not chaining a whole other task's route inside a test fixture).
- Produces: `POST /api/job-applications/[id]/interview/accept` (body `{ slotId }`); `POST /api/job-applications/[id]/interview/decline`; `GET /api/job-applications` (new — lists the claimant's own applications with `interview`). Consumed by Task 4's page.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/interview-respond.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as acceptInterview } from '@/app/api/job-applications/[id]/interview/accept/route';
import { POST as declineInterview } from '@/app/api/job-applications/[id]/interview/decline/route';
import { GET as listMyApplications } from '@/app/api/job-applications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('claimant interview responses and application list', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let candidateProfileId: string;
  let otherClaimantUserId: string;
  let otherClaimantProfileId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let postingId: string;
  let applicationId: string;
  let interviewId: string;
  let slot1Id: string;
  let slot2Id: string;
  let confirmedApplicationId: string;
  let confirmedInterviewId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `respond-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `respond-test-hash-${Date.now()}`, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = claimantProfile.id;
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Candidate', skills: 'Various', availability: 'Now' },
    });
    candidateProfileId = candidateProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otherClaimantUser = await prisma.user.create({
      data: { email: `respond-other-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    otherClaimantUserId = otherClaimantUser.id;
    const otherClaimantProfile = await prisma.claimantProfile.create({
      data: { userId: otherClaimantUser.id, ssnHash: `respond-other-hash-${Date.now()}` },
    });
    otherClaimantProfileId = otherClaimantProfile.id;

    const employerUser = await prisma.user.create({
      data: { email: `respond-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '21-3344556', companyName: 'Respond Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;
    const posting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Respond posting', description: 'N/A', location: 'Columbia, MO' },
    });
    postingId = posting.id;

    const application = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    applicationId = application.id;
    const interview = await prisma.interview.create({
      data: {
        jobApplicationId: applicationId,
        slots: {
          create: [
            { startTime: new Date('2026-09-01T14:00:00Z') },
            { startTime: new Date('2026-09-02T14:00:00Z') },
          ],
        },
      },
      include: { slots: true },
    });
    interviewId = interview.id;
    slot1Id = interview.slots[0]!.id;
    slot2Id = interview.slots[1]!.id;

    const confirmedApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'EMPLOYER' },
    });
    confirmedApplicationId = confirmedApplication.id;
    const confirmedInterview = await prisma.interview.create({
      data: {
        jobApplicationId: confirmedApplicationId,
        status: 'CONFIRMED',
        confirmedSlot: new Date('2026-09-05T14:00:00Z'),
        slots: { create: [{ startTime: new Date('2026-09-05T14:00:00Z') }] },
      },
    });
    confirmedInterviewId = confirmedInterview.id;
  });

  it('rejects a claimant acting on another claimant\'s application with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherClaimantUserId, role: 'CLAIMANT', claimantProfileId: otherClaimantProfileId, email: 'other@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot1Id }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(403);
  });

  it('rejects accepting an interview that is already CONFIRMED with 409', async () => {
    const req = new Request(`http://localhost/api/job-applications/${confirmedApplicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot1Id }),
    });
    const res = await acceptInterview(req, { params: { id: confirmedApplicationId } });
    expect(res.status).toBe(409);
  });

  it('rejects accepting a slotId that does not belong to the interview with 404', async () => {
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: 'nonexistent-slot-id' }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(404);
  });

  it('lists the claimant\'s own applications with interview slots', async () => {
    const res = await listMyApplications();
    expect(res.status).toBe(200);
    const applications = await res.json();
    const target = applications.find((a: { id: string }) => a.id === applicationId);
    expect(target.interview.status).toBe('PROPOSED');
    expect(target.interview.slots).toHaveLength(2);
    expect(target.jobPosting.title).toBe('Respond posting');
  });

  it('accepts a slot, confirming the interview', async () => {
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot1Id }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(200);

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    expect(interview?.status).toBe('CONFIRMED');
    expect(interview?.confirmedSlot?.toISOString()).toBe(new Date('2026-09-01T14:00:00Z').toISOString());
  });

  it('rejects accepting again on an already-CONFIRMED interview with 409', async () => {
    const req = new Request(`http://localhost/api/job-applications/${applicationId}/interview/accept`, {
      method: 'POST',
      body: JSON.stringify({ slotId: slot2Id }),
    });
    const res = await acceptInterview(req, { params: { id: applicationId } });
    expect(res.status).toBe(409);
  });

  it('declines an interview still in PROPOSED status', async () => {
    const declineApplication = await prisma.jobApplication.create({
      data: { jobPostingId: postingId, candidateProfileId, initiatedBy: 'CANDIDATE' },
    });
    const declineInterviewRow = await prisma.interview.create({
      data: { jobApplicationId: declineApplication.id, slots: { create: [{ startTime: new Date('2026-09-20T10:00:00Z') }] } },
    });

    const req = new Request(`http://localhost/api/job-applications/${declineApplication.id}/interview/decline`, { method: 'POST' });
    const res = await declineInterview(req, { params: { id: declineApplication.id } });
    expect(res.status).toBe(200);

    const interview = await prisma.interview.findUnique({ where: { id: declineInterviewRow.id } });
    expect(interview?.status).toBe('DECLINED');

    await prisma.interviewSlot.deleteMany({ where: { interviewId: declineInterviewRow.id } });
    await prisma.interview.delete({ where: { id: declineInterviewRow.id } });
    await prisma.jobApplication.delete({ where: { id: declineApplication.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [claimantUserId, otherClaimantUserId] } } });
    await prisma.interviewSlot.deleteMany({ where: { interviewId: { in: [interviewId, confirmedInterviewId] } } });
    await prisma.interview.deleteMany({ where: { id: { in: [interviewId, confirmedInterviewId] } } });
    await prisma.jobApplication.deleteMany({ where: { candidateProfileId } });
    await prisma.jobPosting.delete({ where: { id: postingId } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.claimantProfile.delete({ where: { id: otherClaimantProfileId } });
    await prisma.user.delete({ where: { id: otherClaimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/interview-respond.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/job-applications/[id]/interview/accept/route'`.

- [ ] **Step 3: Implement the accept route**

Create `src/app/api/job-applications/[id]/interview/accept/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ slotId?: string }>(req);
  if (!body) return invalidBody();
  const { slotId } = body;
  if (!slotId) {
    return apiError('slotId is required', 400);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      candidateProfile: { select: { claimantProfileId: true } },
      interview: { select: { id: true, status: true, slots: { select: { id: true, startTime: true } } } },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }

  const owns = requireOwnership(session, application.candidateProfile.claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  if (!application.interview || application.interview.status !== 'PROPOSED') {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  const slot = application.interview.slots.find((s) => s.id === slotId);
  if (!slot) {
    return apiError('That time slot was not found', 404);
  }

  const updated = await prisma.interview.updateMany({
    where: { id: application.interview.id, status: 'PROPOSED' },
    data: { status: 'CONFIRMED', confirmedSlot: slot.startTime },
  });
  if (updated.count === 0) {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'INTERVIEW_ACCEPTED',
    targetEntity: 'Interview',
    targetId: application.interview.id,
    metadata: { slotId, confirmedSlot: slot.startTime },
  });

  return Response.json({ id: application.interview.id, status: 'CONFIRMED' }, { status: 200 });
}
```

- [ ] **Step 4: Implement the decline route**

Create `src/app/api/job-applications/[id]/interview/decline/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      candidateProfile: { select: { claimantProfileId: true } },
      interview: { select: { id: true, status: true } },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }

  const owns = requireOwnership(session, application.candidateProfile.claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  if (!application.interview || application.interview.status !== 'PROPOSED') {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  const updated = await prisma.interview.updateMany({
    where: { id: application.interview.id, status: 'PROPOSED' },
    data: { status: 'DECLINED' },
  });
  if (updated.count === 0) {
    return apiError('This application has no interview proposal to respond to', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'INTERVIEW_DECLINED',
    targetEntity: 'Interview',
    targetId: application.interview.id,
  });

  return Response.json({ id: application.interview.id, status: 'DECLINED' }, { status: 200 });
}
```

- [ ] **Step 5: Add `GET /api/job-applications`**

In `src/app/api/job-applications/route.ts`, add before the existing `POST` function:

```ts
export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.claimantProfileId) {
    return apiError('Claimant profile not found', 404);
  }

  const candidateProfile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
    select: { id: true },
  });
  if (!candidateProfile) {
    return Response.json([]);
  }

  const applications = await prisma.jobApplication.findMany({
    where: { candidateProfileId: candidateProfile.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      initiatedBy: true,
      createdAt: true,
      jobPosting: { select: { title: true, employer: { select: { companyName: true } } } },
      interview: {
        select: {
          id: true,
          status: true,
          location: true,
          confirmedSlot: true,
          slots: { select: { id: true, startTime: true } },
        },
      },
    },
  });

  return Response.json(applications);
}
```

Note: a claimant with no `CandidateProfile` yet returns an empty array (`200`), not a `404` — they simply have no applications, which is a valid, non-error state (matching how the existing `POST` handler is the only place that treats a missing `CandidateProfile` as an error, since that path actually needs to attach a new row to it).

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/interview-respond.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/job-applications/[id]/interview src/app/api/job-applications/route.ts tests/integration/interview-respond.test.ts
git commit -m "Add claimant interview accept/decline routes and applications list"
```

---

## Task 4: "My Applications" page and nav link

**Files:**
- Create: `src/app/claim/applications/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`

**Interfaces:**
- Consumes: `GET /api/job-applications`, `POST /api/job-applications/[id]/interview/accept`, `POST /api/job-applications/[id]/interview/decline` (all from Task 3).

- [ ] **Step 1: Create the My Applications page**

Create `src/app/claim/applications/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type Slot = { id: string; startTime: string };
type Interview = {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'DECLINED';
  location: string | null;
  confirmedSlot: string | null;
  slots: Slot[];
};
type Application = {
  id: string;
  status: 'PENDING' | 'HIRED' | 'REJECTED';
  initiatedBy: 'CANDIDATE' | 'EMPLOYER';
  createdAt: string;
  jobPosting: { title: string; employer: { companyName: string | null } };
  interview: Interview | null;
};

export default function MyApplicationsPage() {
  const { data: session, status } = useSession();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadApplications() {
    const res = await fetch('/api/job-applications');
    if (!res.ok) {
      setLoadError('We could not load your applications. Please try again.');
      return;
    }
    setApplications(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    loadApplications();
  }, [status, session?.user.role]);

  async function handleAccept(applicationId: string, slotId: string) {
    setActionError(null);
    setPendingId(applicationId);
    try {
      const res = await fetch(`/api/job-applications/${applicationId}/interview/accept`, {
        method: 'POST',
        body: JSON.stringify({ slotId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? 'We could not accept that time. Please try again.');
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
  }

  async function handleDecline(applicationId: string) {
    setActionError(null);
    setPendingId(applicationId);
    try {
      const res = await fetch(`/api/job-applications/${applicationId}/interview/decline`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? 'We could not decline. Please try again.');
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

  if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">My applications</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to see your applications.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">My applications</h1>
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
        <p className="text-sm text-text-secondary">You haven&apos;t applied to any postings yet.</p>
      )}
      {applications !== null && applications.length > 0 && (
        <ul className="space-y-4">
          {applications.map((a) => (
            <li key={a.id} className="border border-border rounded p-4">
              <p className="font-medium">{a.jobPosting.title}</p>
              <p className="text-sm text-text-secondary mb-2">
                {a.jobPosting.employer.companyName ?? 'An employer'}
              </p>
              {a.status === 'PENDING' && (
                <p role="status" className="text-sm mb-2">
                  Status: Pending
                </p>
              )}
              {a.status === 'HIRED' && (
                <p role="status" className="text-status-active-text font-medium mb-2">
                  ✓ Hired
                </p>
              )}
              {a.status === 'REJECTED' && (
                <p role="status" className="text-text-secondary font-medium mb-2">
                  — Not selected
                </p>
              )}

              {a.interview?.status === 'PROPOSED' && (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="text-sm font-medium mb-2">Proposed interview times:</p>
                  <ul className="space-y-2 mb-2">
                    {a.interview.slots.map((s) => (
                      <li key={s.id} className="flex items-center gap-3">
                        <span className="text-sm">{new Date(s.startTime).toLocaleString()}</span>
                        <Button disabled={pendingId === a.id} onClick={() => handleAccept(a.id, s.id)}>
                          Accept
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {a.interview.location && (
                    <p className="text-sm text-text-secondary mb-2">Location: {a.interview.location}</p>
                  )}
                  <Button disabled={pendingId === a.id} onClick={() => handleDecline(a.id)} variant="secondary">
                    Decline all
                  </Button>
                </div>
              )}
              {a.interview?.status === 'CONFIRMED' && (
                <p role="status" className="text-status-active-text font-medium mt-2">
                  ✓ Interview confirmed: {new Date(a.interview.confirmedSlot!).toLocaleString()}
                  {a.interview.location && ` — ${a.interview.location}`}
                </p>
              )}
              {a.interview?.status === 'DECLINED' && (
                <p role="status" className="text-text-secondary text-sm mt-2">
                  You declined the proposed interview times.
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

- [ ] **Step 2: Add a nav link**

In `src/components/layout/AppNav.tsx`, change:

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

to:

```ts
const CLAIMANT_LINKS: NavLink[] = [
  { href: '/claim/dashboard', label: 'Dashboard' },
  { href: '/claim/new', label: 'File a claim' },
  { href: '/claim/verify-identity', label: 'Verify your identity' },
  { href: '/claim/messages', label: 'Messages' },
  { href: '/claim/candidate-profile', label: 'Candidate profile' },
  { href: '/claim/browse-postings', label: 'Job postings' },
  { href: '/claim/applications', label: 'My applications' },
];
```

- [ ] **Step 3: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS. (No new automated test in this task — the E2E flow in Task 5 is what exercises this page's rendering and interactions.)

- [ ] **Step 4: Commit**

```bash
git add src/app/claim/applications src/components/layout/AppNav.tsx
git commit -m "Add My Applications page for claimants"
```

---

## Task 5: E2E and accessibility

**Files:**
- Modify: `tests/e2e/employer-marketplace-flow.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1-4.

- [ ] **Step 1: Extend the flow to propose, accept, and confirm an interview**

In `tests/e2e/employer-marketplace-flow.spec.ts`, insert a new block after the existing "Hire as the employer" section (after `await expect(page.getByText('✓ Hired')).toBeVisible();`) and before the "Confirm the claim was restricted and the claimant was messaged" section. The interview proposal targets a SEPARATE application on a SEPARATE posting, since the existing flow's one application is already `HIRED` by that point (this plan's Global Constraints require Hire/Reject and interview scheduling to be fully independent, and the cleanest way to prove that in the same E2E run is to exercise interview scheduling on its own, still-`PENDING` application rather than retrofitting it onto the already-resolved one).

Change:

```ts
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
```

to:

```ts
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

  // Interview scheduling is exercised on a second, still-PENDING application
  // (the one built above is already HIRED) — this proves interview
  // scheduling is fully independent of Hire/Reject, per this plan's own
  // constraint.
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByLabel('Title').fill('Second warehouse role');
  await page.getByLabel('Description').fill('Evening shift');
  await page.getByLabel('Location').fill('Jefferson City, MO');
  await page.getByRole('button', { name: 'Post job' }).click();
  await expect(page.getByText('Second warehouse role').first()).toBeVisible();

  await claimantPage.goto('/claim/browse-postings');
  await waitForHydration(claimantPage);
  await claimantPage
    .locator('li', { has: claimantPage.getByText('Second warehouse role') })
    .getByRole('button', { name: 'Apply' })
    .click();

  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  // The postings list is ordered createdAt desc, and "Second warehouse role"
  // was created after "Warehouse associate", so it sorts first (index 0) —
  // not .nth(1), which would land on the already-HIRED posting instead.
  await page.getByRole('link', { name: 'View applications' }).first().click();
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Propose interview' }).click();
  await page.getByLabel('Slot 1').fill('2026-09-01T14:00');
  await page.getByLabel('Slot 2').fill('2026-09-02T10:00');
  await page.getByLabel('Location or video link (optional)').fill('Video call');
  await page.getByRole('button', { name: 'Send proposal' }).click();
  await expect(page.getByText('Interview proposed, waiting for candidate response.')).toBeVisible();

  await claimantPage.goto('/claim/applications');
  await waitForHydration(claimantPage);
  await expect(claimantPage.getByText('Second warehouse role').first()).toBeVisible();
  await expect(claimantPage.getByText('Proposed interview times:')).toBeVisible();

  const myApplicationsResults = await new AxeBuilder({ page: claimantPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(myApplicationsResults.violations).toEqual([]);

  await claimantPage.getByRole('button', { name: 'Accept' }).first().click();
  await expect(claimantPage.getByText(/✓ Interview confirmed/)).toBeVisible();

  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByRole('link', { name: 'View applications' }).first().click();
  await waitForHydration(page);
  await expect(page.getByText(/✓ Interview confirmed/)).toBeVisible();

  await claimantPage.close();
});
```

- [ ] **Step 2: Run the E2E test to verify it passes**

Run: `rm -rf .next && npx playwright test employer-marketplace-flow.spec.ts --reporter=list`
Expected: PASS. If a selector doesn't match the live DOM, read the actual current page source for that route and correct the selector — per this session's established practice for E2E work.

- [ ] **Step 3: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`
Expected: All tests pass, including the extended marketplace flow spec and the pre-existing accessibility scans (unaffected — no existing page's structure changed except the addition of new elements gated behind interview-specific states these fixtures never reach).

- [ ] **Step 4: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/employer-marketplace-flow.spec.ts
git commit -m "Extend E2E flow with interview scheduling coverage"
```

---
