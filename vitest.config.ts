// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
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
