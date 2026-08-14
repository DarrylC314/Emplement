// tests/e2e/accessibility.spec.ts
import path from 'path';
import os from 'os';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma';
import { waitForHydration } from './helpers';

const PUBLIC_ROUTES = ['/', '/claim/signup', '/claim/login', '/staff/login'];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

for (const route of PUBLIC_ROUTES) {
  test(`${route} has no automatically detectable accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expectNoViolations(page);
  });
}

// ---------------------------------------------------------------------------
// Authenticated routes.
//
// The gate previously covered only the four public pages, which left every page
// with real accessibility surface — the certification wizard and identity
// verification flow the spec names explicitly, both dashboards, the case detail
// and review pages — unscanned. Each role logs in through the UI exactly once
// here and its cookies are reused via storageState, rather than repeating a
// login in every test.
// ---------------------------------------------------------------------------

const stamp = Date.now();
const claimantEmail = `e2e-a11y-claimant-${stamp}@example.com`;
const caseworkerEmail = `e2e-a11y-caseworker-${stamp}@example.com`;
const password = 'A11yTestPass123';

const claimantStatePath = path.join(os.tmpdir(), `a11y-claimant-${stamp}.json`);
const caseworkerStatePath = path.join(os.tmpdir(), `a11y-caseworker-${stamp}.json`);

let claimantUserId: string;
let caseworkerUserId: string;
let claimantProfileId: string;
let claimId: string;
let certificationId: string;
let verificationReference: string;

test.beforeAll(async ({ browser }) => {
  const passwordHash = await bcrypt.hash(password, 12);

  const claimantUser = await prisma.user.create({
    data: { email: claimantEmail, passwordHash, role: 'CLAIMANT' },
  });
  claimantUserId = claimantUser.id;

  const caseworkerUser = await prisma.user.create({
    data: { email: caseworkerEmail, passwordHash, role: 'CASEWORKER' },
  });
  caseworkerUserId = caseworkerUser.id;

  const profile = await prisma.claimantProfile.create({
    data: {
      userId: claimantUser.id,
      legalName: 'A11y Fixture Claimant',
      identityVerificationStatus: 'VERIFIED',
    },
  });
  claimantProfileId = profile.id;

  verificationReference = `mock-idv-a11y-${stamp}`;
  await prisma.identityVerificationAttempt.create({
    data: {
      claimantId: profile.id,
      mockProvider: 'MockIDProof',
      status: 'PENDING',
      mockReferenceId: verificationReference,
    },
  });

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
      claimId: claim.id,
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

  await prisma.message.create({
    data: {
      claimantId: profile.id,
      caseworkerId: caseworkerUser.id,
      subject: 'Additional information needed',
      body: 'Please confirm your job-search contacts for the week ending 8/15.',
    },
  });

  for (const [email, loginPath, expectedUrl, statePath] of [
    [claimantEmail, '/claim/login', /\/claim\/dashboard/, claimantStatePath],
    [caseworkerEmail, '/staff/login', /\/staff\/dashboard/, caseworkerStatePath],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:3000' + loginPath);
    await waitForHydration(page);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(expectedUrl);
    await context.storageState({ path: statePath });
    await context.close();
  }
});

test.describe('claimant pages', () => {
  test.use({ storageState: claimantStatePath });

  test('/claim/dashboard has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/claim/dashboard');
    await expect(page.getByRole('heading', { name: /your claims/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('/claim/wage-confirmation has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/claim/wage-confirmation?claimId=${claimId}`);
    await expect(page.getByRole('heading', { name: /confirm your employment/i })).toBeVisible();
    await waitForHydration(page);
    // The mock lookup can return either state; both must render accessibly.
    await expect(
      page
        .getByRole('button', { name: 'Confirm' })
        .first()
        .or(page.getByText(/didn't find any employer or wage records/i))
    ).toBeVisible({ timeout: 10_000 });
    await expectNoViolations(page);
  });

  test('/claim/certify has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/claim/certify?claimId=${claimId}`);
    await expect(page.getByRole('heading', { name: /weekly certification/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('/claim/verify-identity has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/claim/verify-identity');
    await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('the identity verification callback form has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/claim/verify-identity/callback?ref=${verificationReference}`);
    await expect(page.getByLabel('Legal name')).toBeVisible();
    await expectNoViolations(page);
  });

  test('/claim/messages has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/claim/messages');
    await expect(page.getByText(/additional information needed/i)).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe('staff pages', () => {
  test.use({ storageState: caseworkerStatePath });

  test('/staff/dashboard has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/staff/dashboard');
    await expect(page.getByRole('heading', { name: /review queue/i })).toBeVisible();
    await expectNoViolations(page);
  });

  test('the staff case detail page has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/staff/claimants/${claimantProfileId}`);
    await expect(page.getByRole('heading', { name: 'A11y Fixture Claimant' })).toBeVisible();
    await expectNoViolations(page);
  });

  test('the certification review page has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/staff/certifications/${certificationId}/review`);
    await expect(page.getByRole('heading', { name: /review certification/i })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [claimantUserId, caseworkerUserId] } },
  });
  await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
  await prisma.claimReviewAction.deleteMany({
    where: { weeklyCertificationId: certificationId },
  });
  await prisma.jobSearchActivity.deleteMany({
    where: { weeklyCertificationId: certificationId },
  });
  await prisma.wageRecord.deleteMany({ where: { claimId } });
  await prisma.weeklyCertification.deleteMany({ where: { id: certificationId } });
  await prisma.claim.deleteMany({ where: { id: claimId } });
  await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: claimantProfileId } });
  await prisma.claimantProfile.deleteMany({ where: { id: claimantProfileId } });
  await prisma.user.deleteMany({ where: { id: { in: [claimantUserId, caseworkerUserId] } } });
  await prisma.$disconnect();
});
