import type { Page } from '@playwright/test';

/**
 * Waits for the app's client-side hydration marker (see src/app/providers.tsx)
 * before interacting with a form. Playwright's own actionability checks pass
 * as soon as an element is visible/stable/enabled, which happens before React
 * has attached event handlers — clicking in that window fires a native form
 * submission instead of the page's onSubmit, reloading the page and losing
 * whatever the test just filled in. Works on unauthenticated pages too,
 * unlike waiting on a signed-in-only element such as the nav's sign-out
 * button.
 */
export async function waitForHydration(page: Page) {
  await page.waitForSelector('body[data-hydrated="true"]', { state: 'attached' });
}
