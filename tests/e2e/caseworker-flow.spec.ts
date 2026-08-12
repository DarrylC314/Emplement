// tests/e2e/caseworker-flow.spec.ts
import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma';

// DEVIATION FROM BRIEF: the brief's original version of this test assumed a
// caseworker account seeded by Task 21 (`caseworker@example.com` /
// `CaseworkerPass123`). Task 21 runs *after* this task in the plan, so that
// account does not exist yet when this suite runs. Rather than depend on
// not-yet-created seed data, this test creates its own fixtures via Prisma
// directly before the test runs, following the same pattern every
// integration test in this codebase already uses (see
// tests/integration/staff-queue.test.ts): a CLAIMANT user + ClaimantProfile,
// a Claim, and a WeeklyCertification with autoDecision: 'FLAGGED' so it
// shows up in the review queue. It also creates its own CASEWORKER user with
// a freshly hashed password. Everything created here is torn down in
// afterAll.

const caseworkerEmail = `e2e-caseworker-${Date.now()}@example.com`;
const caseworkerPassword = 'E2ETestPass123';

let caseworkerUserId: string;
let claimantUserId: string;
let claimantProfileId: string;
let claimId: string;
let certificationId: string;

test.beforeAll(async () => {
  const caseworker = await prisma.user.create({
    data: {
      email: caseworkerEmail,
      passwordHash: await bcrypt.hash(caseworkerPassword, 12),
      role: 'CASEWORKER',
    },
  });
  caseworkerUserId = caseworker.id;

  const claimant = await prisma.user.create({
    data: {
      email: `e2e-caseworker-fixture-claimant-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('FixtureClaimantPass123', 12),
      role: 'CLAIMANT',
    },
  });
  claimantUserId = claimant.id;

  const profile = await prisma.claimantProfile.create({
    data: { userId: claimant.id, legalName: 'E2E Fixture Claimant' },
  });
  claimantProfileId = profile.id;

  const claim = await prisma.claim.create({
    data: {
      claimantId: profile.id,
      status: 'RESTRICTED',
      benefitYearStart: new Date('2026-08-11'),
      benefitYearEnd: new Date('2027-08-11'),
      weeklyBenefitAmount: 320,
    },
  });
  claimId = claim.id;

  const certification = await prisma.weeklyCertification.create({
    data: {
      claimId,
      weekEndingDate: new Date('2026-08-15'),
      ableAndAvailable: true,
      workedThisWeek: false,
      earnings: 0,
      refusedWork: false,
      autoDecision: 'FLAGGED',
      autoDecisionReason: 'Fewer than 3 job-search contacts.',
    },
  });
  certificationId = certification.id;
});

test('caseworker can log in and see the review queue', async ({ page }) => {
  await page.goto('/staff/login');
  await page.getByLabel('Email address').fill(caseworkerEmail);
  await page.getByLabel('Password').fill(caseworkerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/staff\/dashboard/);
  await expect(page.getByText(/review queue/i)).toBeVisible();
});

test.afterAll(async () => {
  // FK-safe cleanup order. This fixture never exercises the certification
  // review flow (the test only views the queue, it doesn't submit a
  // review), so no ClaimReviewAction or AuditLog rows are created by this
  // test — verified by reading src/app/api/staff/queue/route.ts (a plain
  // read) and confirming writeAuditLog is only called from the review and
  // record-edit routes, neither of which this test touches.
  await prisma.weeklyCertification.deleteMany({ where: { id: certificationId } });
  await prisma.claim.deleteMany({ where: { id: claimId } });
  await prisma.claimantProfile.deleteMany({ where: { id: claimantProfileId } });
  await prisma.user.deleteMany({ where: { id: { in: [claimantUserId, caseworkerUserId] } } });
  await prisma.$disconnect();
});
