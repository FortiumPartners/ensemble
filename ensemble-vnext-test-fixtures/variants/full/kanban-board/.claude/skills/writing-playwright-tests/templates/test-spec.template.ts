/**
 * Test Spec Template
 *
 * Feature: {{FEATURE_NAME}}
 * Page: {{PAGE_NAME}}
 */

import { test, expect } from '@playwright/test';
import { {{PAGE_CLASS}} } from '../pages/{{PAGE_FILE}}';

// Use authenticated state if needed
// test.use({ storageState: 'playwright/.auth/user.json' });

test.describe('{{FEATURE_NAME}}', () => {
  let pageObject: {{PAGE_CLASS}};

  test.beforeEach(async ({ page }) => {
    pageObject = new {{PAGE_CLASS}}(page);
    await pageObject.goto();
  });

  test('displays page correctly', async ({ page }) => {
    await expect(pageObject.heading).toBeVisible();
    await expect(pageObject.heading).toHaveText('{{EXPECTED_HEADING}}');
  });

  test('performs primary action', async ({ page }) => {
    await pageObject.{{PRIMARY_ACTION}}();

    // Assert expected outcome
    await expect(page).toHaveURL(/{{EXPECTED_URL_PATTERN}}/);
    // OR
    await pageObject.expectSuccess('{{SUCCESS_MESSAGE}}');
  });

  test('handles error state', async ({ page }) => {
    // Setup error condition
    // e.g., submit invalid data

    await pageObject.expectError('{{ERROR_MESSAGE}}');
  });

  test('validates form inputs', async ({ page }) => {
    // Clear required field
    await page.getByLabel('{{REQUIRED_FIELD}}').clear();
    await pageObject.primaryButton.click();

    // Check validation message
    await expect(page.getByText('{{VALIDATION_MESSAGE}}')).toBeVisible();
  });
});

test.describe('{{FEATURE_NAME}} - Edge Cases', () => {
  test('handles empty state', async ({ page }) => {
    // Mock empty response
    await page.route('**/api/{{RESOURCE}}', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    );

    await page.goto('{{PAGE_URL}}');

    await expect(page.getByText('{{EMPTY_STATE_MESSAGE}}')).toBeVisible();
  });

  test('handles network error', async ({ page }) => {
    await page.route('**/api/{{RESOURCE}}', route => route.abort('failed'));

    await page.goto('{{PAGE_URL}}');

    await expect(page.getByText('{{NETWORK_ERROR_MESSAGE}}')).toBeVisible();
  });
});
