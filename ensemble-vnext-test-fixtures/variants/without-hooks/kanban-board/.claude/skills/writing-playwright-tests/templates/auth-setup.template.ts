/**
 * Authentication Setup Template
 *
 * Creates reusable authentication state for tests.
 * Run as a setup project before other tests.
 *
 * Config in playwright.config.ts:
 *   projects: [
 *     { name: 'setup', testMatch: /.*\.setup\.ts/ },
 *     { name: 'chromium', dependencies: ['setup'], use: { storageState: 'playwright/.auth/user.json' } },
 *   ]
 */

import { test as setup, expect } from '@playwright/test';

// Auth state file paths
const USER_AUTH_FILE = 'playwright/.auth/user.json';
const ADMIN_AUTH_FILE = 'playwright/.auth/admin.json';

/**
 * Standard user authentication
 */
setup('authenticate as user', async ({ page }) => {
  // Navigate to login page
  await page.goto('/login');

  // Fill credentials
  await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL ?? 'user@example.com');
  await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD ?? 'password123');

  // Submit login form
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for successful login redirect
  await page.waitForURL('**/dashboard');

  // Verify login succeeded
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Save authentication state
  await page.context().storageState({ path: USER_AUTH_FILE });
});

/**
 * Admin user authentication
 */
setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill(process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com');
  await page.getByLabel('Password').fill(process.env.TEST_ADMIN_PASSWORD ?? 'adminpass');

  await page.getByRole('button', { name: 'Sign in' }).click();

  // Admin may have different landing page
  await page.waitForURL('**/admin/**');

  await expect(page.getByRole('heading')).toBeVisible();

  await page.context().storageState({ path: ADMIN_AUTH_FILE });
});

/**
 * API-based authentication (for faster setup)
 */
setup('authenticate via API', async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    data: {
      email: process.env.TEST_USER_EMAIL ?? 'user@example.com',
      password: process.env.TEST_USER_PASSWORD ?? 'password123',
    },
  });

  expect(response.ok()).toBeTruthy();

  const { token, refreshToken } = await response.json();

  // Create storage state with tokens
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: process.env.BASE_URL ?? 'http://localhost:3000',
        localStorage: [
          { name: 'accessToken', value: token },
          { name: 'refreshToken', value: refreshToken },
        ],
      },
    ],
  };

  // Write to file
  const fs = await import('fs');
  fs.writeFileSync(USER_AUTH_FILE, JSON.stringify(storageState, null, 2));
});
