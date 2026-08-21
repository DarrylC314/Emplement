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
    // await import('bcryptjs') resolves to a namespace object whose only
    // usable member is `.default` — bcryptjs is CJS and Node's ESM loader
    // doesn't synthesize named exports for it the way esbuild/webpack do,
    // so `bcrypt.hash` is undefined without unwrapping `.default` first.
    const bcrypt = (await import('bcryptjs')).default;
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

    // waitForURL first: signOut({ callbackUrl: '/' }) (src/components/layout/AppNav.tsx)
    // does an async fetch then a full-document navigation to '/' — that
    // navigation isn't necessarily finished by the time .click() resolves,
    // so an immediate page.goto() below can race it and fail with
    // net::ERR_ABORTED as the two navigations collide.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/');
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
    // Not getByLabel('Date'): the EDUCATION detail fields include a
    // "Graduation date" field on the same form, and Playwright's getByLabel
    // does a case-insensitive substring match by default, so 'Date' matches
    // both labels and throws a strict-mode violation. #eventDate is this
    // field's actual id (src/app/employer/verification-requests/page.tsx),
    // mirroring how the caseworker-initiated test below already
    // disambiguates #requestCredentialType the same way.
    await page.locator('#eventDate').fill('2018-05-15');
    await page.getByLabel('Major / field of study').fill('Computer Science');
    await page.getByRole('button', { name: 'Confirm and submit' }).click();
    await expect(page.getByText('No pending verification requests right now.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/');
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
    const bcrypt = (await import('bcryptjs')).default;
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
    await page.waitForURL('/');
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
    await page.waitForURL('/');
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
    await page.waitForURL('/');
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
