# Credential Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a claimant or caseworker request that a named organization (reusing `EmployerProfile` as the general "verifying organization") confirm a credential — education, military service, law enforcement, or certification — through a consent-based request/authorize/respond workflow, plus a secondary agreement-gated proactive-reporting path.

**Architecture:** Two new Prisma models (`CredentialVerificationRequest` the workflow, `CredentialRecord` the confirmed fact) alongside, not merged into, the existing `EmploymentEvent`. New API routes mirror this codebase's two closest existing precedents almost exactly: `src/app/api/employer/events/route.ts` for proactive reporting, and the `src/app/staff/unmatched-events/*` routes for compare-and-swap resolution of an unmatched record.

**Tech Stack:** Next.js 14 App Router, Prisma 5 + PostgreSQL, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- `EmploymentEvent` is never modified by this plan.
- `CredentialVerificationRequest.status` starts `AUTHORIZED` when a `CLAIMANT` session creates it (self-request = self-authorization), and `PENDING_AUTHORIZATION` when a `CASEWORKER`/`ADMIN` session creates it on a claimant's behalf.
- The claimant can only authorize/decline their own requests (`requireOwnership`), and only while `status = PENDING_AUTHORIZATION`.
- The organization can only respond to a request whose `organizationId` matches their own `employerProfileId`, and only while `status = AUTHORIZED`.
- Every state transition writes an `AuditLog` entry, `targetEntity: 'CredentialVerificationRequest'`.
- The proactive-reporting route requires both `verificationStatus === 'VERIFIED'` (checked fresh from the database) and `credentialReportingAgreement === true`.
- Every route that resolves a record from an "unresolved" state to a resolved one uses the compare-and-swap `updateMany` + `count === 0` → `409` pattern already established in `src/app/api/staff/unmatched-events/[id]/{match,dismiss}/route.ts` — never a plain `findUnique` + `update`, which races.
- Follow this codebase's established API error shape (`src/lib/apiRequest.ts`) and audit convention (`src/lib/audit.ts`).

---

### Task 1: Schema, migration, and seeded university account

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`

**Interfaces:**
- Produces: `CredentialType` enum (`EDUCATION | MILITARY_SERVICE | LAW_ENFORCEMENT | CERTIFICATION | OTHER`), `CredentialRequestStatus` enum (`PENDING_AUTHORIZATION | AUTHORIZED | CONFIRMED | NO_RECORD_FOUND | DECLINED`), `CredentialReportingMethod` enum (`REQUEST_RESPONSE | PROACTIVE_AGREEMENT`), `CredentialVerificationRequest` model, `CredentialRecord` model, `EmployerProfile.credentialReportingAgreement`. A seeded `State University` employer account (`university@example.com`, `VERIFIED`, `credentialReportingAgreement: true`), used by later tasks' tests and the demo.

- [ ] **Step 1: Add the three new enums**

In `prisma/schema.prisma`, immediately after `enum InterviewStatus` (current lines 127–131), insert:

```prisma
enum CredentialType {
  EDUCATION
  MILITARY_SERVICE
  LAW_ENFORCEMENT
  CERTIFICATION
  OTHER
}

enum CredentialRequestStatus {
  PENDING_AUTHORIZATION
  AUTHORIZED
  CONFIRMED
  NO_RECORD_FOUND
  DECLINED
}

enum CredentialReportingMethod {
  REQUEST_RESPONSE
  PROACTIVE_AGREEMENT
}
```

- [ ] **Step 2: Add `credentialReportingAgreement` to `EmployerProfile`**

Replace the current `EmployerProfile` model (lines 327–338):

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
  jobPostings      JobPosting[]
}
```

with:

```prisma
model EmployerProfile {
  id                 String             @id @default(cuid())
  userId             String             @unique
  user               User               @relation(fields: [userId], references: [id])
  fein               String?            @unique
  companyName        String?
  verificationStatus VerificationStatus @default(PENDING)
  createdAt          DateTime           @default(now())
  // Gates the proactive credential-reporting path (POST
  // /api/employer/credentials) — an org can be VERIFIED without this being
  // true. Admin-set only in this pass: no self-service UI, matching how the
  // design spec scoped it (a real, out-of-band "lawful reporting agreement"
  // precedes flipping this flag).
  credentialReportingAgreement Boolean @default(false)

  employmentEvents               EmploymentEvent[]
  jobPostings                    JobPosting[]
  credentialRecords              CredentialRecord[]
  credentialVerificationRequests CredentialVerificationRequest[]
}
```

- [ ] **Step 3: Add the two new relations on `User`**

Replace line 148 (the last line of `model User`, currently `  triggeredEmploymentEvents EmploymentEvent[] @relation("EmploymentEventTriggeredBy")`) — keep that line, and add two more directly after it, before the model's closing `}`:

```prisma
  triggeredEmploymentEvents EmploymentEvent[] @relation("EmploymentEventTriggeredBy")
  requestedCredentialVerifications CredentialVerificationRequest[] @relation("CredentialVerificationRequestedBy")
  respondedCredentialVerifications CredentialVerificationRequest[] @relation("CredentialVerificationRespondedBy")
```

- [ ] **Step 4: Add the new relation on `ClaimantProfile`**

Replace line 172 (the last line of `model ClaimantProfile`, currently `  candidateProfile        CandidateProfile?`) — keep it, and add one more line directly after it, before the model's closing `}`:

```prisma
  candidateProfile        CandidateProfile?
  credentialRecords              CredentialRecord[]
  credentialVerificationRequests CredentialVerificationRequest[]
```

- [ ] **Step 5: Add the two new models**

Immediately after the `EmploymentEvent` model (ends at current line 367), insert:

```prisma
model CredentialVerificationRequest {
  id                 String                   @id @default(cuid())
  claimantProfileId  String
  claimantProfile    ClaimantProfile          @relation(fields: [claimantProfileId], references: [id])
  organizationId     String
  organization       EmployerProfile          @relation(fields: [organizationId], references: [id])
  credentialType     CredentialType
  requestedTitle     String?
  requestedByUserId  String
  requestedByUser    User                     @relation("CredentialVerificationRequestedBy", fields: [requestedByUserId], references: [id])
  status             CredentialRequestStatus  @default(PENDING_AUTHORIZATION)
  authorizedAt       DateTime?
  declinedAt         DateTime?
  respondedAt        DateTime?
  respondedByUserId  String?
  respondedByUser    User?                    @relation("CredentialVerificationRespondedBy", fields: [respondedByUserId], references: [id])
  responseNote       String?
  resultingCredentialRecordId String?         @unique
  resultingCredentialRecord   CredentialRecord? @relation(fields: [resultingCredentialRecordId], references: [id])
  createdAt          DateTime                 @default(now())
}

model CredentialRecord {
  id                       String                     @id @default(cuid())
  organizationId           String
  organization             EmployerProfile            @relation(fields: [organizationId], references: [id])
  type                     CredentialType
  title                    String
  eventDate                DateTime
  detailsSchemaVersion     Int                        @default(1)
  details                  Json
  // Nullable: only ever populated for the proactive path, where it's the
  // matching key (mirroring EmploymentEvent.ssnHash). A request-response-
  // originated record is already matched via matchedClaimantProfileId
  // directly — no SSN needed, and the claimant's own ssnHash may not even
  // exist yet if they haven't completed identity verification.
  ssnHash                  String?
  matchedClaimantProfileId String?
  matchedClaimantProfile   ClaimantProfile?           @relation(fields: [matchedClaimantProfileId], references: [id])
  reportedVia              CredentialReportingMethod
  createdAt                DateTime                   @default(now())
  dismissedAt              DateTime?
  dismissedByUserId        String?
  dismissedBy              User?                      @relation(fields: [dismissedByUserId], references: [id])
  sourceRequest            CredentialVerificationRequest?
}
```

- [ ] **Step 6: Generate and run the migration**

Run: `npx prisma migrate dev --name add_credential_verification`
Expected: a new folder under `prisma/migrations/`, `Your database is now in sync with your schema.`, no data-loss warnings (every new field/model is additive).

- [ ] **Step 7: Seed a verified university employer account**

In `prisma/seed.ts`, immediately after the existing unmatched-employer-event block (ends at current line 417, the `if (!existingUnmatchedEvent) { ... }` block), insert:

```ts
  // A second VERIFIED employer, distinct from the marketplace employer
  // above, specifically to demonstrate that any FEIN-verified organization
  // can act as a credential-verifying org — not just employers in the
  // ordinary sense. credentialReportingAgreement: true also lets it
  // exercise the proactive-reporting path in tests/demos.
  const universityPasswordHash = await bcrypt.hash('UniversityPass123', 12);
  const universityUser = await prisma.user.upsert({
    where: { email: 'university@example.com' },
    update: {},
    create: {
      email: 'university@example.com',
      passwordHash: universityPasswordHash,
      role: 'EMPLOYER',
    },
  });
  await prisma.employerProfile.upsert({
    where: { userId: universityUser.id },
    update: {},
    create: {
      userId: universityUser.id,
      fein: '43-7788990',
      companyName: 'State University',
      verificationStatus: 'VERIFIED',
      credentialReportingAgreement: true,
    },
  });
```

- [ ] **Step 8: Add a seed summary line**

After the existing `console.log('Seed complete: system@emplement.internal ...')` line (current line 423), add:

```ts
  console.log('Seed complete: university@example.com / UniversityPass123 (VERIFIED organization for credential verification demos)');
```

- [ ] **Step 9: Run the seed script to confirm it's idempotent**

Run: `npm run db:seed` twice in a row. Expected: completes without error both times, including the new university line, no duplicate rows.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat: add credential verification schema and seeded university account"
```

---

### Task 2: Validation schemas

**Files:**
- Create: `src/lib/validation/credential.ts`
- Test: `tests/unit/credentialValidation.test.ts`

**Interfaces:**
- Produces: `CREDENTIAL_TYPE_VALUES` (array of the 5 type strings, for `Select` options elsewhere), `parseCredentialDetails(type, details)` returning a Zod `SafeParseReturnType`, `credentialRequestCreateSchema`, `credentialResponseSchema` (discriminated union), `proactiveCredentialReportSchema`. Consumed by every route task below.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/credentialValidation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseCredentialDetails,
  credentialRequestCreateSchema,
  credentialResponseSchema,
  proactiveCredentialReportSchema,
} from '@/lib/validation/credential';

describe('parseCredentialDetails', () => {
  it('accepts valid EDUCATION details', () => {
    const result = parseCredentialDetails('EDUCATION', {
      schemaVersion: 1,
      major: 'Computer Science',
      degreeType: "Bachelor's",
      graduationDate: '2018-05-15',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid MILITARY_SERVICE details', () => {
    const result = parseCredentialDetails('MILITARY_SERVICE', {
      schemaVersion: 1,
      branch: 'U.S. Army',
      rank: 'Sergeant',
    });
    expect(result.success).toBe(true);
  });

  it('rejects MILITARY_SERVICE details missing the required branch field', () => {
    const result = parseCredentialDetails('MILITARY_SERVICE', { schemaVersion: 1, rank: 'Sergeant' });
    expect(result.success).toBe(false);
  });

  it('accepts valid LAW_ENFORCEMENT details', () => {
    const result = parseCredentialDetails('LAW_ENFORCEMENT', { schemaVersion: 1, agency: 'Rolla Police Department' });
    expect(result.success).toBe(true);
  });

  it('accepts valid CERTIFICATION details', () => {
    const result = parseCredentialDetails('CERTIFICATION', {
      schemaVersion: 1,
      certificationName: 'Certified Public Accountant',
      expirationDate: '2030-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects CERTIFICATION details missing the required certificationName field', () => {
    const result = parseCredentialDetails('CERTIFICATION', { schemaVersion: 1 });
    expect(result.success).toBe(false);
  });

  it('accepts valid OTHER details', () => {
    const result = parseCredentialDetails('OTHER', { schemaVersion: 1, description: 'Volunteer firefighter, 2015-2020' });
    expect(result.success).toBe(true);
  });

  it('rejects a details object with the wrong schemaVersion', () => {
    const result = parseCredentialDetails('EDUCATION', { schemaVersion: 2, major: 'Computer Science' });
    expect(result.success).toBe(false);
  });
});

describe('credentialRequestCreateSchema', () => {
  it('accepts a valid request with all fields', () => {
    const result = credentialRequestCreateSchema.safeParse({
      organizationId: 'org-1',
      credentialType: 'EDUCATION',
      requestedTitle: "Bachelor's degree, Computer Science, ~2018",
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid request with requestedTitle omitted', () => {
    const result = credentialRequestCreateSchema.safeParse({ organizationId: 'org-1', credentialType: 'CERTIFICATION' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid credentialType', () => {
    const result = credentialRequestCreateSchema.safeParse({ organizationId: 'org-1', credentialType: 'NOT_A_TYPE' });
    expect(result.success).toBe(false);
  });
});

describe('credentialResponseSchema', () => {
  it('accepts a confirming response', () => {
    const result = credentialResponseSchema.safeParse({
      confirmed: true,
      title: 'Bachelor of Science in Computer Science',
      eventDate: '2018-05-15',
      details: { schemaVersion: 1, major: 'Computer Science' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a denying response with no note', () => {
    const result = credentialResponseSchema.safeParse({ confirmed: false });
    expect(result.success).toBe(true);
  });

  it('rejects a confirming response missing title', () => {
    const result = credentialResponseSchema.safeParse({ confirmed: true, eventDate: '2018-05-15', details: {} });
    expect(result.success).toBe(false);
  });
});

describe('proactiveCredentialReportSchema', () => {
  it('accepts a valid proactive report', () => {
    const result = proactiveCredentialReportSchema.safeParse({
      ssn: '123-45-6789',
      type: 'EDUCATION',
      title: 'Bachelor of Science in Computer Science',
      eventDate: '2018-05-15',
      details: { schemaVersion: 1, major: 'Computer Science' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed SSN', () => {
    const result = proactiveCredentialReportSchema.safeParse({
      ssn: 'not-an-ssn',
      type: 'EDUCATION',
      title: 'Degree',
      eventDate: '2018-05-15',
      details: { schemaVersion: 1 },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/credentialValidation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/validation/credential'`.

- [ ] **Step 3: Implement `src/lib/validation/credential.ts`**

```ts
import { z } from 'zod';

export const CREDENTIAL_TYPE_VALUES = [
  'EDUCATION',
  'MILITARY_SERVICE',
  'LAW_ENFORCEMENT',
  'CERTIFICATION',
  'OTHER',
] as const;

export type CredentialTypeValue = (typeof CREDENTIAL_TYPE_VALUES)[number];

const educationDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  major: z.string().optional(),
  degreeType: z.string().optional(),
  graduationDate: z.string().optional(),
});

const militaryServiceDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  branch: z.string().min(1, 'Branch is required'),
  rank: z.string().optional(),
  dischargeType: z.string().optional(),
});

const lawEnforcementDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  agency: z.string().min(1, 'Agency is required'),
  role: z.string().optional(),
});

const certificationDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  certificationName: z.string().min(1, 'Certification name is required'),
  expirationDate: z.string().optional(),
});

const otherDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().min(1, 'Description is required'),
});

// One schema per CredentialType, each validated against the request's own
// type — never trust a client-supplied type/details pairing without this.
// schemaVersion is a literal today (only version 1 exists); a future shape
// change adds schemaVersion: 2 alongside it rather than replacing it, so
// old CredentialRecord rows stay parseable by whichever schema matches
// their own stamped detailsSchemaVersion.
export function parseCredentialDetails(type: CredentialTypeValue, details: unknown) {
  switch (type) {
    case 'EDUCATION':
      return educationDetailsSchema.safeParse(details);
    case 'MILITARY_SERVICE':
      return militaryServiceDetailsSchema.safeParse(details);
    case 'LAW_ENFORCEMENT':
      return lawEnforcementDetailsSchema.safeParse(details);
    case 'CERTIFICATION':
      return certificationDetailsSchema.safeParse(details);
    case 'OTHER':
      return otherDetailsSchema.safeParse(details);
  }
}

export const credentialRequestCreateSchema = z.object({
  claimantProfileId: z.string().optional(),
  organizationId: z.string().min(1, 'Organization is required'),
  credentialType: z.enum(CREDENTIAL_TYPE_VALUES),
  requestedTitle: z.string().optional(),
});

const credentialResponseConfirmSchema = z.object({
  confirmed: z.literal(true),
  title: z.string().min(1, 'Title is required'),
  eventDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  details: z.record(z.unknown()),
});

const credentialResponseDenySchema = z.object({
  confirmed: z.literal(false),
  responseNote: z.string().optional(),
});

export const credentialResponseSchema = z.discriminatedUnion('confirmed', [
  credentialResponseConfirmSchema,
  credentialResponseDenySchema,
]);

export const proactiveCredentialReportSchema = z.object({
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  type: z.enum(CREDENTIAL_TYPE_VALUES),
  title: z.string().min(1, 'Title is required'),
  eventDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  details: z.record(z.unknown()),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/credentialValidation.test.ts`
Expected: PASS, all 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/credential.ts tests/unit/credentialValidation.test.ts
git commit -m "feat: add credential validation schemas"
```

---

### Task 3: Organization picker endpoint

**Files:**
- Create: `src/app/api/organizations/route.ts`
- Test: `tests/integration/organizations-search.test.ts`

**Interfaces:**
- Produces: `GET /api/organizations?q=` → `{ id: string; companyName: string }[]`, `VERIFIED` organizations only, `take: 25`. Consumed by the claimant request page, the employer/organization side is never a caller of this (an org doesn't search for itself), and the staff case page (Task 10).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/organizations-search.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as searchOrganizations } from '@/app/api/organizations/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('GET /api/organizations', () => {
  let verifiedUserId: string;
  let verifiedProfileId: string;
  let unverifiedUserId: string;
  let unverifiedProfileId: string;
  let claimantUserId: string;

  beforeAll(async () => {
    const verifiedUser = await prisma.user.create({
      data: { email: `org-search-verified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    verifiedUserId = verifiedUser.id;
    const verifiedProfile = await prisma.employerProfile.create({
      data: { userId: verifiedUser.id, companyName: 'Org Search Verified University', verificationStatus: 'VERIFIED' },
    });
    verifiedProfileId = verifiedProfile.id;

    const unverifiedUser = await prisma.user.create({
      data: { email: `org-search-unverified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    unverifiedUserId = unverifiedUser.id;
    const unverifiedProfile = await prisma.employerProfile.create({
      data: { userId: unverifiedUser.id, companyName: 'Org Search Unverified University', verificationStatus: 'PENDING' },
    });
    unverifiedProfileId = unverifiedProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `org-search-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId: 'irrelevant', email: claimantUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('returns matching VERIFIED organizations only, never unverified ones', async () => {
    const res = await searchOrganizations(new Request('http://localhost/api/organizations?q=Org Search'));
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.some((r: { id: string }) => r.id === verifiedProfileId)).toBe(true);
    expect(results.some((r: { id: string }) => r.id === unverifiedProfileId)).toBe(false);
  });

  it('rejects an EMPLOYER session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: verifiedUserId, role: 'EMPLOYER', employerProfileId: verifiedProfileId, email: 'employer@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await searchOrganizations(new Request('http://localhost/api/organizations?q=Org'));
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.employerProfile.delete({ where: { id: verifiedProfileId } });
    await prisma.user.delete({ where: { id: verifiedUserId } });
    await prisma.employerProfile.delete({ where: { id: unverifiedProfileId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/organizations-search.test.ts`
Expected: FAIL — the route module doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/organizations/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

// A verified-organization picker for the credential-verification request
// flow (claimant and staff pages both search by name to pick a target
// organization). Only VERIFIED EmployerProfiles are returned — an
// unverified one can't be asked to verify anything.
export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';

  const organizations = await prisma.employerProfile.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      companyName: { contains: q, mode: 'insensitive' },
    },
    select: { id: true, companyName: true },
    orderBy: { companyName: 'asc' },
    take: 25,
  });

  return Response.json(organizations);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/organizations-search.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/organizations/route.ts tests/integration/organizations-search.test.ts
git commit -m "feat: add verified-organization picker endpoint"
```

---

### Task 4: Verification request core routes (create, authorize, decline, list)

**Files:**
- Create: `src/app/api/verification-requests/route.ts`
- Create: `src/app/api/verification-requests/[id]/authorize/route.ts`
- Create: `src/app/api/verification-requests/[id]/decline/route.ts`
- Test: `tests/integration/verification-requests-create.test.ts`
- Test: `tests/integration/verification-requests-authorize-decline.test.ts`

**Interfaces:**
- Consumes: `credentialRequestCreateSchema` from Task 2.
- Produces: `POST /api/verification-requests` → `201 { id }`; `GET /api/verification-requests?claimantProfileId=` → list; `POST /api/verification-requests/[id]/{authorize,decline}` → `200 { id }`. Consumed by the claimant page (Task 8) and the staff case page (Task 10).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/verification-requests-create.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as createRequest, GET as listRequests } from '@/app/api/verification-requests/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/verification-requests', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let caseworkerUserId: string;
  let orgUserId: string;
  let orgProfileId: string;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `vr-create-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'VR Create Claimant' },
    });
    claimantProfileId = claimantProfile.id;

    const caseworkerUser = await prisma.user.create({
      data: { email: `vr-create-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const orgUser = await prisma.user.create({
      data: { email: `vr-create-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'VR Create Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;
  });

  it('creates a self-authorized request when a CLAIMANT session creates it', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgProfileId, credentialType: 'EDUCATION', requestedTitle: 'BS Computer Science' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdRequestIds.push(body.id);

    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: body.id } });
    expect(request?.status).toBe('AUTHORIZED');
    expect(request?.authorizedAt).not.toBeNull();
    expect(request?.claimantProfileId).toBe(claimantProfileId);
    expect(request?.requestedByUserId).toBe(claimantUserId);
  });

  it('ignores a client-supplied claimantProfileId when a CLAIMANT session creates it', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ claimantProfileId: 'someone-elses-id', organizationId: orgProfileId, credentialType: 'CERTIFICATION' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdRequestIds.push(body.id);
    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: body.id } });
    expect(request?.claimantProfileId).toBe(claimantProfileId);
  });

  it('creates a PENDING_AUTHORIZATION request when a CASEWORKER session creates it on behalf of a claimant', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ claimantProfileId, organizationId: orgProfileId, credentialType: 'MILITARY_SERVICE' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdRequestIds.push(body.id);
    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: body.id } });
    expect(request?.status).toBe('PENDING_AUTHORIZATION');
    expect(request?.authorizedAt).toBeNull();
    expect(request?.requestedByUserId).toBe(caseworkerUserId);
  });

  it('returns 400 when a CASEWORKER session omits claimantProfileId', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgProfileId, credentialType: 'EDUCATION' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the target organization is not VERIFIED', async () => {
    const unverifiedOrgUser = await prisma.user.create({
      data: { email: `vr-create-unverified-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    const unverifiedOrgProfile = await prisma.employerProfile.create({
      data: { userId: unverifiedOrgUser.id, companyName: 'Unverified Org', verificationStatus: 'PENDING' },
    });
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await createRequest(
      new Request('http://localhost/api/verification-requests', {
        method: 'POST',
        body: JSON.stringify({ organizationId: unverifiedOrgProfile.id, credentialType: 'EDUCATION' }),
      })
    );
    expect(res.status).toBe(400);
    await prisma.employerProfile.delete({ where: { id: unverifiedOrgProfile.id } });
    await prisma.user.delete({ where: { id: unverifiedOrgUser.id } });
  });

  it('lists a claimant\'s own requests via GET', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listRequests(new Request('http://localhost/api/verification-requests'));
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r: { organization: { companyName: string } }) => r.organization.companyName === 'VR Create Test University')).toBe(true);
  });

  it('requires claimantProfileId as a query param for a CASEWORKER session listing via GET', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listRequests(new Request('http://localhost/api/verification-requests'));
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [claimantUserId, caseworkerUserId] } } });
    await prisma.credentialVerificationRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

Create `tests/integration/verification-requests-authorize-decline.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as authorizeRequest } from '@/app/api/verification-requests/[id]/authorize/route';
import { POST as declineRequest } from '@/app/api/verification-requests/[id]/decline/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/verification-requests/[id]/{authorize,decline}', () => {
  let claimantUserId: string;
  let claimantProfileId: string;
  let otherClaimantUserId: string;
  let otherClaimantProfileId: string;
  let orgUserId: string;
  let orgProfileId: string;
  let pendingRequestId: string;
  let secondPendingRequestId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `vr-auth-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id, legalName: 'VR Auth Claimant' } });
    claimantProfileId = claimantProfile.id;

    const otherClaimantUser = await prisma.user.create({
      data: { email: `vr-auth-other-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    otherClaimantUserId = otherClaimantUser.id;
    const otherClaimantProfile = await prisma.claimantProfile.create({ data: { userId: otherClaimantUser.id, legalName: 'VR Auth Other Claimant' } });
    otherClaimantProfileId = otherClaimantProfile.id;

    const orgUser = await prisma.user.create({
      data: { email: `vr-auth-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'VR Auth Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;

    const pendingRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'EDUCATION', requestedByUserId: claimantUserId, status: 'PENDING_AUTHORIZATION' },
    });
    pendingRequestId = pendingRequest.id;

    const secondPendingRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'CERTIFICATION', requestedByUserId: claimantUserId, status: 'PENDING_AUTHORIZATION' },
    });
    secondPendingRequestId = secondPendingRequest.id;
  });

  it('rejects authorizing someone else\'s request with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: otherClaimantUserId, role: 'CLAIMANT', claimantProfileId: otherClaimantProfileId, email: 'other@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request(`http://localhost/api/verification-requests/${pendingRequestId}/authorize`, { method: 'POST' }),
      { params: { id: pendingRequestId } }
    );
    expect(res.status).toBe(403);
  });

  it('authorizes a PENDING_AUTHORIZATION request owned by the caller', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request(`http://localhost/api/verification-requests/${pendingRequestId}/authorize`, { method: 'POST' }),
      { params: { id: pendingRequestId } }
    );
    expect(res.status).toBe(200);
    const updated = await prisma.credentialVerificationRequest.findUnique({ where: { id: pendingRequestId } });
    expect(updated?.status).toBe('AUTHORIZED');
    expect(updated?.authorizedAt).not.toBeNull();
  });

  it('returns 409 authorizing an already-authorized request', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request(`http://localhost/api/verification-requests/${pendingRequestId}/authorize`, { method: 'POST' }),
      { params: { id: pendingRequestId } }
    );
    expect(res.status).toBe(409);
  });

  it('declines a PENDING_AUTHORIZATION request owned by the caller', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await declineRequest(
      new Request(`http://localhost/api/verification-requests/${secondPendingRequestId}/decline`, { method: 'POST' }),
      { params: { id: secondPendingRequestId } }
    );
    expect(res.status).toBe(200);
    const updated = await prisma.credentialVerificationRequest.findUnique({ where: { id: secondPendingRequestId } });
    expect(updated?.status).toBe('DECLINED');
    expect(updated?.declinedAt).not.toBeNull();
  });

  it('returns 404 authorizing a request that does not exist', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await authorizeRequest(
      new Request('http://localhost/api/verification-requests/does-not-exist/authorize', { method: 'POST' }),
      { params: { id: 'does-not-exist' } }
    );
    expect(res.status).toBe(404);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: claimantUserId } });
    await prisma.credentialVerificationRequest.deleteMany({ where: { id: { in: [pendingRequestId, secondPendingRequestId] } } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.claimantProfile.delete({ where: { id: otherClaimantProfileId } });
    await prisma.user.delete({ where: { id: otherClaimantUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/verification-requests-create.test.ts tests/integration/verification-requests-authorize-decline.test.ts`
Expected: FAIL — the route modules don't exist yet.

- [ ] **Step 3: Implement `src/app/api/verification-requests/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { credentialRequestCreateSchema } from '@/lib/validation/credential';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = credentialRequestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const isClaimant = session!.user.role === 'CLAIMANT';
  // A CLAIMANT session always requests for themselves — any client-supplied
  // claimantProfileId is ignored, never trusted. A CASEWORKER/ADMIN session
  // must explicitly name the claimant they're requesting on behalf of.
  const claimantProfileId = isClaimant ? session!.user.claimantProfileId : parsed.data.claimantProfileId;
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }
  if (!isClaimant) {
    const claimantExists = await prisma.claimantProfile.findUnique({ where: { id: claimantProfileId }, select: { id: true } });
    if (!claimantExists) {
      return apiError('Claimant not found', 404);
    }
  }

  const organization = await prisma.employerProfile.findUnique({
    where: { id: parsed.data.organizationId },
    select: { verificationStatus: true },
  });
  if (!organization || organization.verificationStatus !== 'VERIFIED') {
    return apiError('The target organization is not verified', 400);
  }

  // Requesting your own credential is itself the authorization — no
  // separate approval step for a CLAIMANT-initiated request. A
  // caseworker-initiated one requires the claimant's explicit approval
  // before the organization ever sees it.
  const now = new Date();
  const request = await prisma.credentialVerificationRequest.create({
    data: {
      claimantProfileId,
      organizationId: parsed.data.organizationId,
      credentialType: parsed.data.credentialType,
      requestedTitle: parsed.data.requestedTitle,
      requestedByUserId: session!.user.id,
      status: isClaimant ? 'AUTHORIZED' : 'PENDING_AUTHORIZATION',
      authorizedAt: isClaimant ? now : null,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_VERIFICATION_REQUESTED',
    targetEntity: 'CredentialVerificationRequest',
    targetId: request.id,
    metadata: { claimantProfileId, organizationId: parsed.data.organizationId, credentialType: parsed.data.credentialType },
  });

  return Response.json({ id: request.id }, { status: 201 });
}

export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const isClaimant = session!.user.role === 'CLAIMANT';
  let claimantProfileId: string | null | undefined;
  if (isClaimant) {
    claimantProfileId = session!.user.claimantProfileId;
  } else {
    const url = new URL(req.url);
    claimantProfileId = url.searchParams.get('claimantProfileId');
  }
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }

  const requests = await prisma.credentialVerificationRequest.findMany({
    where: { claimantProfileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      credentialType: true,
      requestedTitle: true,
      status: true,
      authorizedAt: true,
      declinedAt: true,
      respondedAt: true,
      responseNote: true,
      resultingCredentialRecordId: true,
      createdAt: true,
      organization: { select: { companyName: true } },
    },
  });

  return Response.json(requests);
}
```

- [ ] **Step 4: Implement `src/app/api/verification-requests/[id]/authorize/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole, requireOwnership } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const request = await prisma.credentialVerificationRequest.findUnique({
    where: { id: params.id },
    select: { id: true, claimantProfileId: true, status: true },
  });
  if (!request) {
    return apiError('Request not found', 404);
  }

  const owns = requireOwnership(session, request.claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }
  if (request.status !== 'PENDING_AUTHORIZATION') {
    return apiError('This request is not awaiting authorization', 409);
  }

  const updated = await prisma.credentialVerificationRequest.updateMany({
    where: { id: params.id, status: 'PENDING_AUTHORIZATION' },
    data: { status: 'AUTHORIZED', authorizedAt: new Date() },
  });
  if (updated.count === 0) {
    return apiError('This request is not awaiting authorization', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_VERIFICATION_AUTHORIZED',
    targetEntity: 'CredentialVerificationRequest',
    targetId: params.id,
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

- [ ] **Step 5: Implement `src/app/api/verification-requests/[id]/decline/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole, requireOwnership } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const request = await prisma.credentialVerificationRequest.findUnique({
    where: { id: params.id },
    select: { id: true, claimantProfileId: true, status: true },
  });
  if (!request) {
    return apiError('Request not found', 404);
  }

  const owns = requireOwnership(session, request.claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }
  if (request.status !== 'PENDING_AUTHORIZATION') {
    return apiError('This request is not awaiting authorization', 409);
  }

  const updated = await prisma.credentialVerificationRequest.updateMany({
    where: { id: params.id, status: 'PENDING_AUTHORIZATION' },
    data: { status: 'DECLINED', declinedAt: new Date() },
  });
  if (updated.count === 0) {
    return apiError('This request is not awaiting authorization', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_VERIFICATION_DECLINED',
    targetEntity: 'CredentialVerificationRequest',
    targetId: params.id,
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/verification-requests-create.test.ts tests/integration/verification-requests-authorize-decline.test.ts`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/verification-requests tests/integration/verification-requests-create.test.ts tests/integration/verification-requests-authorize-decline.test.ts
git commit -m "feat: verification request create/list/authorize/decline routes"
```

---

### Task 5: Organization response routes

**Files:**
- Create: `src/app/api/employer/verification-requests/route.ts`
- Create: `src/app/api/employer/verification-requests/[id]/respond/route.ts`
- Test: `tests/integration/employer-verification-requests-respond.test.ts`

**Interfaces:**
- Consumes: `credentialResponseSchema`, `parseCredentialDetails` from Task 2.
- Produces: `GET /api/employer/verification-requests` → list of `AUTHORIZED` requests targeting the caller's org; `POST .../[id]/respond` → `200 { id, credentialRecordId }`.

**Important — audit atomicity:** a prior feature's final review in this codebase found that writing an `AuditLog` entry via the standalone `writeAuditLog` helper *after* a state-changing `prisma.$transaction` commits creates a real gap: if that write fails, the state change is permanent but goes unaudited, with no retry path since the resolved state already blocks reprocessing. Write the audit log via `tx.auditLog.create(...)` **inside** the same transaction here, not after it, from the start.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/employer-verification-requests-respond.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listPending } from '@/app/api/employer/verification-requests/route';
import { POST as respond } from '@/app/api/employer/verification-requests/[id]/respond/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer verification-request response routes', () => {
  let orgUserId: string;
  let orgProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let authorizedRequestId: string;
  let secondAuthorizedRequestId: string;

  beforeAll(async () => {
    const orgUser = await prisma.user.create({
      data: { email: `evr-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'EVR Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `evr-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id, legalName: 'EVR Claimant' } });
    claimantProfileId = claimantProfile.id;

    const authorizedRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'EDUCATION', requestedByUserId: claimantUserId, status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    authorizedRequestId = authorizedRequest.id;

    const secondAuthorizedRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'EDUCATION', requestedByUserId: claimantUserId, status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    secondAuthorizedRequestId = secondAuthorizedRequest.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: orgUserId, role: 'EMPLOYER', employerProfileId: orgProfileId, email: 'org@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('lists AUTHORIZED requests targeting the caller\'s organization', async () => {
    const res = await listPending();
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.some((r: { id: string }) => r.id === authorizedRequestId)).toBe(true);
  });

  it('confirms a request, creating a matched CredentialRecord', async () => {
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${authorizedRequestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          title: 'Bachelor of Science in Computer Science',
          eventDate: '2018-05-15',
          details: { schemaVersion: 1, major: 'Computer Science' },
        }),
      }),
      { params: { id: authorizedRequestId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentialRecordId).toBeTruthy();

    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: authorizedRequestId } });
    expect(request?.status).toBe('CONFIRMED');
    expect(request?.resultingCredentialRecordId).toBe(body.credentialRecordId);

    const record = await prisma.credentialRecord.findUnique({ where: { id: body.credentialRecordId } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
    expect(record?.reportedVia).toBe('REQUEST_RESPONSE');
    expect(record?.type).toBe('EDUCATION');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'CredentialVerificationRequest', targetId: authorizedRequestId, action: 'CREDENTIAL_VERIFICATION_CONFIRMED' },
    });
    expect(log).not.toBeNull();
  });

  it('denies a request with no record found, creating no CredentialRecord', async () => {
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${secondAuthorizedRequestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: false, responseNote: 'No record matching this name found.' }),
      }),
      { params: { id: secondAuthorizedRequestId } }
    );
    expect(res.status).toBe(200);
    const request = await prisma.credentialVerificationRequest.findUnique({ where: { id: secondAuthorizedRequestId } });
    expect(request?.status).toBe('NO_RECORD_FOUND');
    expect(request?.resultingCredentialRecordId).toBeNull();
  });

  it('returns 409 responding to an already-resolved request', async () => {
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${authorizedRequestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: false }),
      }),
      { params: { id: authorizedRequestId } }
    );
    expect(res.status).toBe(409);
  });

  it('returns 400 when confirming details fail type-specific validation', async () => {
    const staleRequest = await prisma.credentialVerificationRequest.create({
      data: { claimantProfileId, organizationId: orgProfileId, credentialType: 'MILITARY_SERVICE', requestedByUserId: claimantUserId, status: 'AUTHORIZED', authorizedAt: new Date() },
    });
    const res = await respond(
      new Request(`http://localhost/api/employer/verification-requests/${staleRequest.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: true, title: 'Service record', eventDate: '2015-01-01', details: { schemaVersion: 1 } }),
      }),
      { params: { id: staleRequest.id } }
    );
    expect(res.status).toBe(400);
    await prisma.credentialVerificationRequest.delete({ where: { id: staleRequest.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: orgUserId } });
    await prisma.credentialRecord.deleteMany({ where: { organizationId: orgProfileId } });
    await prisma.credentialVerificationRequest.deleteMany({ where: { organizationId: orgProfileId } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-verification-requests-respond.test.ts`
Expected: FAIL — the route modules don't exist yet.

- [ ] **Step 3: Implement `src/app/api/employer/verification-requests/route.ts`**

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

  const requests = await prisma.credentialVerificationRequest.findMany({
    where: { organizationId: session!.user.employerProfileId, status: 'AUTHORIZED' },
    orderBy: { authorizedAt: 'asc' },
    select: {
      id: true,
      credentialType: true,
      requestedTitle: true,
      authorizedAt: true,
      claimantProfile: { select: { legalName: true } },
    },
  });

  return Response.json(requests);
}
```

- [ ] **Step 4: Implement `src/app/api/employer/verification-requests/[id]/respond/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { credentialResponseSchema, parseCredentialDetails } from '@/lib/validation/credential';

// Thrown from inside the transaction to force a full rollback, mirroring
// src/app/api/employer/job-applications/[id]/hire/route.ts's
// ApplicationAlreadyResolvedError.
class RequestAlreadyRespondedError extends Error {}

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const parsed = credentialResponseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const request = await prisma.credentialVerificationRequest.findUnique({
    where: { id: params.id },
    select: { id: true, organizationId: true, status: true, claimantProfileId: true, credentialType: true },
  });
  if (!request) {
    return apiError('Request not found', 404);
  }
  if (request.organizationId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (request.status !== 'AUTHORIZED') {
    return apiError('This request is not awaiting a response', 409);
  }

  if (parsed.data.confirmed) {
    const detailsResult = parseCredentialDetails(request.credentialType, parsed.data.details);
    if (!detailsResult.success) {
      return Response.json({ errors: detailsResult.error.flatten() }, { status: 400 });
    }
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.credentialVerificationRequest.updateMany({
        where: { id: params.id, status: 'AUTHORIZED' },
        data: {
          status: parsed.data.confirmed ? 'CONFIRMED' : 'NO_RECORD_FOUND',
          respondedAt: now,
          respondedByUserId: session!.user.id,
          responseNote: parsed.data.confirmed ? null : (parsed.data.responseNote ?? null),
        },
      });
      if (updated.count === 0) {
        throw new RequestAlreadyRespondedError();
      }

      let credentialRecordId: string | null = null;
      if (parsed.data.confirmed) {
        const record = await tx.credentialRecord.create({
          data: {
            organizationId: request.organizationId,
            type: request.credentialType,
            title: parsed.data.title,
            eventDate: new Date(parsed.data.eventDate),
            details: parsed.data.details,
            matchedClaimantProfileId: request.claimantProfileId,
            reportedVia: 'REQUEST_RESPONSE',
          },
        });
        credentialRecordId = record.id;
        await tx.credentialVerificationRequest.update({
          where: { id: params.id },
          data: { resultingCredentialRecordId: record.id },
        });
      }

      // Written inside the same transaction as the state change it
      // describes — see this task's brief for why.
      await tx.auditLog.create({
        data: {
          actorUserId: session!.user.id,
          action: parsed.data.confirmed ? 'CREDENTIAL_VERIFICATION_CONFIRMED' : 'CREDENTIAL_VERIFICATION_NO_RECORD_FOUND',
          targetEntity: 'CredentialVerificationRequest',
          targetId: params.id,
          metadata: { credentialRecordId },
        },
      });

      return { credentialRecordId };
    });
  } catch (err) {
    if (err instanceof RequestAlreadyRespondedError) {
      return apiError('This request is not awaiting a response', 409);
    }
    throw err;
  }

  return Response.json({ id: params.id, credentialRecordId: result.credentialRecordId }, { status: 200 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-verification-requests-respond.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/employer/verification-requests tests/integration/employer-verification-requests-respond.test.ts
git commit -m "feat: organization response routes for verification requests"
```

---

### Task 6: Proactive credential reporting route

**Files:**
- Create: `src/app/api/employer/credentials/route.ts`
- Test: `tests/integration/employer-credentials.test.ts`

**Interfaces:**
- Consumes: `proactiveCredentialReportSchema`, `parseCredentialDetails` from Task 2.
- Produces: `POST /api/employer/credentials` → `201 { id }`. Mirrors `src/app/api/employer/events/route.ts` almost exactly, plus the `credentialReportingAgreement` gate.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/employer-credentials.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as reportCredential } from '@/app/api/employer/credentials/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/credentials', () => {
  let agreementOrgUserId: string;
  let agreementOrgProfileId: string;
  let noAgreementOrgUserId: string;
  let noAgreementOrgProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  const claimantSsn = '512-90-3344';

  beforeAll(async () => {
    const agreementOrgUser = await prisma.user.create({
      data: { email: `ec-agreement-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    agreementOrgUserId = agreementOrgUser.id;
    const agreementOrgProfile = await prisma.employerProfile.create({
      data: { userId: agreementOrgUser.id, companyName: 'EC Agreement University', verificationStatus: 'VERIFIED', credentialReportingAgreement: true },
    });
    agreementOrgProfileId = agreementOrgProfile.id;

    const noAgreementOrgUser = await prisma.user.create({
      data: { email: `ec-no-agreement-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    noAgreementOrgUserId = noAgreementOrgUser.id;
    const noAgreementOrgProfile = await prisma.employerProfile.create({
      data: { userId: noAgreementOrgUser.id, companyName: 'EC No Agreement University', verificationStatus: 'VERIFIED', credentialReportingAgreement: false },
    });
    noAgreementOrgProfileId = noAgreementOrgProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `ec-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'EC Claimant', ssnHash: hashSSN(claimantSsn) },
    });
    claimantProfileId = claimantProfile.id;
  });

  it('rejects a VERIFIED organization with no reporting agreement, with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: noAgreementOrgUserId, role: 'EMPLOYER', employerProfileId: noAgreementOrgProfileId, email: 'no-agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({
          ssn: claimantSsn,
          type: 'EDUCATION',
          title: 'BS Computer Science',
          eventDate: '2018-05-15',
          details: { schemaVersion: 1, major: 'Computer Science' },
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it('creates and auto-matches a credential for an org with a reporting agreement', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: agreementOrgUserId, role: 'EMPLOYER', employerProfileId: agreementOrgProfileId, email: 'agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({
          ssn: claimantSsn,
          type: 'EDUCATION',
          title: 'BS Computer Science',
          eventDate: '2018-05-15',
          details: { schemaVersion: 1, major: 'Computer Science' },
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const record = await prisma.credentialRecord.findUnique({ where: { id: body.id } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
    expect(record?.reportedVia).toBe('PROACTIVE_AGREEMENT');
  });

  it('creates an unmatched credential for an SSN with no matching claimant', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: agreementOrgUserId, role: 'EMPLOYER', employerProfileId: agreementOrgProfileId, email: 'agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({
          ssn: '999-88-7766',
          type: 'CERTIFICATION',
          title: 'Certified Public Accountant',
          eventDate: '2020-01-01',
          details: { schemaVersion: 1, certificationName: 'Certified Public Accountant' },
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const record = await prisma.credentialRecord.findUnique({ where: { id: body.id } });
    expect(record?.matchedClaimantProfileId).toBeNull();
  });

  it('returns 400 when details fail type-specific validation', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: agreementOrgUserId, role: 'EMPLOYER', employerProfileId: agreementOrgProfileId, email: 'agreement@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await reportCredential(
      new Request('http://localhost/api/employer/credentials', {
        method: 'POST',
        body: JSON.stringify({ ssn: claimantSsn, type: 'MILITARY_SERVICE', title: 'Service', eventDate: '2015-01-01', details: { schemaVersion: 1 } }),
      })
    );
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [agreementOrgUserId, noAgreementOrgUserId] } } });
    await prisma.credentialRecord.deleteMany({ where: { organizationId: agreementOrgProfileId } });
    await prisma.employerProfile.delete({ where: { id: agreementOrgProfileId } });
    await prisma.user.delete({ where: { id: agreementOrgUserId } });
    await prisma.employerProfile.delete({ where: { id: noAgreementOrgProfileId } });
    await prisma.user.delete({ where: { id: noAgreementOrgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/employer-credentials.test.ts`
Expected: FAIL — the route module doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/employer/credentials/route.ts`, mirroring `src/app/api/employer/events/route.ts`'s exact shape:

```ts
import { prisma } from '@/lib/prisma';
import { proactiveCredentialReportSchema, parseCredentialDetails } from '@/lib/validation/credential';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const limit = checkRateLimit(rateLimitKey(req, 'employer-credentials', session!.user.employerProfileId));
  if (!limit.allowed) {
    return apiError('Too many credentials reported. Please try again in a minute.', 429);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = proactiveCredentialReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const detailsResult = parseCredentialDetails(parsed.data.type, parsed.data.details);
  if (!detailsResult.success) {
    return Response.json({ errors: detailsResult.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { verificationStatus: true, credentialReportingAgreement: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED') {
    return apiError('Employer account is not verified', 403);
  }
  if (!employerProfile.credentialReportingAgreement) {
    return apiError('This organization does not have a proactive credential-reporting agreement on file', 403);
  }

  const ssnHash = hashSSN(parsed.data.ssn);
  // Same never-reveal-match handling as employer/events: whether a match
  // was found is never distinguishable to the caller beyond the created
  // record's own (never-returned) matchedClaimantProfileId.
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });

  const record = await prisma.credentialRecord.create({
    data: {
      organizationId: session!.user.employerProfileId,
      type: parsed.data.type,
      title: parsed.data.title,
      eventDate: new Date(parsed.data.eventDate),
      details: parsed.data.details,
      ssnHash,
      matchedClaimantProfileId: matchedClaimant?.id,
      reportedVia: 'PROACTIVE_AGREEMENT',
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_REPORTED',
    targetEntity: 'CredentialRecord',
    targetId: record.id,
    metadata: { type: parsed.data.type, matched: Boolean(matchedClaimant) },
  });

  return Response.json({ id: record.id }, { status: 201 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/employer-credentials.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/employer/credentials tests/integration/employer-credentials.test.ts
git commit -m "feat: proactive credential-reporting route"
```

---

### Task 7: Unmatched-credentials staff review

**Files:**
- Create: `src/app/api/staff/unmatched-credentials/route.ts`
- Create: `src/app/api/staff/unmatched-credentials/[id]/match/route.ts`
- Create: `src/app/api/staff/unmatched-credentials/[id]/dismiss/route.ts`
- Create: `src/app/api/staff/unmatched-credentials/[id]/retry/route.ts`
- Create: `src/app/staff/unmatched-credentials/page.tsx`
- Test: `tests/integration/unmatched-credentials.test.ts`

**Interfaces:**
- Produces: a caseworker-facing review page and its 4 supporting routes, mirroring `src/app/staff/unmatched-events/page.tsx` and its routes exactly, scoped to `CredentialRecord` instead of `EmploymentEvent`. A new sibling page, not an extension of the existing unmatched-events page — that page has no shared/extracted sub-components to build into (confirmed by reading it; it's one large inline `.map`), so a second page avoids restructuring already-tested code for no benefit.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unmatched-credentials.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { GET as listUnmatched } from '@/app/api/staff/unmatched-credentials/route';
import { POST as matchCredential } from '@/app/api/staff/unmatched-credentials/[id]/match/route';
import { POST as dismissCredential } from '@/app/api/staff/unmatched-credentials/[id]/dismiss/route';
import { POST as retryCredential } from '@/app/api/staff/unmatched-credentials/[id]/retry/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('unmatched-credentials staff review routes', () => {
  let caseworkerUserId: string;
  let orgUserId: string;
  let orgProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let unmatchedRecordId: string;
  let secondUnmatchedRecordId: string;
  let thirdUnmatchedRecordId: string;
  const targetSsn = '601-44-2299';

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `uc-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    const orgUser = await prisma.user.create({
      data: { email: `uc-org-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    orgUserId = orgUser.id;
    const orgProfile = await prisma.employerProfile.create({
      data: { userId: orgUser.id, companyName: 'UC Test University', verificationStatus: 'VERIFIED' },
    });
    orgProfileId = orgProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `uc-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'UC Claimant', ssnHash: hashSSN(targetSsn) },
    });
    claimantProfileId = claimantProfile.id;

    const unmatchedRecord = await prisma.credentialRecord.create({
      data: {
        organizationId: orgProfileId, type: 'CERTIFICATION', title: 'CPA',
        eventDate: new Date('2020-01-01'), details: { schemaVersion: 1, certificationName: 'CPA' },
        ssnHash: hashSSN('999-99-0001'), reportedVia: 'PROACTIVE_AGREEMENT',
      },
    });
    unmatchedRecordId = unmatchedRecord.id;

    const secondUnmatchedRecord = await prisma.credentialRecord.create({
      data: {
        organizationId: orgProfileId, type: 'CERTIFICATION', title: 'CPA',
        eventDate: new Date('2020-01-01'), details: { schemaVersion: 1, certificationName: 'CPA' },
        ssnHash: hashSSN('999-99-0002'), reportedVia: 'PROACTIVE_AGREEMENT',
      },
    });
    secondUnmatchedRecordId = secondUnmatchedRecord.id;

    const thirdUnmatchedRecord = await prisma.credentialRecord.create({
      data: {
        organizationId: orgProfileId, type: 'CERTIFICATION', title: 'CPA',
        eventDate: new Date('2020-01-01'), details: { schemaVersion: 1, certificationName: 'CPA' },
        ssnHash: hashSSN(targetSsn), reportedVia: 'PROACTIVE_AGREEMENT',
      },
    });
    thirdUnmatchedRecordId = thirdUnmatchedRecord.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: 'caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('lists unmatched, non-dismissed credentials', async () => {
    const res = await listUnmatched();
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.some((r: { id: string }) => r.id === unmatchedRecordId)).toBe(true);
  });

  it('manually matches an unmatched credential by a caller-supplied SSN', async () => {
    const res = await matchCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${unmatchedRecordId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: targetSsn, note: 'Confirmed via phone call.' }),
      }),
      { params: { id: unmatchedRecordId } }
    );
    expect(res.status).toBe(200);
    const record = await prisma.credentialRecord.findUnique({ where: { id: unmatchedRecordId } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
  });

  it('returns 404 matching against an SSN with no claimant', async () => {
    const res = await matchCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${secondUnmatchedRecordId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: '111-11-1111', note: 'Attempted match.' }),
      }),
      { params: { id: secondUnmatchedRecordId } }
    );
    expect(res.status).toBe(404);
  });

  it('dismisses an unmatched credential with a note', async () => {
    const res = await dismissCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${secondUnmatchedRecordId}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ note: 'Duplicate report.' }),
      }),
      { params: { id: secondUnmatchedRecordId } }
    );
    expect(res.status).toBe(200);
    const record = await prisma.credentialRecord.findUnique({ where: { id: secondUnmatchedRecordId } });
    expect(record?.dismissedAt).not.toBeNull();
  });

  it('retries matching using the credential\'s own stored ssnHash', async () => {
    const res = await retryCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${thirdUnmatchedRecordId}/retry`, { method: 'POST' }),
      { params: { id: thirdUnmatchedRecordId } }
    );
    expect(res.status).toBe(200);
    const record = await prisma.credentialRecord.findUnique({ where: { id: thirdUnmatchedRecordId } });
    expect(record?.matchedClaimantProfileId).toBe(claimantProfileId);
  });

  it('returns 409 matching an already-resolved credential', async () => {
    const res = await matchCredential(
      new Request(`http://localhost/api/staff/unmatched-credentials/${unmatchedRecordId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: targetSsn, note: 'Retry.' }),
      }),
      { params: { id: unmatchedRecordId } }
    );
    expect(res.status).toBe(409);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.credentialRecord.deleteMany({ where: { organizationId: orgProfileId } });
    await prisma.employerProfile.delete({ where: { id: orgProfileId } });
    await prisma.user.delete({ where: { id: orgUserId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/unmatched-credentials.test.ts`
Expected: FAIL — the route modules don't exist yet.

- [ ] **Step 3: Implement the four routes**

Create `src/app/api/staff/unmatched-credentials/route.ts`:

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

  const records = await prisma.credentialRecord.findMany({
    where: { matchedClaimantProfileId: null, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      title: true,
      eventDate: true,
      createdAt: true,
      organization: { select: { companyName: true } },
    },
  });

  return Response.json(records);
}
```

Create `src/app/api/staff/unmatched-credentials/[id]/match/route.ts` — identical structure to `src/app/api/staff/unmatched-events/[id]/match/route.ts`, with `employmentEvent` replaced by `credentialRecord` and `EMPLOYMENT_EVENT_*` audit actions replaced by `CREDENTIAL_*`:

```ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

const manualMatchSchema = z.object({
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  note: z.string().min(1, 'A note is required'),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const limit = checkRateLimit(rateLimitKey(req, 'staff-credential-match', session!.user.id));
  if (!limit.allowed) {
    return apiError('Too many match attempts. Please try again in a minute.', 429);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = manualMatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const { ssn, note } = parsed.data;

  const record = await prisma.credentialRecord.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!record) {
    return apiError('Credential not found', 404);
  }
  if (record.matchedClaimantProfileId || record.dismissedAt) {
    return apiError('This credential has already been resolved', 409);
  }

  const ssnHash = hashSSN(ssn);
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    await writeAuditLog({
      actorUserId: session!.user.id,
      action: 'CREDENTIAL_MATCH_ATTEMPT_FAILED',
      targetEntity: 'CredentialRecord',
      targetId: params.id,
      metadata: { note },
    });
    return apiError('No claimant found with that SSN', 404);
  }

  const updated = await prisma.credentialRecord.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { matchedClaimantProfileId: matchedClaimant.id },
  });
  if (updated.count === 0) {
    return apiError('This credential has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_MANUALLY_MATCHED',
    targetEntity: 'CredentialRecord',
    targetId: params.id,
    metadata: { via: 'manual', note },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

Create `src/app/api/staff/unmatched-credentials/[id]/dismiss/route.ts` — identical structure to `.../unmatched-events/[id]/dismiss/route.ts`, `employmentEvent` → `credentialRecord`, action `CREDENTIAL_DISMISSED`:

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

  const record = await prisma.credentialRecord.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!record) {
    return apiError('Credential not found', 404);
  }
  if (record.matchedClaimantProfileId || record.dismissedAt) {
    return apiError('This credential has already been resolved', 409);
  }

  const updated = await prisma.credentialRecord.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { dismissedAt: new Date(), dismissedByUserId: session!.user.id },
  });
  if (updated.count === 0) {
    return apiError('This credential has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_DISMISSED',
    targetEntity: 'CredentialRecord',
    targetId: params.id,
    metadata: { note },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

Create `src/app/api/staff/unmatched-credentials/[id]/retry/route.ts` — identical structure to `.../unmatched-events/[id]/retry/route.ts`, `employmentEvent` → `credentialRecord`. `ssnHash` is nullable on `CredentialRecord` (only ever populated for the proactive path this queue exists for), so add one defensive null guard the `EmploymentEvent` version doesn't need:

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

  const record = await prisma.credentialRecord.findUnique({
    where: { id: params.id },
    select: { id: true, ssnHash: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!record) {
    return apiError('Credential not found', 404);
  }
  if (record.matchedClaimantProfileId || record.dismissedAt) {
    return apiError('This credential has already been resolved', 409);
  }
  // Should be unreachable: every unmatched CredentialRecord in this queue
  // came from the proactive path, which always sets ssnHash. Guarded
  // anyway since the column is nullable at the schema level.
  if (!record.ssnHash) {
    return apiError('This credential has no SSN on file to retry matching against', 404);
  }

  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash: record.ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    return apiError('No claimant found for this credential yet', 404);
  }

  const updated = await prisma.credentialRecord.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { matchedClaimantProfileId: matchedClaimant.id },
  });
  if (updated.count === 0) {
    return apiError('This credential has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CREDENTIAL_MANUALLY_MATCHED',
    targetEntity: 'CredentialRecord',
    targetId: params.id,
    metadata: { via: 'retry' },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/unmatched-credentials.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Build the staff review page**

Create `src/app/staff/unmatched-credentials/page.tsx`, following `src/app/staff/unmatched-events/page.tsx`'s exact structure and conventions (`useSession()` role gate, single list state, per-item inline Match/Dismiss forms plus a no-form Retry button, `resolveRecord(id)` optimistically filtering the item out of local state, `pendingId` disabling buttons mid-request, separate `loadError`/`actionError` `role="alert"` banners). Read that file in full before writing this one — copy its exact JSX/state patterns, adapting only the data shape (`type`/`title` instead of `type`/`employeeName`, `organization.companyName` instead of `employer.companyName`) and the three fetch URLs (`/api/staff/unmatched-credentials`, `.../match`, `.../dismiss`, `.../retry`).

- [ ] **Step 6: Add a component test**

Create `tests/unit/unmatched-credentials-page.test.tsx`, following the same `useSession`-mock + `vi.stubGlobal('fetch', ...)` convention used elsewhere in this codebase (e.g. `tests/unit/employer-page-guards.test.tsx`). Cover: loading state, unauthenticated/wrong-role state, and a successful load rendering at least one unmatched credential's title and organization name.

- [ ] **Step 7: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass, including the new ones.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/staff/unmatched-credentials src/app/staff/unmatched-credentials tests/integration/unmatched-credentials.test.ts tests/unit/unmatched-credentials-page.test.tsx
git commit -m "feat: unmatched-credentials staff review queue"
```

---

### Task 8: Claimant page + shared organization picker

**Files:**
- Create: `src/components/credentials/OrganizationPicker.tsx`
- Create: `src/app/claim/verification-requests/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/unit/verification-requests-page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/organizations?q=` (Task 3), `POST /api/verification-requests`, `GET /api/verification-requests`, `POST /api/verification-requests/[id]/{authorize,decline}` (Task 4), `CREDENTIAL_TYPE_VALUES` (Task 2).
- Produces: `OrganizationPicker` — `{ selectedOrganization: {id,companyName}|null; onSelect: (org) => void; error?: string }` — reused by Task 10's staff case page.

- [ ] **Step 1: Build the shared `OrganizationPicker` component**

Create `src/components/credentials/OrganizationPicker.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { TextField } from '@/components/ui/TextField';

export type Organization = { id: string; companyName: string };

type OrganizationPickerProps = {
  selectedOrganization: Organization | null;
  onSelect: (org: Organization | null) => void;
  error?: string;
};

// A minimal search-select: no existing autocomplete/combobox component in
// this codebase to build on (confirmed — every existing <select> here is
// populated from an already-fetched, small, fixed list). Fires a search on
// every keystroke past 2 characters rather than debouncing — acceptable at
// this app's scale (an EmployerProfile.findMany with take: 25), not worth
// the added complexity of a real debounce timer for a pilot.
export function OrganizationPicker({ selectedOrganization, onSelect, error }: OrganizationPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Organization[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await fetch(`/api/organizations?q=${encodeURIComponent(value)}`);
    setSearching(false);
    if (res.ok) setResults(await res.json());
  }

  if (selectedOrganization) {
    return (
      <div className="mb-4">
        <p className="font-medium">Organization: {selectedOrganization.companyName}</p>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setResults([]);
          }}
          className="text-link underline text-sm"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <TextField
        id="organization-search"
        label="Search for the organization"
        value={query}
        onChange={handleQueryChange}
        error={error}
        required
      />
      {searching && <p className="text-sm text-text-secondary">Searching…</p>}
      {results.length > 0 && (
        <ul className="border border-border rounded mt-1">
          {results.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(org);
                  setResults([]);
                }}
                className="w-full text-left px-3 py-2 hover:bg-surface-alt"
              >
                {org.companyName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the claimant page**

Create `src/app/claim/verification-requests/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { OrganizationPicker, type Organization } from '@/components/credentials/OrganizationPicker';

const CREDENTIAL_TYPE_OPTIONS = [
  { value: 'EDUCATION', label: 'Education' },
  { value: 'MILITARY_SERVICE', label: 'Military service' },
  { value: 'LAW_ENFORCEMENT', label: 'Law enforcement' },
  { value: 'CERTIFICATION', label: 'Certification' },
  { value: 'OTHER', label: 'Other' },
];

type VerificationRequest = {
  id: string;
  credentialType: string;
  requestedTitle: string | null;
  status: 'PENDING_AUTHORIZATION' | 'AUTHORIZED' | 'CONFIRMED' | 'NO_RECORD_FOUND' | 'DECLINED';
  responseNote: string | null;
  createdAt: string;
  organization: { companyName: string | null };
};

const STATUS_LABELS: Record<VerificationRequest['status'], string> = {
  PENDING_AUTHORIZATION: 'Awaiting your authorization',
  AUTHORIZED: 'Sent — awaiting response',
  CONFIRMED: 'Confirmed',
  NO_RECORD_FOUND: 'No record found',
  DECLINED: 'Declined',
};

export default function VerificationRequestsPage() {
  const { data: session, status } = useSession();
  const [requests, setRequests] = useState<VerificationRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [credentialType, setCredentialType] = useState('');
  const [requestedTitle, setRequestedTitle] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadRequests() {
    const res = await fetch('/api/verification-requests');
    if (!res.ok) {
      setLoadError('We could not load your verification requests. Please try again.');
      return;
    }
    setRequests(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    loadRequests();
  }, [status, session?.user.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    if (!organization) {
      setFieldErrors({ 'organization-search': 'Select an organization from the search results.' });
      return;
    }
    const res = await fetch('/api/verification-requests', {
      method: 'POST',
      body: JSON.stringify({ organizationId: organization.id, credentialType, requestedTitle: requestedTitle || undefined }),
    });
    if (res.ok) {
      setOrganization(null);
      setCredentialType('');
      setRequestedTitle('');
      await loadRequests();
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
    setErrors([{ id: 'organization-search', message: body?.error ?? 'We could not submit that request. Please try again.' }]);
  }

  async function handleAuthorize(id: string) {
    setActionError(null);
    setPendingId(id);
    const res = await fetch(`/api/verification-requests/${id}/authorize`, { method: 'POST' });
    setPendingId(null);
    if (!res.ok) {
      setActionError('We could not authorize that request. Please try again.');
      return;
    }
    await loadRequests();
  }

  async function handleDecline(id: string) {
    setActionError(null);
    setPendingId(id);
    const res = await fetch(`/api/verification-requests/${id}/decline`, { method: 'POST' });
    setPendingId(null);
    if (!res.ok) {
      setActionError('We could not decline that request. Please try again.');
      return;
    }
    await loadRequests();
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
        <h1 className="text-2xl font-bold mb-4">Verification requests</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to see your verification requests.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verification requests</h1>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Request a new verification</h2>
        <p className="text-sm text-text-secondary mb-3">
          Ask an organization already in this system — an employer, school, licensing body, or other
          verified organization — to confirm a credential on your behalf.
        </p>
        <ErrorSummary errors={errors} />
        <form onSubmit={handleSubmit} noValidate>
          <OrganizationPicker selectedOrganization={organization} onSelect={setOrganization} error={fieldErrors['organization-search']} />
          <Select
            id="credentialType"
            label="Credential type"
            value={credentialType}
            onChange={setCredentialType}
            options={CREDENTIAL_TYPE_OPTIONS}
            error={fieldErrors.credentialType}
            required
          />
          <TextField
            id="requestedTitle"
            label="What are you asking them to confirm? (optional)"
            value={requestedTitle}
            onChange={setRequestedTitle}
            error={fieldErrors.requestedTitle}
          />
          <Button type="submit">Send request</Button>
        </form>
      </section>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Your requests</h2>
        {loadError && (
          <p role="alert" className="mb-2 text-error-text">
            {loadError}
          </p>
        )}
        {actionError && (
          <p role="alert" className="mb-2 text-error-text">
            {actionError}
          </p>
        )}
        {requests === null && !loadError && <p>Loading…</p>}
        {requests !== null && requests.length === 0 && (
          <p className="text-sm text-text-secondary">You haven&apos;t requested any verifications yet.</p>
        )}
        {requests !== null && requests.length > 0 && (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="border-t border-border pt-3 text-sm">
                <p className="font-medium">
                  {r.organization.companyName} — {r.requestedTitle ?? r.credentialType}
                </p>
                <p className="text-text-secondary mb-2">{STATUS_LABELS[r.status]}</p>
                {r.status === 'NO_RECORD_FOUND' && r.responseNote && (
                  <p className="text-text-secondary mb-2">Note from organization: {r.responseNote}</p>
                )}
                {r.status === 'PENDING_AUTHORIZATION' && (
                  <div className="flex gap-3">
                    <Button onClick={() => handleAuthorize(r.id)} disabled={pendingId === r.id}>
                      Authorize
                    </Button>
                    <Button variant="secondary" onClick={() => handleDecline(r.id)} disabled={pendingId === r.id}>
                      Decline
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

- [ ] **Step 3: Add the nav link**

In `src/components/layout/AppNav.tsx`, add one entry to `CLAIMANT_LINKS`, after `{ href: '/claim/applications', label: 'My applications' }`:

```ts
  { href: '/claim/verification-requests', label: 'Verification requests' },
```

- [ ] **Step 4: Write the component test**

Create `tests/unit/verification-requests-page.test.tsx`, following the `useSession`-mock + `vi.stubGlobal('fetch', ...)` convention from `tests/unit/employer-page-guards.test.tsx`. Cover: loading state, wrong-role state, a successful load rendering an existing request's organization name and status label, and submitting the form with an organization selected (mock the `/api/organizations` search response, click a result, fill in credential type, submit, assert the POST body).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/verification-requests-page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/credentials/OrganizationPicker.tsx src/app/claim/verification-requests/page.tsx src/components/layout/AppNav.tsx tests/unit/verification-requests-page.test.tsx
git commit -m "feat: claimant verification-requests page"
```

---

### Task 9: Organization response page

**Files:**
- Create: `src/app/employer/verification-requests/page.tsx`
- Modify: `src/components/layout/AppNav.tsx`
- Test: `tests/unit/employer-verification-requests-page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/employer/verification-requests`, `POST /api/employer/verification-requests/[id]/respond` (Task 5).

- [ ] **Step 1: Build the page**

Create `src/app/employer/verification-requests/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

type PendingRequest = {
  id: string;
  credentialType: 'EDUCATION' | 'MILITARY_SERVICE' | 'LAW_ENFORCEMENT' | 'CERTIFICATION' | 'OTHER';
  requestedTitle: string | null;
  authorizedAt: string;
  claimantProfile: { legalName: string | null };
};

// One row per credential type: which detail fields the respond form
// collects, folded into CredentialRecord.details. Keys/labels match the
// per-type Zod schemas in src/lib/validation/credential.ts exactly.
const DETAIL_FIELDS: Record<PendingRequest['credentialType'], { key: string; label: string; required?: boolean }[]> = {
  EDUCATION: [
    { key: 'major', label: 'Major / field of study' },
    { key: 'degreeType', label: 'Degree type' },
    { key: 'graduationDate', label: 'Graduation date' },
  ],
  MILITARY_SERVICE: [
    { key: 'branch', label: 'Branch', required: true },
    { key: 'rank', label: 'Rank' },
    { key: 'dischargeType', label: 'Discharge type' },
  ],
  LAW_ENFORCEMENT: [
    { key: 'agency', label: 'Agency', required: true },
    { key: 'role', label: 'Role' },
  ],
  CERTIFICATION: [
    { key: 'certificationName', label: 'Certification name', required: true },
    { key: 'expirationDate', label: 'Expiration date' },
  ],
  OTHER: [{ key: 'description', label: 'Description', required: true }],
};

export default function EmployerVerificationRequestsPage() {
  const { data: session, status } = useSession();
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [detailValues, setDetailValues] = useState<Record<string, string>>({});
  const [responseNote, setResponseNote] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function loadRequests() {
    const res = await fetch('/api/employer/verification-requests');
    if (!res.ok) {
      setLoadError('We could not load pending verification requests. Please try again.');
      return;
    }
    setRequests(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadRequests();
  }, [status, session?.user.role]);

  function startResponding(request: PendingRequest) {
    setRespondingId(request.id);
    setTitle(request.requestedTitle ?? '');
    setEventDate('');
    setDetailValues({});
    setResponseNote('');
    setErrors([]);
    setFieldErrors({});
  }

  async function submitResponse(request: PendingRequest, confirmed: boolean, e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const payload = confirmed
      ? {
          confirmed: true,
          title,
          eventDate,
          details: { schemaVersion: 1, ...detailValues },
        }
      : { confirmed: false, responseNote: responseNote || undefined };

    const res = await fetch(`/api/employer/verification-requests/${request.id}/respond`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setRespondingId(null);
      await loadRequests();
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
    setErrors([{ id: 'title', message: body?.error ?? 'We could not submit that response. Please try again.' }]);
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
        <h1 className="text-2xl font-bold mb-4">Verification requests</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to see verification requests.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verification requests</h1>
      {loadError && (
        <p role="alert" className="mb-2 text-error-text">
          {loadError}
        </p>
      )}
      {requests === null && !loadError && <p>Loading…</p>}
      {requests !== null && requests.length === 0 && (
        <p className="text-sm text-text-secondary">No pending verification requests right now.</p>
      )}
      {requests !== null && requests.length > 0 && (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="border border-border rounded p-4">
              <p className="font-medium">{r.claimantProfile.legalName ?? 'Unnamed claimant'}</p>
              <p className="text-sm text-text-secondary mb-2">
                {r.credentialType} {r.requestedTitle ? `— ${r.requestedTitle}` : ''}
              </p>
              {respondingId !== r.id ? (
                <Button onClick={() => startResponding(r)}>Respond</Button>
              ) : (
                <div>
                  <ErrorSummary errors={errors} />
                  <form onSubmit={(e) => submitResponse(r, true, e)} noValidate className="mb-4">
                    <TextField id="title" label="Title" value={title} onChange={setTitle} error={fieldErrors.title} required />
                    <TextField id="eventDate" label="Date" type="date" value={eventDate} onChange={setEventDate} error={fieldErrors.eventDate} required />
                    {DETAIL_FIELDS[r.credentialType].map((field) => (
                      <TextField
                        key={field.key}
                        id={field.key}
                        label={field.label}
                        value={detailValues[field.key] ?? ''}
                        onChange={(v) => setDetailValues((prev) => ({ ...prev, [field.key]: v }))}
                        required={field.required}
                      />
                    ))}
                    <Button type="submit">Confirm and submit</Button>
                  </form>
                  <form onSubmit={(e) => submitResponse(r, false, e)}>
                    <TextField id="responseNote" label="No record found — note (optional)" value={responseNote} onChange={setResponseNote} />
                    <Button type="submit" variant="secondary">
                      No record found
                    </Button>
                  </form>
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

- [ ] **Step 2: Add the nav link**

In `src/components/layout/AppNav.tsx`, add one entry to `EMPLOYER_LINKS`, after `{ href: '/employer/browse-candidates', label: 'Browse candidates' }`:

```ts
  { href: '/employer/verification-requests', label: 'Verification requests' },
```

- [ ] **Step 3: Write the component test**

Create `tests/unit/employer-verification-requests-page.test.tsx`, following the same conventions as Task 8's page test. Cover: loading/wrong-role states, a successful load rendering a pending request's claimant name and credential type, clicking "Respond" reveals the type-specific detail fields matching that request's `credentialType` (verify at least one type-specific field label, e.g. "Branch" for a `MILITARY_SERVICE` request), and submitting "No record found" posts `{ confirmed: false, responseNote }`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/employer-verification-requests-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/employer/verification-requests/page.tsx src/components/layout/AppNav.tsx tests/unit/employer-verification-requests-page.test.tsx
git commit -m "feat: organization verification-requests response page"
```

---

### Task 10: Staff case page integration

**Files:**
- Modify: `src/app/api/staff/claimants/[id]/route.ts`
- Modify: `src/app/staff/claimants/[id]/page.tsx`
- Modify: `tests/integration/staff-claimants.test.ts`

**Interfaces:**
- Consumes: `OrganizationPicker` (Task 8), `POST /api/verification-requests` (Task 4, caseworker-initiated path).
- Produces: `credentialRecords` and `credentialVerificationRequests` arrays on the `GET /api/staff/claimants/[id]` response.

- [ ] **Step 1: Extend the API route's `select` and response**

In `src/app/api/staff/claimants/[id]/route.ts`, add two new keys to the `select` object, after the existing `candidateProfile` block (which ends right before the `select` object's closing `},` — read the current file first to place this precisely):

```ts
      credentialRecords: {
        orderBy: { eventDate: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          eventDate: true,
          details: true,
          organization: { select: { companyName: true } },
        },
      },
      credentialVerificationRequests: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          credentialType: true,
          requestedTitle: true,
          status: true,
          responseNote: true,
          createdAt: true,
          organization: { select: { companyName: true } },
        },
      },
```

Unlike `candidateProfile`/`matchedEmploymentEvents` (fetched only to build `timeline`, then stripped from the response), these two ARE part of the client contract — do not add them to the destructuring that strips fields before `Response.json(...)`.

- [ ] **Step 2: Update the existing integration test**

In `tests/integration/staff-claimants.test.ts`, the test `'returns a single claimant by id with the same nested shape as the search route'` currently doesn't assert on credentials. Add two assertions right after its existing `expect(claimant.timeline...)` lines:

```ts
    expect(claimant.credentialRecords).toEqual([]);
    expect(claimant.credentialVerificationRequests).toEqual([]);
```

- [ ] **Step 3: Run the test to verify it still passes**

Run: `npx vitest run tests/integration/staff-claimants.test.ts`
Expected: PASS — the fixture claimant in this test has no credentials, so both new arrays are empty.

- [ ] **Step 4: Extend the case page**

In `src/app/staff/claimants/[id]/page.tsx`:

Add to the `ClaimantDetail` type (after `timeline`):

```ts
  credentialRecords: {
    id: string;
    type: string;
    title: string;
    eventDate: string;
    details: Record<string, unknown>;
    organization: { companyName: string | null };
  }[];
  credentialVerificationRequests: {
    id: string;
    credentialType: string;
    requestedTitle: string | null;
    status: 'PENDING_AUTHORIZATION' | 'AUTHORIZED' | 'CONFIRMED' | 'NO_RECORD_FOUND' | 'DECLINED';
    responseNote: string | null;
    createdAt: string;
    organization: { companyName: string | null };
  }[];
```

Add imports:

```ts
import { Select } from '@/components/ui/Select';
import { OrganizationPicker, type Organization } from '@/components/credentials/OrganizationPicker';
```

Add state (alongside the existing `useState` calls):

```ts
  const [requestOrganization, setRequestOrganization] = useState<Organization | null>(null);
  const [requestCredentialType, setRequestCredentialType] = useState('');
  const [requestTitle, setRequestTitle] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState(false);
```

Add a handler (alongside the existing handlers):

```ts
  async function handleRequestVerification(e: React.FormEvent) {
    e.preventDefault();
    setRequestError(null);
    setRequestSuccess(false);
    if (!requestOrganization || !requestCredentialType) {
      setRequestError('Select an organization and a credential type.');
      return;
    }
    const res = await fetch('/api/verification-requests', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: params.id,
        organizationId: requestOrganization.id,
        credentialType: requestCredentialType,
        requestedTitle: requestTitle || undefined,
      }),
    });
    if (!res.ok) {
      setRequestError('We could not send that request. Please try again.');
      return;
    }
    setRequestOrganization(null);
    setRequestCredentialType('');
    setRequestTitle('');
    setRequestSuccess(true);
    loadClaimant();
  }
```

Add a new `<section>` in the JSX, a sibling immediately after the "Case timeline" section closes (current line 234) and before `{claimant.claims.map(...)}` starts (current line 236):

```tsx
      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-3">Verified credentials</h2>
        {claimant.credentialRecords.length === 0 ? (
          <p className="text-sm text-text-secondary mb-4">No verified credentials on file yet.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {claimant.credentialRecords.map((c) => (
              <li key={c.id} className="text-sm border-t border-border pt-2">
                <p className="font-medium">{c.title}</p>
                <p className="text-text-secondary">
                  {c.organization.companyName} — {new Date(c.eventDate).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}

        {claimant.credentialVerificationRequests.length > 0 && (
          <>
            <h3 className="font-medium mb-2 text-sm">Requests</h3>
            <ul className="space-y-2 mb-4">
              {claimant.credentialVerificationRequests.map((r) => (
                <li key={r.id} className="text-sm border-t border-border pt-2">
                  {r.organization.companyName} — {r.requestedTitle ?? r.credentialType} — {r.status}
                  {r.status === 'NO_RECORD_FOUND' && r.responseNote && <span> ({r.responseNote})</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="font-medium mb-2 text-sm">Request a new verification</h3>
        {requestSuccess && <p role="status" className="mb-2 text-status-active-text">Request sent.</p>}
        {requestError && (
          <p role="alert" className="mb-2 text-error-text">
            {requestError}
          </p>
        )}
        <form onSubmit={handleRequestVerification} noValidate>
          <OrganizationPicker selectedOrganization={requestOrganization} onSelect={setRequestOrganization} />
          <Select
            id="requestCredentialType"
            label="Credential type"
            value={requestCredentialType}
            onChange={setRequestCredentialType}
            options={[
              { value: 'EDUCATION', label: 'Education' },
              { value: 'MILITARY_SERVICE', label: 'Military service' },
              { value: 'LAW_ENFORCEMENT', label: 'Law enforcement' },
              { value: 'CERTIFICATION', label: 'Certification' },
              { value: 'OTHER', label: 'Other' },
            ]}
            required
          />
          <TextField
            id="requestTitle"
            label="What are you asking them to confirm? (optional)"
            value={requestTitle}
            onChange={setRequestTitle}
          />
          <Button type="submit">Send request</Button>
        </form>
      </section>
```

Note this request goes through the same `PENDING_AUTHORIZATION` path Task 4 already built — the claimant must authorize it from their own page (Task 8) before this organization ever sees it. Nothing here bypasses that.

- [ ] **Step 5: Run the full unit/integration suite**

Run: `npx vitest run`
Expected: all tests pass, including the modified `staff-claimants.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/staff/claimants/\[id\]/route.ts src/app/staff/claimants/\[id\]/page.tsx tests/integration/staff-claimants.test.ts
git commit -m "feat: display verified credentials and requests on the staff case page"
```

---

### Task 11: End-to-end walkthroughs

**Files:**
- Create: `tests/e2e/credential-verification.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10, exercised as a real user would, across all three roles.

- [ ] **Step 1: Write the E2E tests**

Create `tests/e2e/credential-verification.spec.ts`:

```ts
// tests/e2e/credential-verification.spec.ts
import { test, expect } from '@playwright/test';
import { prisma } from '../../src/lib/prisma';
import { waitForHydration } from './helpers';

// Uses the seeded university@example.com / UniversityPass123 organization
// (see prisma/seed.ts) as the target org for both walkthroughs, so no new
// org fixture/password needs to be created. Both claimants are fresh
// fixtures, cleaned up in afterAll, to avoid touching the shared guided-demo
// Seed Claimant.

test.describe('credential verification', () => {
  let selfRequestClaimantUserId: string;
  let selfRequestClaimantProfileId: string;
  let caseworkerInitiatedClaimantUserId: string;
  let caseworkerInitiatedClaimantProfileId: string;

  test.beforeAll(async () => {
    const selfRequestUser = await prisma.user.create({
      data: { email: `e2e-cred-self-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    selfRequestClaimantUserId = selfRequestUser.id;
    // No usable password on this fixture's User row (passwordHash: 'x') —
    // login for this test goes through NextAuth's credentials provider,
    // which needs a real bcrypt hash. Both fixtures below are logged into
    // via a properly-hashed password instead; see the actual create calls.
  });

  test('a claimant requests, an organization confirms, and it appears on the staff case page', async ({ page, request }) => {
    const bcrypt = await import('bcryptjs');
    const password = 'E2ECredSelfPass123';
    const claimantUser = await prisma.user.update({
      where: { id: selfRequestClaimantUserId },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'E2E Cred Self Claimant' },
    });
    selfRequestClaimantProfileId = claimantProfile.id;

    await page.goto('/claim/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill(claimantUser.email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/claim\/dashboard/);

    await page.goto('/claim/verification-requests');
    await waitForHydration(page);
    await page.getByLabel('Search for the organization').fill('State University');
    await expect(page.getByRole('button', { name: 'State University' })).toBeVisible();
    await page.getByRole('button', { name: 'State University' }).click();
    await page.getByLabel('Credential type').selectOption('EDUCATION');
    await page.getByLabel(/What are you asking them to confirm/).fill('BS Computer Science, ~2018');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Awaiting response')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/employer/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill('university@example.com');
    await page.getByLabel('Password').fill('UniversityPass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/employer\/dashboard/);

    await page.goto('/employer/verification-requests');
    await waitForHydration(page);
    await expect(page.getByText('E2E Cred Self Claimant')).toBeVisible();
    await page.getByRole('button', { name: 'Respond' }).click();
    await page.getByLabel('Title').fill('Bachelor of Science in Computer Science');
    await page.getByLabel('Date').fill('2018-05-15');
    await page.getByLabel('Major / field of study').fill('Computer Science');
    await page.getByRole('button', { name: 'Confirm and submit' }).click();
    await expect(page.getByText('No pending verification requests right now.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/staff/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill('caseworker@example.com');
    await page.getByLabel('Password').fill('CaseworkerPass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/staff\/dashboard/);

    await page.goto(`/staff/claimants/${selfRequestClaimantProfileId}`);
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Verified credentials' })).toBeVisible();
    await expect(page.getByText('Bachelor of Science in Computer Science')).toBeVisible();
    await expect(page.getByText('State University', { exact: true })).toBeVisible();
  });

  test('a caseworker-initiated request requires claimant authorization, and a "no record found" response is visible on the case page', async ({ page }) => {
    const bcrypt = await import('bcryptjs');
    const password = 'E2ECredCaseworkerPass123';
    const claimantUser = await prisma.user.create({
      data: { email: `e2e-cred-cw-${Date.now()}@example.com`, passwordHash: await bcrypt.hash(password, 10), role: 'CLAIMANT' },
    });
    caseworkerInitiatedClaimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'E2E Cred Caseworker Claimant' },
    });
    caseworkerInitiatedClaimantProfileId = claimantProfile.id;

    await page.goto('/staff/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill('caseworker@example.com');
    await page.getByLabel('Password').fill('CaseworkerPass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/staff\/dashboard/);

    await page.goto(`/staff/claimants/${caseworkerInitiatedClaimantProfileId}`);
    await waitForHydration(page);
    await page.getByLabel('Search for the organization').fill('State University');
    await expect(page.getByRole('button', { name: 'State University' })).toBeVisible();
    await page.getByRole('button', { name: 'State University' }).click();
    await page.locator('#requestCredentialType').selectOption('MILITARY_SERVICE');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/PENDING_AUTHORIZATION/)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/claim/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill(claimantUser.email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/claim\/dashboard/);

    await page.goto('/claim/verification-requests');
    await waitForHydration(page);
    await expect(page.getByText('Awaiting your authorization')).toBeVisible();
    await page.getByRole('button', { name: 'Authorize' }).click();
    await expect(page.getByText('Sent — awaiting response')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/employer/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill('university@example.com');
    await page.getByLabel('Password').fill('UniversityPass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/employer\/dashboard/);

    await page.goto('/employer/verification-requests');
    await waitForHydration(page);
    await expect(page.getByText('E2E Cred Caseworker Claimant')).toBeVisible();
    await page.getByRole('button', { name: 'Respond' }).click();
    await page.getByLabel(/No record found — note/).fill('No matching service record on file.');
    await page.getByRole('button', { name: 'No record found' }).click();
    await expect(page.getByText('No pending verification requests right now.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/staff/login');
    await waitForHydration(page);
    await page.getByLabel('Email address').fill('caseworker@example.com');
    await page.getByLabel('Password').fill('CaseworkerPass123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/staff\/dashboard/);

    await page.goto(`/staff/claimants/${caseworkerInitiatedClaimantProfileId}`);
    await waitForHydration(page);
    await expect(page.getByText(/NO_RECORD_FOUND/)).toBeVisible();
    await expect(page.getByText('No matching service record on file.')).toBeVisible();
  });

  test.afterAll(async () => {
    for (const claimantProfileId of [selfRequestClaimantProfileId, caseworkerInitiatedClaimantProfileId].filter(Boolean)) {
      await prisma.credentialRecord.deleteMany({ where: { matchedClaimantProfileId: claimantProfileId } });
      await prisma.credentialVerificationRequest.deleteMany({ where: { claimantProfileId } });
      await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    }
    const universityProfile = await prisma.employerProfile.findFirst({ where: { companyName: 'State University' } });
    if (universityProfile) {
      await prisma.auditLog.deleteMany({ where: { targetEntity: { in: ['CredentialVerificationRequest', 'CredentialRecord'] } } });
    }
    await prisma.user.delete({ where: { id: selfRequestClaimantUserId } }).catch(() => {});
    await prisma.user.delete({ where: { id: caseworkerInitiatedClaimantUserId } }).catch(() => {});
    await prisma.$disconnect();
  });
});
```

`AppNav`'s "Sign out" button (`src/components/layout/AppNav.tsx`) is used for every role switch above, rather than re-visiting a `/login` page while a different role's session is still active.

- [ ] **Step 2: Run the full E2E suite**

Windows/OneDrive note: run `rm -rf .next` first if you hit a stale build-symlink error. Check for a leftover process on port 3000 (`netstat -ano | grep ":3000" | grep LISTENING`, `taskkill //F //PID <pid> //T`) before running.

Run: `npx playwright test`
Expected: all tests pass, including both new scenarios in `credential-verification.spec.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/credential-verification.spec.ts
git commit -m "test: end-to-end coverage for credential verification"
```
