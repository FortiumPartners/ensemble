/**
 * Form Validation Testing Example
 *
 * Demonstrates comprehensive form testing including:
 * - Field validation
 * - Error message verification
 * - Form submission flows
 * - Dynamic form behavior
 */

import { test, expect, Page, Locator } from '@playwright/test';

// =============================================================================
// Page Object: Registration Form
// =============================================================================

class RegistrationFormPage {
  readonly page: Page;

  // Form fields
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly termsCheckbox: Locator;
  readonly marketingCheckbox: Locator;
  readonly countrySelect: Locator;

  // Buttons
  readonly submitButton: Locator;
  readonly resetButton: Locator;

  // Feedback elements
  readonly successMessage: Locator;
  readonly errorSummary: Locator;

  constructor(page: Page) {
    this.page = page;

    // Field locators
    this.firstNameInput = page.getByLabel('First name');
    this.lastNameInput = page.getByLabel('Last name');
    this.emailInput = page.getByLabel('Email address');
    this.passwordInput = page.getByLabel('Password', { exact: true });
    this.confirmPasswordInput = page.getByLabel('Confirm password');
    this.termsCheckbox = page.getByLabel(/accept.*terms/i);
    this.marketingCheckbox = page.getByLabel(/marketing/i);
    this.countrySelect = page.getByLabel('Country');

    // Buttons
    this.submitButton = page.getByRole('button', { name: 'Create account' });
    this.resetButton = page.getByRole('button', { name: 'Reset' });

    // Feedback
    this.successMessage = page.getByTestId('registration-success');
    this.errorSummary = page.getByRole('alert');
  }

  async goto() {
    await this.page.goto('/register');
  }

  // Get inline error for a field
  getFieldError(fieldLabel: string): Locator {
    // Common patterns for field errors
    return this.page.locator([
      `[data-error-for="${fieldLabel.toLowerCase().replace(/\s/g, '-')}"]`,
      `.field-group:has-text("${fieldLabel}") .error-message`,
    ].join(', ')).first();
  }

  // Fill entire form
  async fillForm(data: RegistrationData) {
    await this.firstNameInput.fill(data.firstName);
    await this.lastNameInput.fill(data.lastName);
    await this.emailInput.fill(data.email);
    await this.passwordInput.fill(data.password);
    await this.confirmPasswordInput.fill(data.confirmPassword);

    if (data.country) {
      await this.countrySelect.selectOption(data.country);
    }

    if (data.acceptTerms) {
      await this.termsCheckbox.check();
    }

    if (data.acceptMarketing) {
      await this.marketingCheckbox.check();
    }
  }

  async submit() {
    await this.submitButton.click();
  }

  async reset() {
    await this.resetButton.click();
  }

  // Check password strength indicator
  async getPasswordStrength(): Promise<string> {
    const indicator = this.page.getByTestId('password-strength');
    return await indicator.textContent() ?? '';
  }
}

interface RegistrationData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  country?: string;
  acceptTerms?: boolean;
  acceptMarketing?: boolean;
}

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Registration Form', () => {
  let formPage: RegistrationFormPage;

  test.beforeEach(async ({ page }) => {
    formPage = new RegistrationFormPage(page);
    await formPage.goto();
  });

  test.describe('Field Validation', () => {
    test('validates required first name', async () => {
      await formPage.lastNameInput.fill('Doe');
      await formPage.emailInput.fill('john@example.com');
      await formPage.submit();

      await expect(formPage.getFieldError('First name')).toContainText(/required/i);
    });

    test('validates email format', async () => {
      await formPage.emailInput.fill('invalid-email');
      await formPage.emailInput.blur();

      await expect(formPage.getFieldError('Email')).toContainText(/valid email/i);
    });

    test('validates email uniqueness', async ({ page }) => {
      // Mock API to return email already exists
      await page.route('**/api/check-email*', route =>
        route.fulfill({
          status: 200,
          body: JSON.stringify({ exists: true }),
        })
      );

      await formPage.emailInput.fill('existing@example.com');
      await formPage.emailInput.blur();

      await expect(formPage.getFieldError('Email')).toContainText(/already registered/i);
    });

    test('validates password requirements', async () => {
      await formPage.passwordInput.fill('weak');
      await formPage.passwordInput.blur();

      await expect(formPage.getFieldError('Password')).toContainText(/at least 8 characters/i);
    });

    test('validates password confirmation match', async () => {
      await formPage.passwordInput.fill('StrongPass123!');
      await formPage.confirmPasswordInput.fill('DifferentPass123!');
      await formPage.confirmPasswordInput.blur();

      await expect(formPage.getFieldError('Confirm password')).toContainText(/must match/i);
    });

    test('validates terms acceptance', async () => {
      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        acceptTerms: false,
      });

      await formPage.submit();

      await expect(formPage.errorSummary).toContainText(/accept.*terms/i);
    });
  });

  test.describe('Dynamic Behavior', () => {
    test('shows password strength indicator', async () => {
      await formPage.passwordInput.fill('weak');
      await expect(formPage.page.getByTestId('password-strength')).toHaveText('Weak');

      await formPage.passwordInput.fill('Medium123');
      await expect(formPage.page.getByTestId('password-strength')).toHaveText('Medium');

      await formPage.passwordInput.fill('VeryStr0ng!Pass#2024');
      await expect(formPage.page.getByTestId('password-strength')).toHaveText('Strong');
    });

    test('enables submit when form is valid', async () => {
      // Initially disabled
      await expect(formPage.submitButton).toBeDisabled();

      // Fill valid data
      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        acceptTerms: true,
      });

      // Now enabled
      await expect(formPage.submitButton).toBeEnabled();
    });

    test('clears errors on valid input', async () => {
      // Trigger error
      await formPage.emailInput.fill('invalid');
      await formPage.emailInput.blur();
      await expect(formPage.getFieldError('Email')).toBeVisible();

      // Fix input
      await formPage.emailInput.fill('valid@example.com');
      await formPage.emailInput.blur();
      await expect(formPage.getFieldError('Email')).toBeHidden();
    });
  });

  test.describe('Form Submission', () => {
    test('submits valid form successfully', async ({ page }) => {
      // Mock successful registration
      await page.route('**/api/register', route =>
        route.fulfill({
          status: 201,
          body: JSON.stringify({ id: 1, email: 'john@example.com' }),
        })
      );

      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        country: 'US',
        acceptTerms: true,
      });

      await formPage.submit();

      await expect(formPage.successMessage).toBeVisible();
      await expect(formPage.successMessage).toContainText(/account created/i);
    });

    test('handles server error gracefully', async ({ page }) => {
      await page.route('**/api/register', route =>
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' }),
        })
      );

      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        acceptTerms: true,
      });

      await formPage.submit();

      await expect(formPage.errorSummary).toContainText(/try again/i);
    });

    test('handles network error', async ({ page }) => {
      await page.route('**/api/register', route => route.abort('failed'));

      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        acceptTerms: true,
      });

      await formPage.submit();

      await expect(formPage.errorSummary).toContainText(/connection|network/i);
    });

    test('prevents double submission', async ({ page }) => {
      let submissionCount = 0;

      await page.route('**/api/register', async route => {
        submissionCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({ status: 201, body: '{}' });
      });

      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        acceptTerms: true,
      });

      // Click multiple times quickly
      await formPage.submitButton.click();
      await formPage.submitButton.click();
      await formPage.submitButton.click();

      // Wait for request to complete
      await page.waitForResponse('**/api/register');

      // Should only have submitted once
      expect(submissionCount).toBe(1);
    });
  });

  test.describe('Reset Functionality', () => {
    test('clears all fields on reset', async () => {
      await formPage.fillForm({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        acceptTerms: true,
      });

      await formPage.reset();

      await expect(formPage.firstNameInput).toHaveValue('');
      await expect(formPage.lastNameInput).toHaveValue('');
      await expect(formPage.emailInput).toHaveValue('');
      await expect(formPage.passwordInput).toHaveValue('');
      await expect(formPage.termsCheckbox).not.toBeChecked();
    });

    test('clears validation errors on reset', async () => {
      // Trigger errors
      await formPage.submit();
      await expect(formPage.errorSummary).toBeVisible();

      // Reset
      await formPage.reset();
      await expect(formPage.errorSummary).toBeHidden();
    });
  });
});
