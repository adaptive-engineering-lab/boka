import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Integration tests touch a real local Supabase stack; running them in parallel
    // against shared tables produces flaky rate-limit and count assertions.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` throws on import outside a React Server Component, which is the
      // point of it — and which makes the modules that use it untestable here. Stubbing
      // the specifier gives the tests access; the guarantee itself is enforced by the
      // Next build and by no-service-key.test.ts against the real bundles.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
