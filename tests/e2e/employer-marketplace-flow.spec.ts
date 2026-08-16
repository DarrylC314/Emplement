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

let claimantProfileId: string;
let claimId: string;

// Note: unlike accessibility.spec.ts's fixtures (which log in against
// prisma-seeded users and never touch /claim/signup or /employer/signup),
// this test drives real signup for both roles so the password is genuinely
// bcrypt-hashed through the signup route and ssnHash is genuinely populated
// by identity verification. That means the User/ClaimantProfile rows can't
// be pre-seeded via prisma under the same email beforeAll — doing so would
// make the real signup call 409 ("already exists") before the flow even
// starts. Instead, the ACTIVE claim needed to observe the RESTRICTED
// transition is created directly via prisma mid-test, right after identity
// verification produces a real claimantProfileId with a real ssnHash (the
// hire route requires ssnHash to be non-null).

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

  // The claimant's User/ClaimantProfile now exist for real, with a real
  // ssnHash from identity verification. Seed an ACTIVE claim directly against
  // that real profile — there's no "file a claim" step in this flow, and the
  // hire transaction later needs a claim to restrict and a non-null ssnHash
  // to write an EmploymentEvent for.
  const claimantUser = await prisma.user.findUniqueOrThrow({
    where: { email: claimantEmail },
    include: { claimantProfile: true },
  });
  claimantProfileId = claimantUser.claimantProfile!.id;
  const seededClaim = await prisma.claim.create({
    data: {
      claimantId: claimantProfileId,
      status: 'ACTIVE',
      benefitYearStart: new Date('2026-08-15'),
      benefitYearEnd: new Date('2027-08-15'),
      weeklyBenefitAmount: 300,
    },
  });
  claimId = seededClaim.id;

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
  // Looked up fresh by email rather than relying on module-level ids, so
  // teardown still cleans up correctly even if the test failed partway
  // through (e.g. before claimantProfileId/claimId were ever assigned).
  const claimantUser = await prisma.user.findUnique({
    where: { email: claimantEmail },
    include: { claimantProfile: true },
  });
  const employerUser = await prisma.user.findUnique({
    where: { email: employerEmail },
    include: { employerProfile: true },
  });

  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [claimantUser?.id, employerUser?.id].filter((id): id is string => Boolean(id)) } },
  });

  if (employerUser?.employerProfile) {
    await prisma.jobApplication.deleteMany({
      where: { jobPosting: { employerId: employerUser.employerProfile.id } },
    });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerUser.employerProfile.id } });
    await prisma.jobPosting.deleteMany({ where: { employerId: employerUser.employerProfile.id } });
    await prisma.employerProfile.delete({ where: { id: employerUser.employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
  }

  if (claimantUser?.claimantProfile) {
    const profileId = claimantUser.claimantProfile.id;
    await prisma.message.deleteMany({ where: { claimantId: profileId } });
    await prisma.candidateProfile.deleteMany({ where: { claimantProfileId: profileId } });
    await prisma.claim.deleteMany({ where: { claimantId: profileId } });
    await prisma.identityVerificationAttempt.deleteMany({ where: { claimantId: profileId } });
    await prisma.claimantProfile.delete({ where: { id: profileId } });
  }
  if (claimantUser) {
    await prisma.user.delete({ where: { id: claimantUser.id } });
  }

  await prisma.$disconnect();
});
