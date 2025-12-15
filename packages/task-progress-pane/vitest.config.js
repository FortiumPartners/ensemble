import { defineConfig } from 'vitest/config';

// Skip integration tests in CI (they require tmux which isn't available)
const isCI = process.env.CI === 'true';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: isCI ? [
      'node_modules/**',
      '**/tests/integration/**'
    ] : [
      'node_modules/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.test.js'
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80
      }
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
