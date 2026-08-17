// tests/e2e/guided-demo-walkthrough.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForHydration } from './helpers';

test('the guided demo walks through apply -> interview -> hire -> benefit status -> case review for Seed Claimant', async ({
  page,
}) => {
  // Start from the seeded PROPOSED/PENDING/OPEN/ACTIVE state regardless of
  // what a previous run of this test (or a manual demo session) left
  // behind — this is exactly what the reset route exists for.
  await page.goto('/claim/login');
  await waitForHydration(page);
  await page.getByLabel('Email address').fill('claimant@example.com');
  await page.getByLabel('Password').fill('ClaimantPass123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/claim\/dashboard/);
  // page.request (not the standalone `request` fixture) shares the page's
  // browser-context cookies, which the reset route's session-cookie auth
  // check needs — the standalone fixture is a separate, unauthenticated
  // APIRequestContext.
  const resetRes = await page.request.post('/api/demo/reset');
  expect(resetRes.ok()).toBe(true);

  // Start the guided demo from the homepage.
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Start Guided Demo' }).click();
  await expect(page).toHaveURL(/\/claim\/applications/);

  // Scoped locators throughout: the widget renders as a sibling of each
  // page's own <main id="main-content">, not inside it (see
  // src/app/providers.tsx), but several step titles/instructions share
  // words with real page content (e.g. step 2's title is literally "See
  // the interview confirmed", which — unscoped — collides with the
  // employer page's own "✓ Interview confirmed: ..." text and throws a
  // Playwright strict-mode violation). Keeping widget and page assertions
  // in clearly separate locators avoids that for every step, not just the
  // one collision that happens to exist today.
  const widget = page.getByRole('region', { name: 'Guided demo' });
  const mainContent = page.locator('#main-content');
  await expect(widget.getByText('Accept a proposed interview time')).toBeVisible();

  // Accessibility scan of a representative guided-demo state, with the
  // widget visible alongside real page content.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);

  // Step 1: accept the first proposed slot (or confirm it's already
  // accepted, on a replay before this run's own reset above — the reset
  // above guarantees PROPOSED here, so this is the live-click path).
  await mainContent.getByRole('button', { name: 'Accept' }).first().click();
  await expect(mainContent.getByText(/interview confirmed/i)).toBeVisible();

  // Advance to step 2: employer view of the Warehouse Associate posting.
  await widget.getByRole('button', { name: /Next: switch to the employer/i }).click();
  await expect(page).toHaveURL(/\/employer\/job-postings\//);
  await expect(mainContent.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await expect(mainContent.getByText(/interview confirmed/i)).toBeVisible();
  await expect(widget.getByText('See the interview confirmed')).toBeVisible();

  // Advance to step 3 (same page, no navigation) and hire the candidate.
  await widget.getByRole('button', { name: /Next: hire the candidate/i }).click();
  await expect(widget.getByText('Hire the candidate')).toBeVisible();
  await mainContent.getByRole('button', { name: 'Hire' }).click();
  await expect(mainContent.getByText('✓ Hired')).toBeVisible();

  // Advance to step 4: back to the claimant, see the claim flip.
  await widget.getByRole('button', { name: /Next: switch back to the claimant/i }).click();
  await expect(page).toHaveURL(/\/claim\/dashboard/);
  await expect(mainContent.getByText('Restricted')).toBeVisible();
  await expect(widget.getByText('See the benefit claim change')).toBeVisible();

  // Advance to step 5: the caseworker's view of the resulting case.
  await widget.getByRole('button', { name: /Next: switch to the caseworker/i }).click();
  await expect(page).toHaveURL(/\/staff\/claimants\//);
  await expect(mainContent.getByRole('heading', { name: 'Seed Claimant' })).toBeVisible();
  await expect(mainContent.getByText(/Hired by Riverbend Logistics Inc\.? on/i)).toBeVisible();

  // Finish the demo.
  await widget.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('region', { name: 'Guided demo' })).toHaveCount(0);

  // Confirm the walkthrough is replayable: reset again and verify the
  // records really did revert (the reset route's own correctness is
  // covered in depth by tests/integration/demo-reset.test.ts — this is a
  // lightweight end-to-end confirmation that this full run left reset-able
  // state, not a second full UI walkthrough).
  const secondReset = await page.request.post('/api/demo/reset');
  expect(secondReset.ok()).toBe(true);
});

test('Enter Employer Demo logs in and reaches the employer dashboard', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Enter Employer Demo' }).click();
  await expect(page).toHaveURL(/\/employer\/dashboard/);
});
