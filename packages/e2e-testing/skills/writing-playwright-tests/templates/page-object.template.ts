/**
 * Page Object Template
 *
 * Represents: {{PAGE_NAME}} page
 * URL: {{PAGE_URL}}
 *
 * Usage:
 *   const page = new {{CLASS_NAME}}(page);
 *   await page.goto();
 *   await page.{{PRIMARY_ACTION}}();
 */

import { Page, Locator, expect } from '@playwright/test';

export class {{CLASS_NAME}} {
  readonly page: Page;

  // Locators - define once, reuse everywhere
  readonly heading: Locator;
  readonly primaryButton: Locator;
  readonly secondaryButton: Locator;
  readonly loadingIndicator: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // BEST: Use data-testid when available
    this.heading = page.getByRole('heading', { level: 1 });
    this.primaryButton = page.getByRole('button', { name: '{{PRIMARY_BUTTON_TEXT}}' });
    this.secondaryButton = page.getByRole('button', { name: '{{SECONDARY_BUTTON_TEXT}}' });
    this.loadingIndicator = page.getByTestId('loading');
    this.errorMessage = page.getByRole('alert');
    this.successMessage = page.getByTestId('success-message');
  }

  // Navigation
  async goto() {
    await this.page.goto('{{PAGE_URL}}');
    await this.waitForPageLoad();
  }

  // Wait for page to be ready
  async waitForPageLoad() {
    await expect(this.heading).toBeVisible();
    await expect(this.loadingIndicator).toBeHidden();
  }

  // Primary action
  async {{PRIMARY_ACTION}}() {
    await this.primaryButton.click();
    // Add wait for expected outcome
  }

  // Secondary action
  async {{SECONDARY_ACTION}}() {
    await this.secondaryButton.click();
  }

  // Assertions
  async expectSuccess(message?: string) {
    await expect(this.successMessage).toBeVisible();
    if (message) {
      await expect(this.successMessage).toContainText(message);
    }
  }

  async expectError(message?: string) {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  // State checks
  async isLoading(): Promise<boolean> {
    return await this.loadingIndicator.isVisible();
  }
}
