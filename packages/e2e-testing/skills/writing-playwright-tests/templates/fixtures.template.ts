/**
 * Custom Fixtures Template
 *
 * Extends Playwright test with reusable page objects and utilities.
 *
 * Usage:
 *   import { test, expect } from './fixtures';
 *   test('my test', async ({ loginPage, dashboardPage }) => { ... });
 */

import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
// import { {{PAGE_CLASS}} } from '../pages/{{PAGE_FILE}}';

// Define fixture types
type PageFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  // {{PAGE_FIXTURE}}: {{PAGE_CLASS}};
};

type DataFixtures = {
  testUser: TestUser;
  testData: TestData;
};

type UtilityFixtures = {
  apiClient: ApiClient;
};

interface TestUser {
  email: string;
  password: string;
  name: string;
}

interface TestData {
  id: string;
  // Add test data fields
}

interface ApiClient {
  get: (path: string) => Promise<any>;
  post: (path: string, data: any) => Promise<any>;
}

// Extend base test with fixtures
export const test = base.extend<PageFixtures & DataFixtures & UtilityFixtures>({
  // Page Object fixtures
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    await use(dashboardPage);
  },

  // Test data fixtures
  testUser: async ({}, use) => {
    await use({
      email: process.env.TEST_USER_EMAIL ?? 'test@example.com',
      password: process.env.TEST_USER_PASSWORD ?? 'password123',
      name: 'Test User',
    });
  },

  testData: async ({ request }, use) => {
    // Create test data before test
    const response = await request.post('/api/test/seed', {
      data: { type: 'standard' },
    });
    const data = await response.json();

    await use(data);

    // Cleanup after test
    await request.delete(`/api/test/cleanup/${data.id}`);
  },

  // API client fixture
  apiClient: async ({ request }, use) => {
    const client: ApiClient = {
      get: async (path: string) => {
        const response = await request.get(path);
        return response.json();
      },
      post: async (path: string, data: any) => {
        const response = await request.post(path, { data });
        return response.json();
      },
    };
    await use(client);
  },
});

// Worker-scoped fixtures (shared across tests in same worker)
export const workerTest = base.extend<{}, { workerToken: string }>({
  workerToken: [async ({}, use) => {
    // Create once per worker
    const token = `worker-${Date.now()}`;
    await use(token);
  }, { scope: 'worker' }],
});

// Re-export expect for convenience
export { expect };
