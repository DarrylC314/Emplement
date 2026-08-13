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

test('caseworker can log in, open a flagged case, and record a review decision', async ({
  page,
}) => {
  await page.goto('/staff/login');
  await page.getByLabel('Email address').fill(caseworkerEmail);
  await page.getByLabel('Password').fill(caseworkerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/staff\/dashboard/);
  await expect(page.getByText(/review queue/i)).toBeVisible();

  // Walk the real path a caseworker walks: queue -> case detail -> review form.
  // Previously this test stopped at the queue, so the review loop — the whole
  // point of the staff side — was never exercised in a browser.
  // Scoped to this fixture's own queue row: the queue is global, so seed data
  // and other suites' flagged certifications can also be listed, and a bare
  // .first() would open whichever case happens to be oldest.
  const queueRow = page.locator('li').filter({ hasText: 'E2E Fixture Claimant' });
  await queueRow.getByRole('link', { name: /review case/i }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/claimants/${claimantProfileId}`));
  await expect(page.getByRole('heading', { name: 'E2E Fixture Claimant' })).toBeVisible();

  await page.getByRole('link', { name: /^review$/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/staff/certifications/${certificationId}/review`));

  // Wait for hydration before submitting. The nav's sign-out button only
  // renders once useSession() has resolved client-side, so its presence proves
  // React is live; clicking the submit button before that fires a *native* form
  // submission (the form's onSubmit handler isn't attached yet), which reloads
  // the page and loses the validation the next assertion is checking.
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();

  // An empty reason must be reported on the field, not silently submitted.
  await page.getByRole('button', { name: /submit decision/i }).click();
  await expect(page.getByText(/enter a reason for this decision/i).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/staff/certifications/${certificationId}/review`));

  await page.getByLabel('Approve').check();
  await page
    .getByLabel(/reason/i)
    .fill('Job-search log confirmed by phone; contacts verified with employers.');
  await page.getByRole('button', { name: /submit decision/i }).click();

  await expect(page).toHaveURL(/\/staff\/dashboard/);
  // Reviewed certifications drop out of the queue (the route filters on
  // reviewActions: { none: {} }). Asserted against this fixture's own claimant
  // rather than the total count, since seed/other data may also be queued.
  await expect(page.getByText('E2E Fixture Claimant')).toHaveCount(0);

  const reviewAction = await prisma.claimReviewAction.findFirst({
    where: { weeklyCertificationId: certificationId },
  });
  expect(reviewAction).not.toBeNull();
  expect(reviewAction?.action).toBe('APPROVED');
  // Attribution comes from the session, never the client.
  expect(reviewAction?.caseworkerId).toBe(caseworkerUserId);

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  expect(claim?.status).toBe('ACTIVE');

  const auditLog = await prisma.auditLog.findFirst({
    where: { action: 'CLAIM_REVIEWED', targetId: reviewAction!.id },
  });
  expect(auditLog).not.toBeNull();
});

test.afterAll(async () => {
  // FK-safe cleanup order. The test now submits a real review decision, so it
  // also creates ClaimReviewAction and AuditLog rows, which must be removed
  // before the caseworker User they reference.
  await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
  await prisma.claimReviewAction.deleteMany({ where: { weeklyCertificationId: certificationId } });
  await prisma.weeklyCertification.deleteMany({ where: { id: certificationId } });
  await prisma.claim.deleteMany({ where: { id: claimId } });
  await prisma.claimantProfile.deleteMany({ where: { id: claimantProfileId } });
  await prisma.user.deleteMany({ where: { id: { in: [claimantUserId, caseworkerUserId] } } });
  await prisma.$disconnect();
});
