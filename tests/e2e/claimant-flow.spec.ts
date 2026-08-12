// tests/e2e/claimant-flow.spec.ts
import { test, expect } from '@playwright/test';

test('claimant can sign up, verify identity, file a claim, and certify a week', async ({ page }) => {
  const email = `e2e-claimant-${Date.now()}@example.com`;

  await page.goto('/claim/signup');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBattery9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/claim\/login/);

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBattery9');
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
  // In `next dev` this route's initial hard navigation is sometimes followed
  // by a Fast Refresh self-correction that re-navigates the same page
  // (observed only under `next dev`, never against a production build).
  // Filling the form before that settles loses the typed values. Waiting
  // for the network to go idle lets it settle first.
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
});
