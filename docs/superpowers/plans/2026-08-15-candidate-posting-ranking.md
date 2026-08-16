# Automated Candidate/Posting Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed occupational tag taxonomy to `CandidateProfile` and `JobPosting`, and use tag overlap to surface a "Recommended for you" / "Recommended for [posting]" section above the existing plain browse lists, on both sides of the marketplace.

**Architecture:** Purely additive to the employer marketplace first slice. One schema change (a new `TagCategory` enum plus an optional `tags` array on each of the two existing models), one new reusable multi-select UI component, and a small pure client-side scoring function. No new API routes — four existing routes' Prisma `select` blocks gain `tags`, and the two existing browse pages compute and render the ranked section client-side from data they already fetch.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, PostgreSQL via Prisma (native array column), Zod, Vitest, Playwright + axe-core. No new dependencies.

## Global Constraints

- Tags are optional on both `CandidateProfile` and `JobPosting` — no validation minimum, no required-field marker on either creation form.
- The tag vocabulary is a fixed 25-value Prisma enum (`TagCategory`), not a database table — extending it later is a normal schema migration, the same workflow this codebase already uses for every other enum.
- No new API routes. Ranking is computed client-side; the only backend change is adding `tags: true` to four already-existing `select` blocks.
- The existing full, unranked lists on both browse pages are unchanged — the "Recommended" sections are additive, rendered above them.
- A "Recommended" section is omitted entirely (no empty-state placeholder) whenever there's nothing to recommend — no candidate profile, no tags on either side, or zero overlap.
- Follow every existing convention exactly: explicit Prisma `select` blocks, Zod validation shared client/server, the two-shape error convention (`{ errors: parsed.error.flatten() }` for Zod failures, `{ error: string }` via `apiError` otherwise), `writeAuditLog` on status-affecting writes (none of this plan's changes are status-affecting writes — tags are just additional fields on the two existing create operations, which are already audited).
- WCAG 2.2 AA: the new `CheckboxGroup` component follows the same accessible `<fieldset>`/`<legend>`/`aria-describedby` structure as the existing `Fieldset` component.

---

## Task 1: Schema — `TagCategory` enum and `tags` fields

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: enum `TagCategory` (25 values); `CandidateProfile.tags: TagCategory[]` (default `[]`); `JobPosting.tags: TagCategory[]` (default `[]`).

- [ ] **Step 1: Add the `TagCategory` enum**

In `prisma/schema.prisma`, add immediately after the existing `enum ApplicationStatus { ... }` block (the last enum before `model User`):

```prisma
enum TagCategory {
  MANAGEMENT
  BUSINESS_FINANCIAL
  COMPUTER_MATHEMATICAL
  ARCHITECTURE_ENGINEERING
  SCIENCE
  COMMUNITY_SOCIAL_SERVICE
  LEGAL
  EDUCATION_TRAINING
  ARTS_DESIGN_MEDIA
  SPORTS_ENTERTAINMENT
  HEALTHCARE_PRACTITIONER
  HEALTHCARE_SUPPORT
  PROTECTIVE_SERVICE
  FOOD_SERVICE
  BUILDING_GROUNDS_MAINTENANCE
  PERSONAL_CARE_SERVICE
  SALES
  OFFICE_ADMINISTRATIVE
  FARMING_FISHING_FORESTRY
  CONSTRUCTION
  INSTALLATION_MAINTENANCE_REPAIR
  PRODUCTION_MANUFACTURING
  TRANSPORTATION_MATERIAL_MOVING
  MILITARY_SPECIFIC
  GIG_ECONOMY
}
```

- [ ] **Step 2: Add `tags` to `CandidateProfile` and `JobPosting`**

In `model CandidateProfile`, change:

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
```

to:

```prisma
model CandidateProfile {
  id                String          @id @default(cuid())
  claimantProfileId String          @unique
  claimantProfile   ClaimantProfile @relation(fields: [claimantProfileId], references: [id])
  headline          String
  skills            String
  bio               String?
  availability      String
  tags              TagCategory[]   @default([])
  createdAt         DateTime        @default(now())

  applications JobApplication[]
}
```

In `model JobPosting`, change:

```prisma
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
```

to:

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

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_tag_category_ranking`
Expected: Completes with no errors. Open the generated `migration.sql` and confirm it contains a `CREATE TYPE "TagCategory" AS ENUM (...)` with all 25 values, and two `ALTER TABLE ... ADD COLUMN "tags" "TagCategory"[] NOT NULL DEFAULT ARRAY[]::"TagCategory"[]` statements (one for `CandidateProfile`, one for `JobPosting`). This codebase has previously shipped incomplete migration files on schema tasks — verify both statements are present before continuing.

- [ ] **Step 4: Write a failing schema smoke test**

Append to `tests/integration/schema.test.ts`, inside the existing `describe('database schema', ...)` block, after the `'can create and read back a CandidateProfile, JobPosting, and JobApplication'` test and before `afterAll`:

```ts
  it('can create and read back tags on CandidateProfile and JobPosting', async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `schema-test-tags-claimant-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CLAIMANT' },
    });
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `schema-test-tags-hash-${Date.now()}` },
    });

    const employerUser = await prisma.user.create({
      data: { email: `schema-test-tags-employer-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: claimantProfile.id,
        headline: 'Paramedic',
        skills: 'Emergency response',
        availability: 'On call',
        tags: ['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE'],
      },
    });
    expect(candidateProfile.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    const untaggedCandidate = await prisma.candidateProfile.findUnique({ where: { id: candidateProfile.id } });
    expect(Array.isArray(untaggedCandidate?.tags)).toBe(true);

    const jobPosting = await prisma.jobPosting.create({
      data: {
        employerId: employerProfile.id,
        title: 'Paramedic',
        description: 'EMS response team',
        location: 'Columbia, MO',
      },
    });
    expect(jobPosting.tags).toEqual([]);

    await prisma.jobPosting.delete({ where: { id: jobPosting.id } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfile.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfile.id } });
    await prisma.user.delete({ where: { id: claimantUser.id } });
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/schema.test.ts
git commit -m "Add TagCategory enum and tags fields to CandidateProfile and JobPosting"
```

---

## Task 2: Tag vocabulary, `CheckboxGroup`, and wiring into both creation forms

**Files:**
- Create: `src/lib/tagOptions.ts`
- Create: `src/components/ui/CheckboxGroup.tsx`
- Modify: `src/lib/validation/candidateProfile.ts`
- Modify: `src/lib/validation/jobPosting.ts`
- Modify: `src/app/api/candidate-profile/route.ts`
- Modify: `src/app/api/employer/job-postings/route.ts`
- Modify: `src/app/claim/candidate-profile/page.tsx`
- Modify: `src/app/employer/job-postings/page.tsx`
- Test: `tests/integration/candidate-profile.test.ts`
- Test: `tests/integration/employer-job-postings.test.ts`

**Interfaces:**
- Consumes: `TagCategory` enum from Task 1.
- Produces: `TAG_CATEGORY_VALUES: readonly string[]` and `TAG_OPTIONS: {value: string; label: string}[]` (from `src/lib/tagOptions.ts`); `CheckboxGroup` component with props `{legend, name, options, value: string[], onChange: (value: string[]) => void, error?}`; both creation forms' POST bodies now accept `tags: string[]`.

- [ ] **Step 1: Create the canonical tag vocabulary file**

Create `src/lib/tagOptions.ts`:

```ts
export const TAG_CATEGORY_VALUES = [
  'MANAGEMENT',
  'BUSINESS_FINANCIAL',
  'COMPUTER_MATHEMATICAL',
  'ARCHITECTURE_ENGINEERING',
  'SCIENCE',
  'COMMUNITY_SOCIAL_SERVICE',
  'LEGAL',
  'EDUCATION_TRAINING',
  'ARTS_DESIGN_MEDIA',
  'SPORTS_ENTERTAINMENT',
  'HEALTHCARE_PRACTITIONER',
  'HEALTHCARE_SUPPORT',
  'PROTECTIVE_SERVICE',
  'FOOD_SERVICE',
  'BUILDING_GROUNDS_MAINTENANCE',
  'PERSONAL_CARE_SERVICE',
  'SALES',
  'OFFICE_ADMINISTRATIVE',
  'FARMING_FISHING_FORESTRY',
  'CONSTRUCTION',
  'INSTALLATION_MAINTENANCE_REPAIR',
  'PRODUCTION_MANUFACTURING',
  'TRANSPORTATION_MATERIAL_MOVING',
  'MILITARY_SPECIFIC',
  'GIG_ECONOMY',
] as const;

export type TagCategoryValue = (typeof TAG_CATEGORY_VALUES)[number];

const TAG_LABELS: Record<TagCategoryValue, string> = {
  MANAGEMENT: 'Management',
  BUSINESS_FINANCIAL: 'Business & Financial',
  COMPUTER_MATHEMATICAL: 'Computer & Mathematical',
  ARCHITECTURE_ENGINEERING: 'Architecture & Engineering',
  SCIENCE: 'Science',
  COMMUNITY_SOCIAL_SERVICE: 'Community & Social Service',
  LEGAL: 'Legal',
  EDUCATION_TRAINING: 'Education & Training',
  ARTS_DESIGN_MEDIA: 'Arts, Design & Media',
  SPORTS_ENTERTAINMENT: 'Sports & Entertainment',
  HEALTHCARE_PRACTITIONER: 'Healthcare Practitioner',
  HEALTHCARE_SUPPORT: 'Healthcare Support',
  PROTECTIVE_SERVICE: 'Protective Service (Law Enforcement, Fire, Security)',
  FOOD_SERVICE: 'Food Service',
  BUILDING_GROUNDS_MAINTENANCE: 'Building & Grounds Maintenance',
  PERSONAL_CARE_SERVICE: 'Personal Care & Service',
  SALES: 'Sales',
  OFFICE_ADMINISTRATIVE: 'Office & Administrative',
  FARMING_FISHING_FORESTRY: 'Farming, Fishing & Forestry',
  CONSTRUCTION: 'Construction',
  INSTALLATION_MAINTENANCE_REPAIR: 'Installation, Maintenance & Repair',
  PRODUCTION_MANUFACTURING: 'Production & Manufacturing',
  TRANSPORTATION_MATERIAL_MOVING: 'Transportation & Material Moving',
  MILITARY_SPECIFIC: 'Military',
  GIG_ECONOMY: 'Gig Economy (Rideshare, Delivery, Freelance)',
};

export const TAG_OPTIONS = TAG_CATEGORY_VALUES.map((value) => ({ value, label: TAG_LABELS[value] }));
```

This is the single source of truth for the tag vocabulary — both Zod schemas and both creation forms import from here, rather than each defining their own copy of the 25 values.

- [ ] **Step 2: Create the `CheckboxGroup` component**

Create `src/components/ui/CheckboxGroup.tsx`:

```tsx
'use client';

import React from 'react';

type Option = { value: string; label: string };

type CheckboxGroupProps = {
  legend: string;
  name: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
};

export function CheckboxGroup({ legend, name, options, value, onChange, error }: CheckboxGroupProps) {
  const errorId = `${name}-error`;

  function toggle(optionValue: string) {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  }

  return (
    <fieldset className="mb-4" aria-describedby={error ? errorId : undefined}>
      <legend className="font-medium text-text-primary mb-2">{legend}</legend>
      {options.map((opt) => {
        const id = `${name}-${opt.value}`;
        return (
          <div key={opt.value} className="flex items-center gap-2 mb-1">
            <input
              type="checkbox"
              id={id}
              name={name}
              value={opt.value}
              checked={value.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              className="h-4 w-4"
            />
            <label htmlFor={id}>{opt.label}</label>
          </div>
        );
      })}
      {error && (
        <p id={errorId} className="mt-1 text-error-text text-sm" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 3: Add `tags` to both Zod schemas**

In `src/lib/validation/candidateProfile.ts`, change:

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

to:

```ts
import { z } from 'zod';
import { TAG_CATEGORY_VALUES } from '@/lib/tagOptions';

export const candidateProfileSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  skills: z.string().min(1, 'Skills are required'),
  bio: z.string().optional(),
  availability: z.string().min(1, 'Availability is required'),
  tags: z.array(z.enum(TAG_CATEGORY_VALUES)).optional().default([]),
});

export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
```

In `src/lib/validation/jobPosting.ts`, change:

```ts
import { z } from 'zod';

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
```

to:

```ts
import { z } from 'zod';
import { TAG_CATEGORY_VALUES } from '@/lib/tagOptions';

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
  tags: z.array(z.enum(TAG_CATEGORY_VALUES)).optional().default([]),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
```

- [ ] **Step 4: Write failing tests for tags on creation**

In `tests/integration/candidate-profile.test.ts`, add this test after `'rejects a duplicate profile with 409'` and before `afterAll`:

```ts
  it('creates a candidate profile with tags', async () => {
    const taggedUser = await prisma.user.create({
      data: { email: `candidate-tagged-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const taggedProfile = await prisma.claimantProfile.create({
      data: {
        userId: taggedUser.id,
        ssnHash: `candidate-tagged-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: taggedUser.id, role: 'CLAIMANT', claimantProfileId: taggedProfile.id, email: taggedUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({
        headline: 'Paramedic',
        skills: 'Emergency response',
        availability: 'On call',
        tags: ['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE'],
      }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    await prisma.candidateProfile.delete({ where: { claimantProfileId: taggedProfile.id } });
    await prisma.claimantProfile.delete({ where: { id: taggedProfile.id } });
    await prisma.user.delete({ where: { id: taggedUser.id } });
  });
```

In `tests/integration/employer-job-postings.test.ts`, add this test after `'creates a job posting for a verified employer'` and before `afterAll`:

```ts
  it('creates a job posting with tags', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Registered nurse',
        description: 'ICU, night shift',
        location: 'Columbia, MO',
        tags: ['HEALTHCARE_PRACTITIONER'],
      }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER']);
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/candidate-profile.test.ts tests/integration/employer-job-postings.test.ts`
Expected: FAIL — the new tests' `tags` assertions fail because the routes don't yet accept or store `tags` (Zod strips the unrecognized field silently, so `body.tags` is `undefined`, not the expected array).

- [ ] **Step 6: Wire `tags` into both POST routes**

In `src/app/api/candidate-profile/route.ts`, change the `POST` handler's create call:

```ts
    profile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: session!.user.claimantProfileId,
        headline: parsed.data.headline,
        skills: parsed.data.skills,
        bio: parsed.data.bio,
        availability: parsed.data.availability,
      },
    });
```

to:

```ts
    profile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: session!.user.claimantProfileId,
        headline: parsed.data.headline,
        skills: parsed.data.skills,
        bio: parsed.data.bio,
        availability: parsed.data.availability,
        tags: parsed.data.tags,
      },
    });
```

In `src/app/api/employer/job-postings/route.ts`, change the `POST` handler's create call:

```ts
  const posting = await prisma.jobPosting.create({
    data: {
      employerId: session!.user.employerProfileId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
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
    },
  });
```

Neither `.create()` call uses an explicit `select`, so the full created row — including `tags` — is already returned automatically; no other change is needed for the tests to pass.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/candidate-profile.test.ts tests/integration/employer-job-postings.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire `CheckboxGroup` into the candidate-profile creation form**

In `src/app/claim/candidate-profile/page.tsx`, change the imports:

```tsx
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
```

to:

```tsx
import { TextField } from '@/components/ui/TextField';
import { CheckboxGroup } from '@/components/ui/CheckboxGroup';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { TAG_OPTIONS } from '@/lib/tagOptions';
```

Add tags state, after the existing `availability` state:

```tsx
  const [availability, setAvailability] = useState('');
```

to:

```tsx
  const [availability, setAvailability] = useState('');
  const [tags, setTags] = useState<string[]>([]);
```

Change the submit body:

```tsx
    const res = await fetch('/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline, skills, bio: bio || undefined, availability }),
    });
```

to:

```tsx
    const res = await fetch('/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline, skills, bio: bio || undefined, availability, tags }),
    });
```

Add the `CheckboxGroup` to the form, after the Bio field:

```tsx
        <TextField id="bio" label="Bio (optional)" value={bio} onChange={setBio} error={fieldErrors.bio} />
        <Button type="submit">Save profile</Button>
```

to:

```tsx
        <TextField id="bio" label="Bio (optional)" value={bio} onChange={setBio} error={fieldErrors.bio} />
        <CheckboxGroup legend="Tags (optional)" name="tags" options={TAG_OPTIONS} value={tags} onChange={setTags} error={fieldErrors.tags} />
        <Button type="submit">Save profile</Button>
```

- [ ] **Step 9: Wire `CheckboxGroup` into the job-posting creation form**

In `src/app/employer/job-postings/page.tsx`, change the imports:

```tsx
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
```

to:

```tsx
import { TextField } from '@/components/ui/TextField';
import { CheckboxGroup } from '@/components/ui/CheckboxGroup';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { TAG_OPTIONS } from '@/lib/tagOptions';
```

Add tags state, after the existing `location` state:

```tsx
  const [location, setLocation] = useState('');
```

to:

```tsx
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState<string[]>([]);
```

Change the submit body:

```tsx
    const res = await fetch('/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title, description, location }),
    });
```

to:

```tsx
    const res = await fetch('/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title, description, location, tags }),
    });
```

Reset `tags` alongside the other fields on success:

```tsx
    if (res.ok) {
      setTitle('');
      setDescription('');
      setLocation('');
      await loadPostings();
      return;
    }
```

to:

```tsx
    if (res.ok) {
      setTitle('');
      setDescription('');
      setLocation('');
      setTags([]);
      await loadPostings();
      return;
    }
```

Add the `CheckboxGroup` to the form, after the Location field:

```tsx
          <TextField id="location" label="Location" value={location} onChange={setLocation} error={fieldErrors.location} required />
          <Button type="submit">Post job</Button>
```

to:

```tsx
          <TextField id="location" label="Location" value={location} onChange={setLocation} error={fieldErrors.location} required />
          <CheckboxGroup legend="Tags (optional)" name="tags" options={TAG_OPTIONS} value={tags} onChange={setTags} error={fieldErrors.tags} />
          <Button type="submit">Post job</Button>
```

- [ ] **Step 10: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/tagOptions.ts src/components/ui/CheckboxGroup.tsx src/lib/validation/candidateProfile.ts src/lib/validation/jobPosting.ts src/app/api/candidate-profile/route.ts src/app/api/employer/job-postings/route.ts src/app/claim/candidate-profile/page.tsx src/app/employer/job-postings/page.tsx tests/integration/candidate-profile.test.ts tests/integration/employer-job-postings.test.ts
git commit -m "Add tag vocabulary, CheckboxGroup, and wire tags into both creation forms"
```

---

## Task 3: Ranking function and extending the four read routes

**Files:**
- Create: `src/lib/ranking.ts`
- Test: `tests/unit/ranking.test.ts`
- Modify: `src/app/api/job-postings/route.ts`
- Modify: `src/app/api/candidate-profile/route.ts`
- Modify: `src/app/api/employer/candidates/route.ts`
- Modify: `src/app/api/employer/job-postings/route.ts`
- Test: `tests/integration/browse-and-apply.test.ts`
- Test: `tests/integration/employer-browse-and-outreach.test.ts`
- Test: `tests/integration/candidate-profile.test.ts`
- Test: `tests/integration/employer-job-postings.test.ts`

**Interfaces:**
- Consumes: `TagCategoryValue` from `src/lib/tagOptions.ts` (Task 2).
- Produces: `scoreByTagOverlap<T extends { tags: TagCategoryValue[] }>(viewerTags: TagCategoryValue[], items: T[]): T[]` — sorted by overlap count descending (ties keep input order), capped at 5, items with zero overlap excluded. Consumed by Tasks 4 and 5. All four read routes now return `tags` in their response payloads.

- [ ] **Step 1: Write the failing unit tests for the scoring function**

Create `tests/unit/ranking.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreByTagOverlap } from '@/lib/ranking';

describe('scoreByTagOverlap', () => {
  it('excludes items with no tag overlap', () => {
    const result = scoreByTagOverlap(['SALES'], [
      { id: 'a', tags: ['CONSTRUCTION'] },
      { id: 'b', tags: ['SALES'] },
    ]);
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('sorts by overlap count descending', () => {
    const result = scoreByTagOverlap(['SALES', 'OFFICE_ADMINISTRATIVE', 'MANAGEMENT'], [
      { id: 'one-match', tags: ['SALES'] },
      { id: 'three-match', tags: ['SALES', 'OFFICE_ADMINISTRATIVE', 'MANAGEMENT'] },
      { id: 'two-match', tags: ['SALES', 'MANAGEMENT'] },
    ]);
    expect(result.map((r) => r.id)).toEqual(['three-match', 'two-match', 'one-match']);
  });

  it('keeps insertion order for tied scores', () => {
    const result = scoreByTagOverlap(['SALES'], [
      { id: 'first', tags: ['SALES'] },
      { id: 'second', tags: ['SALES'] },
    ]);
    expect(result.map((r) => r.id)).toEqual(['first', 'second']);
  });

  it('caps results at 5', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}`, tags: ['SALES'] }));
    const result = scoreByTagOverlap(['SALES'], items);
    expect(result).toHaveLength(5);
  });

  it('returns an empty array when the viewer has no tags', () => {
    const result = scoreByTagOverlap([], [{ id: 'a', tags: ['SALES'] }]);
    expect(result).toEqual([]);
  });

  it('returns an empty array when no items have tags', () => {
    const result = scoreByTagOverlap(['SALES'], [{ id: 'a', tags: [] }]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/ranking.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ranking'`.

- [ ] **Step 3: Implement the scoring function**

Create `src/lib/ranking.ts`:

```ts
import type { TagCategoryValue } from '@/lib/tagOptions';

export function scoreByTagOverlap<T extends { tags: TagCategoryValue[] }>(
  viewerTags: TagCategoryValue[],
  items: T[]
): T[] {
  return items
    .map((item) => ({
      item,
      score: item.tags.filter((t) => viewerTags.includes(t)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item }) => item);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ranking.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the four routes' `select` blocks to include `tags`**

In `src/app/api/job-postings/route.ts`, change:

```ts
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      createdAt: true,
      employer: { select: { companyName: true } },
    },
```

to:

```ts
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      tags: true,
      createdAt: true,
      employer: { select: { companyName: true } },
    },
```

In `src/app/api/candidate-profile/route.ts`, change the `GET` handler's select:

```ts
  const profile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
    },
  });
```

to:

```ts
  const profile = await prisma.candidateProfile.findUnique({
    where: { claimantProfileId: session!.user.claimantProfileId },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
      tags: true,
    },
  });
```

In `src/app/api/employer/candidates/route.ts`, change:

```ts
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
```

to:

```ts
  const candidates = await prisma.candidateProfile.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
      tags: true,
      createdAt: true,
    },
  });
```

In `src/app/api/employer/job-postings/route.ts`, change the `GET` handler's select:

```ts
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
```

to:

```ts
  const postings = await prisma.jobPosting.findMany({
    where: { employerId: session!.user.employerProfileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      status: true,
      tags: true,
      createdAt: true,
    },
  });
```

- [ ] **Step 6: Extend the integration tests to confirm `tags` round-trips through each route**

In `tests/integration/browse-and-apply.test.ts`, change the `beforeAll`'s `openPosting` creation:

```ts
    const openPosting = await prisma.jobPosting.create({
      data: { employerId: employerProfileId, title: 'Retail associate', description: 'Front of store', location: 'Columbia, MO' },
    });
    openPostingId = openPosting.id;
```

to:

```ts
    const openPosting = await prisma.jobPosting.create({
      data: {
        employerId: employerProfileId,
        title: 'Retail associate',
        description: 'Front of store',
        location: 'Columbia, MO',
        tags: ['SALES'],
      },
    });
    openPostingId = openPosting.id;
```

and change the `'lists only OPEN postings'` test:

```ts
  it('lists only OPEN postings', async () => {
    const res = await listOpenPostings();
    expect(res.status).toBe(200);
    const postings = await res.json();
    const ids = postings.map((p: { id: string }) => p.id);
    expect(ids).toContain(openPostingId);
    expect(ids).not.toContain(filledPostingId);
  });
```

to:

```ts
  it('lists only OPEN postings, including tags', async () => {
    const res = await listOpenPostings();
    expect(res.status).toBe(200);
    const postings = await res.json();
    const ids = postings.map((p: { id: string }) => p.id);
    expect(ids).toContain(openPostingId);
    expect(ids).not.toContain(filledPostingId);

    const openPosting = postings.find((p: { id: string }) => p.id === openPostingId);
    expect(openPosting.tags).toEqual(['SALES']);
  });
```

In `tests/integration/employer-browse-and-outreach.test.ts`, change the `beforeAll`'s `candidateProfile` creation:

```ts
    const candidateProfile = await prisma.candidateProfile.create({
      data: { claimantProfileId, headline: 'Retail associate', skills: 'POS systems', availability: 'Immediate' },
    });
    candidateProfileId = candidateProfile.id;
```

to:

```ts
    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId,
        headline: 'Retail associate',
        skills: 'POS systems',
        availability: 'Immediate',
        tags: ['SALES'],
      },
    });
    candidateProfileId = candidateProfile.id;
```

and change the `'lists candidate profiles without leaking claimant PII'` test:

```ts
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
```

to:

```ts
  it('lists candidate profiles without leaking claimant PII, including tags', async () => {
    const res = await listCandidates();
    expect(res.status).toBe(200);
    const candidates = await res.json();
    const target = candidates.find((c: { id: string }) => c.id === candidateProfileId);
    expect(target.headline).toBe('Retail associate');
    expect(target.tags).toEqual(['SALES']);
    expect(target.legalName).toBeUndefined();
    expect(target.ssnHash).toBeUndefined();
    expect(target.claimantProfileId).toBeUndefined();
  });
```

In `tests/integration/candidate-profile.test.ts`, extend the `'creates a candidate profile with tags'` test added in Task 2. Change:

```ts
  it('creates a candidate profile with tags', async () => {
    const taggedUser = await prisma.user.create({
      data: { email: `candidate-tagged-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const taggedProfile = await prisma.claimantProfile.create({
      data: {
        userId: taggedUser.id,
        ssnHash: `candidate-tagged-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: taggedUser.id, role: 'CLAIMANT', claimantProfileId: taggedProfile.id, email: taggedUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({
        headline: 'Paramedic',
        skills: 'Emergency response',
        availability: 'On call',
        tags: ['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE'],
      }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    await prisma.candidateProfile.delete({ where: { claimantProfileId: taggedProfile.id } });
    await prisma.claimantProfile.delete({ where: { id: taggedProfile.id } });
    await prisma.user.delete({ where: { id: taggedUser.id } });
  });
```

to:

```ts
  it('creates a candidate profile with tags', async () => {
    const taggedUser = await prisma.user.create({
      data: { email: `candidate-tagged-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const taggedProfile = await prisma.claimantProfile.create({
      data: {
        userId: taggedUser.id,
        ssnHash: `candidate-tagged-hash-${Date.now()}`,
        identityVerificationStatus: 'VERIFIED',
      },
    });
    const taggedSession = {
      user: { id: taggedUser.id, role: 'CLAIMANT', claimantProfileId: taggedProfile.id, email: taggedUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    };
    vi.mocked(getServerAuthSession).mockResolvedValueOnce(taggedSession);
    const req = new Request('http://localhost/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({
        headline: 'Paramedic',
        skills: 'Emergency response',
        availability: 'On call',
        tags: ['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE'],
      }),
    });
    const res = await createProfile(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    vi.mocked(getServerAuthSession).mockResolvedValueOnce(taggedSession);
    const getRes = await getOwnProfile();
    const getBody = await getRes.json();
    expect(getBody.tags).toEqual(['HEALTHCARE_PRACTITIONER', 'PROTECTIVE_SERVICE']);

    await prisma.candidateProfile.delete({ where: { claimantProfileId: taggedProfile.id } });
    await prisma.claimantProfile.delete({ where: { id: taggedProfile.id } });
    await prisma.user.delete({ where: { id: taggedUser.id } });
  });
```

`getServerAuthSession` is mocked once per call: the `POST` handler calls it once internally, and the subsequent `getOwnProfile()` call triggers a second, independent call — each needs its own queued `mockResolvedValueOnce`, which is why the session object is extracted to a variable and queued twice.

In `tests/integration/employer-job-postings.test.ts`, extend the `'creates a job posting with tags'` test added in Task 2. Change:

```ts
  it('creates a job posting with tags', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Registered nurse',
        description: 'ICU, night shift',
        location: 'Columbia, MO',
        tags: ['HEALTHCARE_PRACTITIONER'],
      }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER']);
  });
```

to:

```ts
  it('creates a job posting with tags', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Registered nurse',
        description: 'ICU, night shift',
        location: 'Columbia, MO',
        tags: ['HEALTHCARE_PRACTITIONER'],
      }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER']);

    const listRes = await listOwnPostings();
    const list = await listRes.json();
    const created = list.find((p: { id: string }) => p.id === body.id);
    expect(created.tags).toEqual(['HEALTHCARE_PRACTITIONER']);
  });
```

This reuses the still-active `verifiedUserId` session mock set earlier in the same file — no new mock needed, since unlike the candidate-profile file, `JobPosting` has no per-employer uniqueness constraint blocking a second posting.

- [ ] **Step 7: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ranking.ts tests/unit/ranking.test.ts src/app/api/job-postings/route.ts src/app/api/candidate-profile/route.ts src/app/api/employer/candidates/route.ts src/app/api/employer/job-postings/route.ts tests/integration/browse-and-apply.test.ts tests/integration/employer-browse-and-outreach.test.ts tests/integration/candidate-profile.test.ts tests/integration/employer-job-postings.test.ts
git commit -m "Add tag-overlap ranking function and extend read routes to return tags"
```

---

## Task 4: Claimant-side "Recommended for you" section

**Files:**
- Modify: `src/app/claim/browse-postings/page.tsx`

**Interfaces:**
- Consumes: `scoreByTagOverlap` from Task 3; `GET /api/job-postings` and `GET /api/candidate-profile` (both now return `tags`, from Task 3).

- [ ] **Step 1: Rewrite the page to fetch the claimant's own tags and render a Recommended section**

Replace the full contents of `src/app/claim/browse-postings/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { scoreByTagOverlap } from '@/lib/ranking';
import type { TagCategoryValue } from '@/lib/tagOptions';

type JobPosting = {
  id: string;
  title: string;
  description: string;
  location: string;
  tags: TagCategoryValue[];
  createdAt: string;
  employer: { companyName: string | null };
};

export default function BrowsePostingsPage() {
  const { data: session, status } = useSession();
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [myTags, setMyTags] = useState<TagCategoryValue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  async function loadPostings() {
    const [postingsRes, profileRes] = await Promise.all([
      fetch('/api/job-postings'),
      fetch('/api/candidate-profile'),
    ]);
    if (!postingsRes.ok) {
      setLoadError('We could not load job postings. Please try again.');
      return;
    }
    setPostings(await postingsRes.json());
    if (profileRes.ok) {
      const profile = await profileRes.json();
      setMyTags(profile.tags ?? []);
    }
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

  const recommended = postings ? scoreByTagOverlap(myTags, postings) : [];

  function renderPosting(p: JobPosting) {
    return (
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

      {recommended.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">Recommended for you</h2>
          <ul className="space-y-4">{recommended.map(renderPosting)}</ul>
        </section>
      )}

      {postings !== null && postings.length === 0 && (
        <p className="text-sm text-text-secondary">No open postings right now.</p>
      )}
      {postings !== null && postings.length > 0 && (
        <ul className="space-y-4">{postings.map(renderPosting)}</ul>
      )}
    </main>
  );
}
```

The `renderPosting` helper is shared between the Recommended section and the full list, so the same posting can appear in both without duplicating markup, and `appliedIds` (keyed by posting id) stays correct in whichever section a claimant clicks Apply from.

- [ ] **Step 2: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS. (No new automated test in this task — the E2E flow in Task 6 is what exercises this page's new rendering; the page itself has no route-level logic to unit test beyond what Task 3's `scoreByTagOverlap` tests already cover.)

- [ ] **Step 3: Commit**

```bash
git add src/app/claim/browse-postings/page.tsx
git commit -m "Add Recommended for you section to the claimant browse-postings page"
```

---

## Task 5: Employer-side "Recommended for [posting]" section

**Files:**
- Modify: `src/app/employer/browse-candidates/page.tsx`

**Interfaces:**
- Consumes: `scoreByTagOverlap` from Task 3; `GET /api/employer/candidates` and `GET /api/employer/job-postings` (both now return `tags`, from Task 3).

Note: the existing page's `selectedPostingId` state is a **per-candidate** map used only by the reach-out form (each candidate card has its own "which posting?" dropdown). That is not a single global selector, so it cannot be reused directly for "which posting am I viewing recommendations for" — this task adds a **new**, separate, page-level `recommendPostingId` selector at the top of the page, left entirely independent of the existing per-candidate reach-out selectors.

- [ ] **Step 1: Rewrite the page to add the posting selector and Recommended section**

Replace the full contents of `src/app/employer/browse-candidates/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { scoreByTagOverlap } from '@/lib/ranking';
import type { TagCategoryValue } from '@/lib/tagOptions';

type Candidate = {
  id: string;
  headline: string;
  skills: string;
  bio: string | null;
  availability: string;
  tags: TagCategoryValue[];
};

type JobPosting = {
  id: string;
  title: string;
  status: 'OPEN' | 'FILLED';
  tags: TagCategoryValue[];
};

export default function BrowseCandidatesPage() {
  const { data: session, status } = useSession();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [selectedPostingId, setSelectedPostingId] = useState<Record<string, string>>({});
  const [recommendPostingId, setRecommendPostingId] = useState<string>('');
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
    const openPostings = (await postingsRes.json()).filter((p: JobPosting) => p.status === 'OPEN');
    setPostings(openPostings);
    if (openPostings.length === 1) {
      setRecommendPostingId(openPostings[0].id);
    }
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

  const selectedRecommendPosting = postings?.find((p) => p.id === recommendPostingId) ?? null;
  const recommended =
    candidates && selectedRecommendPosting
      ? scoreByTagOverlap(selectedRecommendPosting.tags, candidates)
      : [];

  function renderCandidate(c: Candidate) {
    return (
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

      {postings !== null && postings.length > 0 && (
        <div className="mb-6">
          <label htmlFor="recommend-posting" className="block font-medium text-text-primary mb-1">
            Show recommendations for
          </label>
          <select
            id="recommend-posting"
            value={recommendPostingId}
            onChange={(e) => setRecommendPostingId(e.target.value)}
            className="w-full max-w-sm rounded border border-border px-3 py-2"
          >
            <option value="">Select a posting</option>
            {postings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {recommended.length > 0 && selectedRecommendPosting && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">Recommended for {selectedRecommendPosting.title}</h2>
          <ul className="space-y-4">{recommended.map(renderCandidate)}</ul>
        </section>
      )}

      {candidates === null && !loadError && <p>Loading…</p>}
      {candidates !== null && candidates.length === 0 && (
        <p className="text-sm text-text-secondary">No candidates on the marketplace yet.</p>
      )}
      {candidates !== null && candidates.length > 0 && (
        <ul className="space-y-4">{candidates.map(renderCandidate)}</ul>
      )}
    </main>
  );
}
```

The `renderCandidate` helper is shared between the Recommended section and the full list, so `reachedOutIds` and each candidate's own `selectedPostingId` entry stay correct regardless of which section a card is rendered in.

- [ ] **Step 2: Run the full unit + integration suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/employer/browse-candidates/page.tsx
git commit -m "Add posting selector and Recommended candidates section to the employer browse-candidates page"
```

---

## Task 6: E2E extension and accessibility

**Files:**
- Modify: `tests/e2e/employer-marketplace-flow.spec.ts`

**Interfaces:**
- Consumes: everything built in Tasks 1-5.

- [ ] **Step 1: Add tags to the candidate profile and job posting steps**

In `tests/e2e/employer-marketplace-flow.spec.ts`, change the "Build a candidate profile" block:

```ts
  // Build a candidate profile.
  await page.goto('/claim/candidate-profile');
  await waitForHydration(page);
  await page.getByLabel('Headline').fill('Warehouse associate');
  await page.getByLabel('Skills').fill('Forklift certified, inventory management');
  await page.getByLabel('Availability').fill('Immediate');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Warehouse associate')).toBeVisible();
```

to:

```ts
  // Build a candidate profile, tagged so it surfaces in the employer's
  // "Recommended for [posting]" section and the posting surfaces in the
  // claimant's "Recommended for you" section.
  await page.goto('/claim/candidate-profile');
  await waitForHydration(page);
  await page.getByLabel('Headline').fill('Warehouse associate');
  await page.getByLabel('Skills').fill('Forklift certified, inventory management');
  await page.getByLabel('Availability').fill('Immediate');
  await page.getByLabel('Transportation & Material Moving').check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Warehouse associate')).toBeVisible();
```

Change the "Post a job" block:

```ts
  // Post a job.
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByLabel('Title').fill('Warehouse associate');
  await page.getByLabel('Description').fill('Day shift, full time');
  await page.getByLabel('Location').fill('Jefferson City, MO');
  await page.getByRole('button', { name: 'Post job' }).click();
  await expect(page.getByText('Warehouse associate').first()).toBeVisible();
```

to:

```ts
  // Post a job with the same tag as the candidate profile above.
  await page.goto('/employer/job-postings');
  await waitForHydration(page);
  await page.getByLabel('Title').fill('Warehouse associate');
  await page.getByLabel('Description').fill('Day shift, full time');
  await page.getByLabel('Location').fill('Jefferson City, MO');
  await page.getByLabel('Transportation & Material Moving').check();
  await page.getByRole('button', { name: 'Post job' }).click();
  await expect(page.getByText('Warehouse associate').first()).toBeVisible();
```

- [ ] **Step 2: Add the axe-core import**

Change the imports at the top of the file:

```ts
// tests/e2e/employer-marketplace-flow.spec.ts
import { test, expect } from '@playwright/test';
import { prisma } from '../../src/lib/prisma';
import { waitForHydration } from './helpers';
```

to:

```ts
// tests/e2e/employer-marketplace-flow.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prisma } from '../../src/lib/prisma';
import { waitForHydration } from './helpers';
```

- [ ] **Step 3: Assert the claimant's "Recommended for you" section, and run an accessibility scan with it rendered**

This is the one place in the suite this state gets checked — `accessibility.spec.ts`'s own fixture accounts have no tags set, so its four existing marketplace-page scans never render a "Recommended" section.

Change the "Apply as the claimant" block:

```ts
  await claimantPage.goto('/claim/browse-postings');
  await waitForHydration(claimantPage);
  await expect(claimantPage.getByText('Warehouse associate').first()).toBeVisible();
  await claimantPage.getByRole('button', { name: 'Apply' }).click();
  await expect(claimantPage.getByText('✓ Applied')).toBeVisible();
```

to:

```ts
  await claimantPage.goto('/claim/browse-postings');
  await waitForHydration(claimantPage);
  await expect(claimantPage.getByRole('heading', { name: 'Recommended for you' })).toBeVisible();
  await expect(claimantPage.getByText('Warehouse associate').first()).toBeVisible();

  const results = await new AxeBuilder({ page: claimantPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // The posting now renders in both the Recommended section and the full
  // list below it (Task 4), so both the button and its resulting status
  // text resolve to two elements — .first() picks the Recommended
  // section's copy, and clicking it updates appliedIds for the shared
  // posting id, so the full list's copy reflects the same state too.
  await claimantPage.getByRole('button', { name: 'Apply' }).first().click();
  await expect(claimantPage.getByText('✓ Applied').first()).toBeVisible();
```

- [ ] **Step 4: Assert the employer's "Recommended for [posting]" section**

Insert this new block after the claimant-apply block above and before the existing "Hire as the employer" block:

```ts
  // Employer's browse-candidates page recommends the tagged candidate for
  // the matching posting. Since this employer has exactly one open
  // posting, the page auto-selects it — the explicit selectOption call
  // below is just defensive against that timing.
  await page.goto('/employer/browse-candidates');
  await waitForHydration(page);
  await page.getByLabel('Show recommendations for').selectOption({ label: 'Warehouse associate' });
  await expect(page.getByRole('heading', { name: 'Recommended for Warehouse associate' })).toBeVisible();
  await expect(page.getByText('Warehouse associate').first()).toBeVisible();
```

- [ ] **Step 5: Run the E2E test to verify it passes**

Run: `rm -rf .next && npx playwright test employer-marketplace-flow.spec.ts --reporter=list`
Expected: PASS. If a selector doesn't match the live DOM, read the actual current page source for that route and correct the selector — the code in this plan was grounded in a direct read of the current source, but double-check against the live DOM per this session's established practice for E2E work.

- [ ] **Step 6: Run the full E2E suite**

Run: `rm -rf .next && npx playwright test --reporter=list`
Expected: All tests pass, including the extended marketplace flow spec and the pre-existing four marketplace accessibility scans (unaffected, since fixture accounts have no tags and so render no "Recommended" section).

- [ ] **Step 7: Run the full unit + integration suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Run a production build**

Run: `rm -rf .next && npm run build`
Expected: Builds cleanly with no type errors.

- [ ] **Step 9: Commit**

```bash
git add tests/e2e/employer-marketplace-flow.spec.ts
git commit -m "Extend E2E flow with tags and Recommended-section coverage, including an accessibility scan"
```

---
