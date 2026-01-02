/**
 * API Mock Utilities Template
 *
 * Reusable patterns for mocking API responses in tests.
 *
 * Usage:
 *   import { mockApi, mockApiError } from '../utils/api-mock';
 *   await mockApi(page, '/api/users', mockUsers);
 */

import { Page, Route } from '@playwright/test';

/**
 * Mock API response with data
 */
export async function mockApi(
  page: Page,
  urlPattern: string,
  data: any,
  options: MockOptions = {}
) {
  const { status = 200, delay = 0, headers = {} } = options;

  await page.route(`**${urlPattern}`, async (route: Route) => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': '*',
        ...headers,
      },
      body: JSON.stringify(data),
    });
  });
}

/**
 * Mock API error response
 */
export async function mockApiError(
  page: Page,
  urlPattern: string,
  error: ApiError
) {
  await page.route(`**${urlPattern}`, async (route: Route) => {
    await route.fulfill({
      status: error.status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: error.code,
        message: error.message,
        details: error.details,
      }),
    });
  });
}

/**
 * Mock network failure
 */
export async function mockNetworkError(
  page: Page,
  urlPattern: string,
  errorType: 'failed' | 'timedout' | 'aborted' = 'failed'
) {
  await page.route(`**${urlPattern}`, route => route.abort(errorType));
}

/**
 * Mock slow response
 */
export async function mockSlowResponse(
  page: Page,
  urlPattern: string,
  data: any,
  delayMs: number
) {
  await mockApi(page, urlPattern, data, { delay: delayMs });
}

/**
 * Mock paginated response
 */
export async function mockPaginatedApi(
  page: Page,
  urlPattern: string,
  allItems: any[],
  pageSize: number = 10
) {
  await page.route(`**${urlPattern}*`, async (route: Route) => {
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get('page') ?? '1');
    const size = parseInt(url.searchParams.get('size') ?? String(pageSize));

    const startIndex = (pageNum - 1) * size;
    const items = allItems.slice(startIndex, startIndex + size);
    const totalPages = Math.ceil(allItems.length / size);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: items,
        pagination: {
          page: pageNum,
          size,
          total: allItems.length,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrevious: pageNum > 1,
        },
      }),
    });
  });
}

/**
 * Mock conditional response based on request
 */
export async function mockConditionalApi(
  page: Page,
  urlPattern: string,
  handler: (route: Route) => Promise<any>
) {
  await page.route(`**${urlPattern}`, async (route: Route) => {
    const response = await handler(route);

    if (response === null) {
      // Let request through
      await route.continue();
    } else {
      await route.fulfill({
        status: response.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(response.data),
      });
    }
  });
}

/**
 * Intercept and modify requests
 */
export async function interceptRequest(
  page: Page,
  urlPattern: string,
  modifier: (headers: Record<string, string>) => Record<string, string>
) {
  await page.route(`**${urlPattern}`, async (route: Route) => {
    const headers = modifier(route.request().headers());
    await route.continue({ headers });
  });
}

// Types
interface MockOptions {
  status?: number;
  delay?: number;
  headers?: Record<string, string>;
}

interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: any;
}

// Common mock data factories
export const mockFactories = {
  user: (overrides = {}) => ({
    id: 1,
    email: 'user@example.com',
    name: 'Test User',
    role: 'user',
    createdAt: new Date().toISOString(),
    ...overrides,
  }),

  users: (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      email: `user${i + 1}@example.com`,
      name: `User ${i + 1}`,
      role: 'user',
    })),

  error: {
    notFound: { status: 404, code: 'NOT_FOUND', message: 'Resource not found' },
    unauthorized: { status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' },
    forbidden: { status: 403, code: 'FORBIDDEN', message: 'Access denied' },
    validation: { status: 422, code: 'VALIDATION_ERROR', message: 'Validation failed' },
    serverError: { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
  },
};

// Example usage in tests:
/*
import { mockApi, mockApiError, mockFactories } from '../utils/api-mock';

test('displays users', async ({ page }) => {
  await mockApi(page, '/api/users', mockFactories.users(5));
  await page.goto('/users');
  await expect(page.getByRole('row')).toHaveCount(6); // 5 users + header
});

test('handles not found', async ({ page }) => {
  await mockApiError(page, '/api/users/999', mockFactories.error.notFound);
  await page.goto('/users/999');
  await expect(page.getByText('Resource not found')).toBeVisible();
});
*/
