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

// Workaround for Node.js FormData in test environments:
// Store FormData bodies and return them directly from formData() method.
const OriginalRequest = global.Request;

global.Request = new Proxy(OriginalRequest, {
  construct(target, args) {
    const [input, init] = args;
    const request = new target(input, init);

    // If the body is a FormData, store it and provide access to it
    if (init?.body instanceof FormData) {
      const storedFormData = init.body;

      // Attach the FormData to the request object so formData() can access it
      (request as any)._storedFormData = storedFormData;

      // Create a proxy for the request to intercept formData() calls
      return new Proxy(request, {
        get(target, prop) {
          if (prop === 'formData') {
            // Return a function that resolves with the stored FormData
            return async () => (target as any)._storedFormData;
          }
          return Reflect.get(target, prop);
        },
      });
    }

    return request;
  },
});

afterEach(() => {
  cleanup();
});
