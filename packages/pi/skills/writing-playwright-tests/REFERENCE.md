---
name: writing-playwright-tests-reference
description: Advanced patterns for writing Playwright tests including authentication fixtures, network mocking, visual regression, debugging, and legacy application retrofitting strategies.
---

# Playwright Reference

## 1. Authentication Fixtures

### Setup Project for Auth State

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [
    // Setup project runs first, creates auth state
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Dependent projects use the auth state
    {
      name: 'chromium',
      use: {
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

### Auth Setup File

```typescript
// tests/auth.setup.ts
import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Navigate to login
  await page.goto('/login');

  // Perform login
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard');

  // Verify login succeeded
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Save authentication state
  await page.context().storageState({ path: authFile });
});
```

### Multiple User Roles

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup-admin', testMatch: /admin\.setup\.ts/ },
    { name: 'setup-user', testMatch: /user\.setup\.ts/ },

    {
      name: 'admin-tests',
      use: { storageState: 'playwright/.auth/admin.json' },
      dependencies: ['setup-admin'],
    },
    {
      name: 'user-tests',
      use: { storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup-user'],
    },
  ],
});

// tests/admin.setup.ts
setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminpass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin/dashboard');
  await page.context().storageState({ path: 'playwright/.auth/admin.json' });
});
```

### API-Based Authentication

```typescript
// tests/auth.setup.ts
setup('authenticate via API', async ({ request }) => {
  // Login via API
  const response = await request.post('/api/auth/login', {
    data: {
      email: 'test@example.com',
      password: 'password123',
    },
  });

  expect(response.ok()).toBeTruthy();

  // Extract token from response
  const { token } = await response.json();

  // Create storage state with token
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:3000',
        localStorage: [
          { name: 'authToken', value: token },
        ],
      },
    ],
  };

  // Save to file
  const fs = require('fs');
  fs.writeFileSync('playwright/.auth/user.json', JSON.stringify(storageState));
});
```

## 2. Network Interception

### Mocking API Responses

```typescript
test('displays mocked data', async ({ page }) => {
  // Mock API response
  await page.route('**/api/contacts', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      ]),
    });
  });

  await page.goto('/contacts');

  await expect(page.getByText('John Doe')).toBeVisible();
  await expect(page.getByText('Jane Smith')).toBeVisible();
});
```

### Conditional Mocking

```typescript
test('mocks specific request', async ({ page }) => {
  await page.route('**/api/contacts/*', async route => {
    const url = route.request().url();

    if (url.includes('/contacts/1')) {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ id: 1, name: 'Mocked User' }),
      });
    } else {
      // Let other requests through
      await route.continue();
    }
  });
});
```

### Modifying Requests

```typescript
test('adds auth header to requests', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const headers = {
      ...route.request().headers(),
      'X-Custom-Header': 'test-value',
    };
    await route.continue({ headers });
  });
});
```

### Waiting for Specific Responses

```typescript
test('waits for API before asserting', async ({ page }) => {
  // Start waiting before action triggers request
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/contacts') && resp.status() === 200
  );

  await page.goto('/contacts');

  const response = await responsePromise;
  const data = await response.json();

  expect(data.length).toBeGreaterThan(0);
});
```

### Simulating Network Errors

```typescript
test('handles network failure', async ({ page }) => {
  await page.route('**/api/contacts', route => route.abort('failed'));

  await page.goto('/contacts');

  await expect(page.getByText('Failed to load contacts')).toBeVisible();
});

test('handles slow network', async ({ page }) => {
  await page.route('**/api/contacts', async route => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    await route.continue();
  });

  await page.goto('/contacts');

  // Loading indicator should appear
  await expect(page.getByTestId('loading')).toBeVisible();
});
```

## 3. Visual Regression Testing

### Basic Screenshot Comparison

```typescript
test('matches visual snapshot', async ({ page }) => {
  await page.goto('/dashboard');

  // Wait for content to stabilize
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot('dashboard.png');
});
```

### Element Screenshots

```typescript
test('component visual test', async ({ page }) => {
  await page.goto('/components/card');

  const card = page.getByTestId('feature-card');
  await expect(card).toHaveScreenshot('feature-card.png');
});
```

### Screenshot Options

```typescript
test('visual test with options', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveScreenshot('dashboard.png', {
    // Tolerance for pixel differences
    maxDiffPixels: 100,

    // Percentage threshold
    maxDiffPixelRatio: 0.01,

    // Mask dynamic content
    mask: [
      page.getByTestId('timestamp'),
      page.getByTestId('user-avatar'),
    ],

    // Animation handling
    animations: 'disabled',

    // Full page screenshot
    fullPage: true,
  });
});
```

### Handling Dynamic Content

```typescript
test('visual test with masked areas', async ({ page }) => {
  await page.goto('/dashboard');

  // Hide dynamic elements before screenshot
  await page.evaluate(() => {
    document.querySelectorAll('[data-dynamic]').forEach(el => {
      (el as HTMLElement).style.visibility = 'hidden';
    });
  });

  // Or use CSS to hide
  await page.addStyleTag({
    content: `
      .timestamp, .avatar, .ad-banner {
        visibility: hidden !important;
      }
    `,
  });

  await expect(page).toHaveScreenshot('dashboard-stable.png');
});
```

## 4. Debugging

### Trace Viewer

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    // Record trace on first retry
    trace: 'on-first-retry',

    // Always record trace
    // trace: 'on',

    // Retain trace only on failure
    // trace: 'retain-on-failure',
  },
});
```

View traces:
```bash
npx playwright show-trace trace.zip
```

### Debug Mode

```bash
# Run with debug mode
npx playwright test --debug

# Debug specific test
npx playwright test contacts.spec.ts:25 --debug
```

### Pause in Test

```typescript
test('debug with pause', async ({ page }) => {
  await page.goto('/dashboard');

  // Pause execution, opens inspector
  await page.pause();

  await page.getByRole('button').click();
});
```

### Console Logging

```typescript
test('capture console', async ({ page }) => {
  // Listen to console messages
  page.on('console', msg => {
    console.log(`Browser console: ${msg.type()}: ${msg.text()}`);
  });

  // Listen to page errors
  page.on('pageerror', error => {
    console.error(`Page error: ${error.message}`);
  });

  await page.goto('/dashboard');
});
```

### Screenshots on Failure

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});

// Manual screenshot in test
test('debug with screenshot', async ({ page }) => {
  await page.goto('/dashboard');

  // Take screenshot at specific point
  await page.screenshot({
    path: 'debug-screenshots/before-click.png',
    fullPage: true,
  });

  await page.getByRole('button').click();
});
```

### Step Annotation

```typescript
test('documented test', async ({ page }) => {
  await test.step('Navigate to login', async () => {
    await page.goto('/login');
  });

  await test.step('Fill credentials', async () => {
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('password');
  });

  await test.step('Submit and verify', async () => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('**/dashboard');
  });
});
```

## 5. CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/playwright.yml
name: Playwright Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run Playwright tests
        run: npx playwright test

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

### Docker Configuration

```dockerfile
# Dockerfile.playwright
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["npx", "playwright", "test"]
```

### CI Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  // Fail build on console errors in CI
  use: {
    ...process.env.CI && {
      video: 'retain-on-failure',
      trace: 'retain-on-failure',
    },
  },

  // Limit workers in CI
  workers: process.env.CI ? 1 : undefined,

  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,

  // Fail fast in CI
  forbidOnly: !!process.env.CI,
});
```

### Sharding

```bash
# Run tests across multiple machines
npx playwright test --shard=1/4
npx playwright test --shard=2/4
npx playwright test --shard=3/4
npx playwright test --shard=4/4
```

```yaml
# GitHub Actions with sharding
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1/4, 2/4, 3/4, 4/4]
    steps:
      - name: Run Playwright tests
        run: npx playwright test --shard=${{ matrix.shard }}
```

## 6. Legacy App Retrofitting

### Audit Existing Selectors

```typescript
// scripts/audit-selectors.ts
// Run with: npx playwright test --config=audit.config.ts

import { test, expect } from '@playwright/test';

test('audit page selectors', async ({ page }) => {
  await page.goto('/dashboard');

  // Find all interactive elements
  const buttons = await page.getByRole('button').all();
  const links = await page.getByRole('link').all();
  const inputs = await page.getByRole('textbox').all();

  console.log('=== Selector Audit ===');

  for (const button of buttons) {
    const testId = await button.getAttribute('data-testid');
    const text = await button.textContent();
    const ariaLabel = await button.getAttribute('aria-label');

    console.log(`Button: "${text?.trim()}"
      - data-testid: ${testId || 'MISSING'}
      - aria-label: ${ariaLabel || 'MISSING'}
      - Recommendation: ${getRecommendation(testId, ariaLabel, text)}`);
  }
});

function getRecommendation(testId: string | null, ariaLabel: string | null, text: string | null): string {
  if (testId) return 'OK - has data-testid';
  if (ariaLabel) return 'OK - has aria-label';
  if (text?.trim()) return 'WARN - relies on text content';
  return 'CRITICAL - no reliable selector';
}
```

### Incremental Test ID Migration

```typescript
// Priority 1: Forms and CTAs
const CRITICAL_ELEMENTS = [
  { selector: 'form button[type="submit"]', suggestedId: '{form}-submit' },
  { selector: 'button.primary', suggestedId: '{context}-primary-action' },
  { selector: '.modal .close', suggestedId: 'modal-close' },
];

// Priority 2: Navigation
const NAVIGATION_ELEMENTS = [
  { selector: 'nav a', suggestedId: 'nav-{page}' },
  { selector: '.sidebar a', suggestedId: 'sidebar-{section}' },
];

// Priority 3: Data display
const DATA_ELEMENTS = [
  { selector: 'table tbody tr', suggestedId: '{table}-row-{id}' },
  { selector: '.card', suggestedId: '{section}-card-{id}' },
];
```

### Fallback Selector Strategy

```typescript
// utils/resilient-selectors.ts
import { Page, Locator } from '@playwright/test';

export function getElement(page: Page, options: {
  testId?: string;
  role?: string;
  name?: string;
  text?: string;
  css?: string;  // Last resort
}): Locator {
  // Try in order of preference
  if (options.testId) {
    return page.getByTestId(options.testId);
  }

  if (options.role && options.name) {
    return page.getByRole(options.role as any, { name: options.name });
  }

  if (options.text) {
    return page.getByText(options.text);
  }

  if (options.css) {
    console.warn(`Using CSS selector as fallback: ${options.css}`);
    return page.locator(options.css);
  }

  throw new Error('No valid selector provided');
}

// Usage
const submitBtn = getElement(page, {
  testId: 'contact-form-submit',      // Will use if exists
  role: 'button',
  name: 'Submit',                      // Fallback
  css: '.btn-primary[type="submit"]', // Last resort
});
```

### Wait Strategy for Legacy SPAs

```typescript
// utils/legacy-waits.ts
export async function waitForPageReady(page: Page) {
  // Wait for common loading indicators to disappear
  const loadingSelectors = [
    '.loading',
    '.spinner',
    '[data-loading="true"]',
    '.skeleton',
  ];

  for (const selector of loadingSelectors) {
    const loading = page.locator(selector);
    if (await loading.count() > 0) {
      await expect(loading.first()).toBeHidden({ timeout: 30000 });
    }
  }

  // Wait for network to settle
  await page.waitForLoadState('networkidle');

  // Additional stability wait for JS frameworks
  await page.waitForFunction(() => {
    // Check for React
    if ((window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      return document.readyState === 'complete';
    }
    // Check for Angular
    if ((window as any).getAllAngularTestabilities) {
      return (window as any).getAllAngularTestabilities()
        .every((t: any) => t.isStable());
    }
    return true;
  });
}
```

### Handling jQuery/Legacy AJAX

```typescript
test('waits for jQuery AJAX', async ({ page }) => {
  await page.goto('/legacy-page');

  // Wait for jQuery AJAX to complete
  await page.waitForFunction(() => {
    return (window as any).jQuery?.active === 0;
  });

  // Now safe to interact
  await expect(page.getByTestId('data-table')).toBeVisible();
});
```

## 7. Fixtures and Hooks

### Custom Fixtures

```typescript
// fixtures/test.ts
import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

type MyFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  testUser: { email: string; password: string };
};

export const test = base.extend<MyFixtures>({
  testUser: async ({}, use) => {
    await use({
      email: 'test@example.com',
      password: 'password123',
    });
  },

  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    await use(dashboardPage);
  },
});

export { expect } from '@playwright/test';
```

### Database Fixtures

```typescript
// fixtures/database.ts
import { test as base } from '@playwright/test';

export const test = base.extend({
  // Clean database before each test
  autoClean: [async ({}, use) => {
    // Setup: Clean before test
    await resetDatabase();

    await use();

    // Teardown: Clean after test
    await resetDatabase();
  }, { auto: true }],

  // Seed specific data
  seededData: async ({}, use) => {
    const data = await seedTestData();
    await use(data);
    await cleanupTestData(data.ids);
  },
});

async function resetDatabase() {
  // Call API or direct DB connection
  await fetch('http://localhost:3000/api/test/reset', {
    method: 'POST',
  });
}
```

### Worker-Scoped Fixtures

```typescript
// fixtures/worker.ts
import { test as base } from '@playwright/test';

export const test = base.extend<{}, { apiToken: string }>({
  // Shared across all tests in worker
  apiToken: [async ({}, use) => {
    // Create once per worker
    const response = await fetch('/api/auth/token', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'test' }),
    });
    const { token } = await response.json();

    await use(token);

    // Cleanup after worker done
    await fetch('/api/auth/revoke', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }, { scope: 'worker' }],
});
```

## 8. Advanced Patterns

### Parallel Test Isolation

```typescript
// Ensure tests don't interfere with each other
test.describe.configure({ mode: 'parallel' });

test.describe('isolated tests', () => {
  test('test 1', async ({ page }) => {
    // Uses unique data/context
  });

  test('test 2', async ({ page }) => {
    // Runs in parallel, isolated
  });
});

// Serial execution when needed
test.describe.configure({ mode: 'serial' });
```

### Retry with Different Strategy

```typescript
test('retry with backoff', async ({ page }) => {
  test.info().annotations.push({
    type: 'retry-strategy',
    description: 'exponential-backoff',
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto('/flaky-page');
      await expect(page.getByTestId('content')).toBeVisible();
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(Math.pow(2, attempt) * 1000);
    }
  }
});
```

### Test Tags and Filtering

```typescript
// Tag tests
test('smoke test @smoke', async ({ page }) => {});
test('regression test @regression', async ({ page }) => {});
test('slow test @slow', async ({ page }) => {});
```

```bash
# Run only smoke tests
npx playwright test --grep @smoke

# Exclude slow tests
npx playwright test --grep-invert @slow
```

---

**See SKILL.md for**: Basic selectors, page objects, common interactions, and quick reference commands.
