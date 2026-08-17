// tests/e2e/employment-expiration.spec.ts
import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma';
import { hashSSN } from '../../src/lib/ssnHash';
import { waitForHydration } from './helpers';

const caseworkerEmail = `e2e-expiration-caseworker-${Date.now()}@example.com`;
const caseworkerPassword = 'E2EExpirationPass123';
const claimantSsn = '733-22-4411';

let employerUserId: string;
let employerProfileId: string;
let claimantUserId: string;
let claimantProfileId: string;
let caseworkerUserId: string;
let claimId: string;
let employmentEventId: string;

test.beforeAll(async () => {
  await prisma.user.upsert({
    where: { email: 'system@emplement.internal' },
    update: {},
    create: { email: 'system@emplement.internal', passwordHash: 'x', role: 'ADMIN' },
  });

  const caseworkerUser = await prisma.user.create({
    data: { email: caseworkerEmail, passwordHash: await bcrypt.hash(caseworkerPassword, 10), role: 'CASEWORKER' },
  });
  caseworkerUserId = caseworkerUser.id;

  const employerUser = await prisma.user.create({
    data: { email: `e2e-expiration-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
  });
  employerUserId = employerUser.id;
  const employerProfile = await prisma.employerProfile.create({
    data: { userId: employerUser.id, companyName: 'E2E Expiration Test Co', verificationStatus: 'VERIFIED' },
  });
  employerProfileId = employerProfile.id;

  const claimantUser = await prisma.user.create({
    data: { email: `e2e-expiration-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
  });
  claimantUserId = claimantUser.id;
  const claimantProfile = await prisma.claimantProfile.create({
    data: {
      userId: claimantUser.id,
      legalName: 'E2E Expiration Fixture Claimant',
      ssnHash: hashSSN(claimantSsn),
      identityVerificationStatus: 'VERIFIED',
    },
  });
  claimantProfileId = claimantProfile.id;

  const claim = await prisma.claim.create({
    data: {
      claimantId: claimantProfileId,
      status: 'RESTRICTED',
      benefitYearStart: new Date('2026-08-01'),
      benefitYearEnd: new Date('2027-08-01'),
      weeklyBenefitAmount: 320,
    },
  });
  claimId = claim.id;

  // Already-past expectedEndDate, so it's due the moment the check runs.
  const event = await prisma.employmentEvent.create({
    data: {
      employerId: employerProfileId,
      type: 'HIRE',
      employeeName: 'E2E Expiration Fixture Claimant',
      ssnHash: hashSSN(claimantSsn),
      eventDate: new Date('2026-01-01'),
      expectedEndDate: new Date('2026-01-15'),
      matchedClaimantProfileId: claimantProfileId,
    },
  });
  employmentEventId = event.id;
});

test('a caseworker runs the expiration check and sees the resulting story on the claimant case page', async ({ page }) => {
  await page.goto('/staff/login');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill(caseworkerEmail);
  await page.getByLabel('Password').fill(caseworkerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/staff\/dashboard/);

  await page.getByRole('button', { name: 'Run expiration check now' }).click();
  await expect(page.getByText(/1 evaluated/i)).toBeVisible();
  await expect(page.getByText(/1 reactivated/i)).toBeVisible();

  await page.goto(`/staff/claimants/${claimantProfileId}`);
  await waitForHydration(page);
  await expect(page.getByRole('heading', { name: 'Case timeline' })).toBeVisible();
  await expect(page.getByText('Separated', { exact: true })).toBeVisible();
  await expect(page.getByText(/Fixed-term\/seasonal employment concluded/i)).toBeVisible();
  await expect(page.getByText('Claim reactivated')).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  const separation = await prisma.employmentEvent.findFirst({
    where: { employerId: employerProfileId, type: 'SEPARATION' },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: [caseworkerUserId] } },
        { targetEntity: 'EmploymentEvent', targetId: { in: [employmentEventId, separation?.id ?? ''] } },
      ],
    },
  });
  await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
  if (separation) await prisma.employmentEvent.delete({ where: { id: separation.id } });
  await prisma.employmentEvent.delete({ where: { id: employmentEventId } });
  await prisma.claim.delete({ where: { id: claimId } });
  await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
  await prisma.user.delete({ where: { id: claimantUserId } });
  await prisma.employerProfile.delete({ where: { id: employerProfileId } });
  await prisma.user.delete({ where: { id: employerUserId } });
  await prisma.user.delete({ where: { id: caseworkerUserId } });
  await prisma.$disconnect();
});
