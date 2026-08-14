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
  // The login page redirects every employer straight to the dashboard
  // regardless of FEIN verification status (src/app/employer/login/page.tsx)
  // — there's no automatic hand-off to /employer/verify-fein. An
  // unverified employer navigates there directly (e.g. from an onboarding
  // link), which is what this test does next.
  await expect(page).toHaveURL(/\/employer\/dashboard/);

  await page.goto('/employer/verify-fein');
  await waitForHydration(page);
  await page.getByLabel(/FEIN/i).fill(employerFein);
  await page.getByLabel('Company name').fill('E2E Test Employer');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/employer\/dashboard/);

  await waitForHydration(page);
  // The dashboard's wage-record list doesn't render the record's
  // employerName field (src/app/employer/dashboard/page.tsx only renders
  // workLocation/jobTitle/wageRate/hoursPerWeek/separationReason) — assert
  // on a field it does render to confirm the fixture record loaded.
  await expect(page.getByText('Test City, MO')).toBeVisible();
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
