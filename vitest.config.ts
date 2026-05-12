import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load environment variables from __tests__/.env file
config({
  path: '__tests__/.env'
});

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    typecheck: { tsconfig: '__tests__/tsconfig.json' },
    coverage: {
      provider: 'v8',
      reporter: ['text']
    },
    testTimeout: 100000
  }
});
