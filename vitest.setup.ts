import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Unlike `next dev`/`next build`/`next start` and the Prisma CLI (both of
// which auto-load `.env`), Vitest does not — so DATABASE_URL and friends
// were silently depending on being manually exported into the shell before
// running tests. This makes `npm test` work reliably from a clean checkout.
try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional: CI and other environments may set real env vars directly.
}

afterEach(() => {
  cleanup();
});
