// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  // Multiple parallel workers each launch their own Chromium instance but
  // share the single `next start` server below (reuseExistingServer), so
  // concurrent load intermittently pushed unrelated tests past their default
  // action/assertion timeouts. Confirmed via a clean 37/37 pass at workers:1
  // vs. a different sporadic failure on two separate default-worker-count runs.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Production bundle, not `next dev`. Against a cold dev server, Next.js
    // compiles each route on first request, which routinely blew the default
    // assertion timeout and made ~2 of 6 tests fail unless the server had
    // already been warmed by hand. Building first removes on-demand compilation
    // entirely and matches how CI runs the app.
    command: 'npm run test:e2e:server',
    url: 'http://localhost:3000',
    // Locally, reuse a server that is already listening; in CI always start a
    // clean one so the suite can never pass against a stale build.
    reuseExistingServer: !process.env.CI,
    // Generous enough to cover a full `next build` from a cold .next directory.
    timeout: 300_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
