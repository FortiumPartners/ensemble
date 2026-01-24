/**
 * Playwright Configuration Template
 *
 * Comprehensive configuration with projects, auth setup, and CI optimization.
 *
 * Usage: Copy to playwright.config.ts and customize.
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from .env file
 * Requires: npm install dotenv
 */
// require('dotenv').config();

export default defineConfig({
  // Test directory
  testDir: './tests',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests (more retries in CI)
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers (reduce in CI for stability)
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    // Always show list
    ['list'],
    // HTML report for local development
    ['html', { open: 'never' }],
    // JSON for CI/CD integration
    ['json', { outputFile: 'test-results/results.json' }],
    // JUnit for CI systems
    ...(process.env.CI ? [['junit', { outputFile: 'test-results/junit.xml' }]] : []),
  ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure (CI only to save space)
    video: process.env.CI ? 'retain-on-failure' : 'off',

    // Default timeout for actions
    actionTimeout: 10000,

    // Default timeout for navigation
    navigationTimeout: 30000,
  },

  // Timeout per test
  timeout: 60000,

  // Timeout for expect assertions
  expect: {
    timeout: 10000,
  },

  // Configure projects for major browsers and auth states
  projects: [
    // === Setup Projects ===
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // === Browser Projects ===
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // === Mobile Projects ===
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 12'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // === Admin Projects (different auth) ===
    {
      name: 'admin-chromium',
      testMatch: /.*admin.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['setup'],
    },

    // === Unauthenticated Projects ===
    {
      name: 'unauthenticated',
      testMatch: /.*public.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // No storageState - runs without authentication
      },
    },
  ],

  // Run local dev server before starting tests
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  // Global setup and teardown
  // globalSetup: require.resolve('./global-setup'),
  // globalTeardown: require.resolve('./global-teardown'),

  // Output folder for test artifacts
  outputDir: 'test-results/',
});
