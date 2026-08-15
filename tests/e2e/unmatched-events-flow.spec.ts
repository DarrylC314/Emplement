// tests/e2e/unmatched-events-flow.spec.ts
import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma';
import { hashSSN } from '../../src/lib/ssnHash';
import { waitForHydration } from './helpers';

const caseworkerEmail = `e2e-unmatched-caseworker-${Date.now()}@example.com`;
const caseworkerPassword = 'E2EUnmatchedPass123';
const employerFein = '85-9876543';
const matchSsn = '250-61-9087';

let employerUserId: string;
let employerProfileId: string;
let claimantUserId: string;
let claimantProfileId: string;
let caseworkerUserId: string;
let eventId: string;

test.beforeAll(async () => {
  const caseworkerUser = await prisma.user.create({
    data: {
      email: caseworkerEmail,
      passwordHash: await bcrypt.hash(caseworkerPassword, 10),
      role: 'CASEWORKER',
    },
  });
  caseworkerUserId = caseworkerUser.id;

  const employerUser = await prisma.user.create({
    data: {
      email: `e2e-unmatched-employer-fixture-${Date.now()}@example.com`,
      passwordHash: 'x',
      role: 'EMPLOYER',
    },
  });
  employerUserId = employerUser.id;
  const employerProfile = await prisma.employerProfile.create({
    data: { userId: employerUser.id, fein: employerFein, companyName: 'Unmatched Flow Test Co', verificationStatus: 'VERIFIED' },
  });
  employerProfileId = employerProfile.id;

  const claimantUser = await prisma.user.create({
    data: { email: `e2e-unmatched-claimant-fixture-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
  });
  claimantUserId = claimantUser.id;
  const claimantProfile = await prisma.claimantProfile.create({
    data: { userId: claimantUser.id, legalName: 'Unmatched Flow Fixture Claimant', ssnHash: hashSSN(matchSsn) },
  });
  claimantProfileId = claimantProfile.id;

  // Reported with a wrong ssnHash, deliberately not matching the claimant
  // above — this E2E test proves the manual-match path (a corrected SSN),
  // not the automatic one.
  const event = await prisma.employmentEvent.create({
    data: {
      employerId: employerProfileId,
      type: 'HIRE',
      employeeName: 'Unmatched Flow Fixture Claimant',
      ssnHash: `e2e-original-wrong-hash-${Date.now()}`,
      eventDate: new Date('2026-08-01'),
    },
  });
  eventId = event.id;
});

test('caseworker can see an unmatched event, manually match it, and see it on the claimant case page', async ({
  page,
}) => {
  await page.goto('/staff/login');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill(caseworkerEmail);
  await page.getByLabel('Password').fill(caseworkerPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/staff\/dashboard/);

  await page.goto('/staff/unmatched-events');
  await waitForHydration(page);
  await expect(page.getByText('Unmatched Flow Fixture Claimant').first()).toBeVisible();

  await page.getByRole('button', { name: 'Manual match' }).click();
  await page.getByLabel(/Social Security number/i).fill(matchSsn);
  await page.getByLabel(/Match notes/i).fill('Verified with the claimant directly by phone.');
  await page.getByRole('button', { name: 'Confirm match' }).click();

  await expect(page.getByText('No unmatched events on file.')).toBeVisible();

  const updatedEvent = await prisma.employmentEvent.findUnique({ where: { id: eventId } });
  expect(updatedEvent?.matchedClaimantProfileId).toBe(claimantProfileId);

  await page.goto(`/staff/claimants/${claimantProfileId}`);
  await waitForHydration(page);
  await expect(page.getByText(/Hired by Unmatched Flow Test Co/i)).toBeVisible();
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [caseworkerUserId, employerUserId] } },
  });
  await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
  await prisma.employerProfile.delete({ where: { id: employerProfileId } });
  await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
  await prisma.user.delete({ where: { id: claimantUserId } });
  await prisma.user.delete({ where: { id: employerUserId } });
  await prisma.user.delete({ where: { id: caseworkerUserId } });
  await prisma.$disconnect();
});
