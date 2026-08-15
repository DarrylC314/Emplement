// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // esbuild (Vite's default ts/tsx transform) otherwise falls back to the
  // classic JSX pragma, which requires `React` in module scope. The app's
  // own page/component files rely on Next.js's automatic JSX runtime and
  // don't import React (tsconfig.json's `jsx: "preserve"` defers the actual
  // transform to Next.js's build, not tsc) — matching that here lets
  // component/page tests render them under vitest without every file
  // needing its own `import React from 'react'`.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
    ],
    env: {
      SSN_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SSN_HASH_KEY:
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
