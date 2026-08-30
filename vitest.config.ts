import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'tools/*/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
    ],
    // Tests never reach the network. Recording is done only by tools/record-fixture.
    env: { RELOKIT_SERPAPI_MODE: 'replay' },
  },
})
