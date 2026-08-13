// tests/e2e/claimant-flow.spec.ts
import { test, expect } from '@playwright/test';
import { prisma } from '../../src/lib/prisma';

const email = `e2e-claimant-${Date.now()}@example.com`;
const password = 'CorrectHorseBattery9';

test('claimant can sign up, verify identity, file a claim, and certify a week', async ({ page }) => {
  await page.goto('/claim/signup');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/claim\/login/);

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Wait for the login page's own client-side redirect (triggered after its
  // signIn() call resolves) before navigating onward. Without this, a
  // page.goto() issued immediately after the click can abort the in-flight
  // signIn() request before the session cookie is written, leaving
  // subsequent pages unauthenticated.
  await expect(page).toHaveURL(/\/claim\/dashboard/);

  await page.goto('/claim/verify-identity');
  // Scoped to the heading role: the page body copy also contains the
  // literal phrase "verify your identity" ("...used to verify your
  // identity and process your claim"), so a plain getByText(/verify your
  // identity/i) matches both the <h1> and the <p> and throws a strict-mode
  // violation. Scoping to the heading keeps the same assertion intent
  // (the page announces itself) while resolving to a single element.
  await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();
  await page.getByRole('button', { name: /continue to identity verification/i }).click();

  await page.waitForURL(/\/claim\/verify-identity\/callback/);
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Legal name').fill('E2E Test Claimant');
  await page.getByLabel(/date of birth/i).fill('1990-01-15');
  await page.getByLabel(/social security number/i).fill('123-45-6789');
  await page.getByLabel(/phone number/i).fill('5551234567');
  await page.getByLabel(/mailing address/i).fill('123 Main St, Jefferson City, MO 65101');
  await page.getByRole('button', { name: /verify identity/i }).click();

  await expect(page).toHaveURL(/\/claim\/new/);
  await page.getByLabel(/employment history/i).fill('Worked at Acme Corp for 3 years.');
  await page.getByLabel('Laid off / position eliminated').check();
  await page.getByLabel(/benefit year start date/i).fill('2026-08-11');
  await page.getByRole('button', { name: /submit claim/i }).click();

  await expect(page).toHaveURL(/\/claim\/dashboard/);
  await expect(page.getByText('Active')).toBeVisible();

  // The weekly certification wizard is the application's central mechanism and
  // was never exercised in a browser before, despite this test's title. Follow
  // the dashboard's own per-claim link rather than constructing the URL, which
  // also proves the dashboard links to a usable claimId.
  await page.getByRole('link', { name: /certify this week/i }).first().click();
  await expect(page).toHaveURL(/\/claim\/certify\?claimId=/);
  await expect(page.getByRole('heading', { name: /weekly certification/i })).toBeVisible();
  // Hydration gate: the nav's sign-out button only appears once useSession()
  // has resolved client-side. Interacting before that submits the form
  // natively (no React handler attached yet) and silently loses the wizard's
  // state.
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();

  await page.getByLabel(/week ending date/i).fill('2026-08-15');
  // The wizard starts with one job-search entry; three are required for a
  // clean auto-approval.
  await page.getByRole('button', { name: /add another job search activity/i }).click();
  await page.getByRole('button', { name: /add another job search activity/i }).click();

  const employers = ['Acme Corp', 'Beta Works', 'Gamma Industries'];
  for (let i = 0; i < employers.length; i += 1) {
    await page.locator(`#employer-${i}`).fill(employers[i]!);
    await page.locator(`#method-${i}`).fill('Online application');
    await page.locator(`#date-${i}`).fill('2026-08-12');
    await page.locator(`#position-${i}`).fill('Machinist');
  }

  await page.getByRole('button', { name: /submit certification/i }).click();
  await expect(page).toHaveURL(/\/claim\/dashboard/);

  // The certification really landed, and the rules engine really ran on it.
  const certification = await prisma.weeklyCertification.findFirst({
    where: { claim: { claimant: { user: { email } } } },
  });
  expect(certification).not.toBeNull();
  expect(certification?.autoDecision).toBe('APPROVED');
});

test.afterAll(async () => {
  // FK-safe teardown, mirroring caseworker-flow.spec.ts. This spec creates a
  // User, ClaimantProfile, IdentityVerificationAttempt, Claim,
  // WeeklyCertification (+ JobSearchActivity rows) and AuditLog rows
  // (IDENTITY_VERIFIED, CLAIM_OPENED, CERTIFICATION_SUBMITTED); without this it
  // leaked all of them into the database on every run.
  const user = await prisma.user.findUnique({
    where: { email },
    include: { claimantProfile: { include: { claims: true } } },
  });
  if (user) {
    const claimIds = user.claimantProfile?.claims.map((c) => c.id) ?? [];
    await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
    await prisma.jobSearchActivity.deleteMany({
      where: { weeklyCertification: { claimId: { in: claimIds } } },
    });
    await prisma.weeklyCertification.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.claim.deleteMany({ where: { id: { in: claimIds } } });
    if (user.claimantProfile) {
      await prisma.identityVerificationAttempt.deleteMany({
        where: { claimantId: user.claimantProfile.id },
      });
      await prisma.message.deleteMany({ where: { claimantId: user.claimantProfile.id } });
      await prisma.claimantProfile.delete({ where: { id: user.claimantProfile.id } });
    }
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});
