/**
 * Legacy App Conversion Example
 *
 * Demonstrates converting a legacy application (no data-testid, inconsistent selectors)
 * to automated E2E testing with Playwright.
 *
 * This example shows:
 * - Auditing existing selectors
 * - Building resilient page objects
 * - Incremental test ID migration
 * - Handling dynamic content
 */

import { test, expect, Page, Locator } from '@playwright/test';

// =============================================================================
// Step 1: Page Object for Legacy UI
// =============================================================================

/**
 * Page object that handles missing test IDs gracefully
 */
class LegacyContactsPage {
  readonly page: Page;

  // Locators with fallback strategies
  private readonly _addButton: () => Locator;
  private readonly _searchInput: () => Locator;
  private readonly _table: () => Locator;
  private readonly _rows: () => Locator;
  private readonly _loadingSpinner: () => Locator;

  constructor(page: Page) {
    this.page = page;

    // Define locators with fallback strategies
    // Priority: testId > role > text > css

    this._addButton = () => {
      // Try test ID first (if we've added it)
      const byTestId = page.getByTestId('add-contact-button');
      // Fallback to role + text
      const byRole = page.getByRole('button', { name: /add contact|new contact/i });
      // Last resort: CSS (legacy)
      const byCss = page.locator('.btn-primary.add-new, button.add-contact');

      return byTestId.or(byRole).or(byCss);
    };

    this._searchInput = () => {
      const byTestId = page.getByTestId('contacts-search');
      const byPlaceholder = page.getByPlaceholder(/search/i);
      const byCss = page.locator('input.search-input, .search-box input');

      return byTestId.or(byPlaceholder).or(byCss);
    };

    this._table = () => {
      const byTestId = page.getByTestId('contacts-table');
      const byRole = page.getByRole('table');
      const byCss = page.locator('.contacts-table, table.data-grid');

      return byTestId.or(byRole).or(byCss);
    };

    this._rows = () => {
      return this._table().locator('tbody tr');
    };

    this._loadingSpinner = () => {
      return page.locator('.loading, .spinner, [data-loading="true"]');
    };
  }

  // Getters expose locators
  get addButton() { return this._addButton(); }
  get searchInput() { return this._searchInput(); }
  get table() { return this._table(); }
  get rows() { return this._rows(); }
  get loadingSpinner() { return this._loadingSpinner(); }

  async goto() {
    await this.page.goto('/contacts');
    await this.waitForPageReady();
  }

  async waitForPageReady() {
    // Wait for any loading indicators to disappear
    await expect(this.loadingSpinner).toBeHidden({ timeout: 30000 });

    // Wait for table to have content
    await expect(this.table).toBeVisible();

    // Additional stability for legacy AJAX
    await this.page.waitForLoadState('networkidle');
  }

  async search(term: string) {
    await this.searchInput.fill(term);
    await this.searchInput.press('Enter');
    await this.waitForPageReady();
  }

  async clickAddContact() {
    await this.addButton.click();
  }

  async getRowCount(): Promise<number> {
    return await this.rows.count();
  }

  async clickRow(index: number) {
    await this.rows.nth(index).click();
  }

  async getRowText(index: number): Promise<string> {
    return await this.rows.nth(index).textContent() ?? '';
  }
}

// =============================================================================
// Step 2: Form Page Object (handles forms without proper labels)
// =============================================================================

class LegacyContactFormPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Legacy forms often have inputs without labels
  // We need creative selector strategies

  get firstNameInput() {
    return this.page.getByTestId('first-name')
      .or(this.page.getByLabel(/first name/i))
      .or(this.page.getByPlaceholder(/first name/i))
      .or(this.page.locator('input[name="firstName"], input[name="first_name"]'));
  }

  get lastNameInput() {
    return this.page.getByTestId('last-name')
      .or(this.page.getByLabel(/last name/i))
      .or(this.page.getByPlaceholder(/last name/i))
      .or(this.page.locator('input[name="lastName"], input[name="last_name"]'));
  }

  get emailInput() {
    return this.page.getByTestId('email')
      .or(this.page.getByLabel(/email/i))
      .or(this.page.getByPlaceholder(/email/i))
      .or(this.page.locator('input[type="email"], input[name="email"]'));
  }

  get companySelect() {
    // Dropdowns are tricky in legacy apps
    return this.page.getByTestId('company-select')
      .or(this.page.getByLabel(/company/i))
      .or(this.page.locator('select[name="company"], .company-dropdown select'));
  }

  get submitButton() {
    return this.page.getByTestId('submit-contact')
      .or(this.page.getByRole('button', { name: /save|submit|create/i }))
      .or(this.page.locator('button[type="submit"], .btn-submit'));
  }

  get cancelButton() {
    return this.page.getByRole('button', { name: /cancel/i })
      .or(this.page.locator('.btn-cancel, button.cancel'));
  }

  // Validation errors (often inconsistent in legacy apps)
  getFieldError(fieldName: string) {
    // Try multiple patterns legacy apps use for errors
    return this.page.locator([
      `[data-error-for="${fieldName}"]`,
      `.${fieldName}-error`,
      `#${fieldName}-error`,
      `.field-error:near(input[name="${fieldName}"])`,
    ].join(', ')).first();
  }

  async fill(data: ContactFormData) {
    await this.firstNameInput.fill(data.firstName);
    await this.lastNameInput.fill(data.lastName);
    await this.emailInput.fill(data.email);

    if (data.company) {
      await this.companySelect.selectOption(data.company);
    }
  }

  async submit() {
    await this.submitButton.click();
  }
}

interface ContactFormData {
  firstName: string;
  lastName: string;
  email: string;
  company?: string;
}

// =============================================================================
// Step 3: Tests Using Legacy Page Objects
// =============================================================================

test.describe('Contacts - Legacy App', () => {
  let contactsPage: LegacyContactsPage;
  let formPage: LegacyContactFormPage;

  test.beforeEach(async ({ page }) => {
    contactsPage = new LegacyContactsPage(page);
    formPage = new LegacyContactFormPage(page);
    await contactsPage.goto();
  });

  test('displays contacts list', async ({ page }) => {
    // Simply verify the table has content
    const rowCount = await contactsPage.getRowCount();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('searches contacts', async ({ page }) => {
    const initialCount = await contactsPage.getRowCount();

    await contactsPage.search('John');

    const filteredCount = await contactsPage.getRowCount();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Verify all visible rows contain search term
    const rows = await contactsPage.rows.all();
    for (const row of rows) {
      const text = await row.textContent();
      expect(text?.toLowerCase()).toContain('john');
    }
  });

  test('creates new contact', async ({ page }) => {
    await contactsPage.clickAddContact();

    // Wait for form modal/page
    await expect(formPage.firstNameInput).toBeVisible();

    // Fill form
    await formPage.fill({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
    });

    await formPage.submit();

    // Wait for redirect back to list
    await contactsPage.waitForPageReady();

    // Verify contact was added
    await contactsPage.search('test@example.com');
    await expect(contactsPage.rows).toHaveCount(1);
  });

  test('validates required fields', async ({ page }) => {
    await contactsPage.clickAddContact();

    // Submit empty form
    await formPage.submit();

    // Check for validation errors (varies by legacy app)
    const errorVisible = await page.locator('.error, .validation-error, [role="alert"]')
      .first()
      .isVisible();

    expect(errorVisible).toBeTruthy();
  });
});

// =============================================================================
// Step 4: Selector Audit Script
// =============================================================================

test('audit page selectors @audit', async ({ page }) => {
  await page.goto('/contacts');

  console.log('\n=== SELECTOR AUDIT REPORT ===\n');

  // Audit buttons
  const buttons = await page.getByRole('button').all();
  console.log(`Buttons found: ${buttons.length}`);

  for (const button of buttons) {
    const testId = await button.getAttribute('data-testid');
    const text = await button.textContent();
    const ariaLabel = await button.getAttribute('aria-label');

    if (!testId) {
      console.log(`  [NEEDS TESTID] Button: "${text?.trim().substring(0, 30)}"`);
      console.log(`    Suggested: data-testid="${suggestTestId(text ?? 'button')}"`);
    }
  }

  // Audit inputs
  const inputs = await page.locator('input, select, textarea').all();
  console.log(`\nForm inputs found: ${inputs.length}`);

  for (const input of inputs) {
    const testId = await input.getAttribute('data-testid');
    const name = await input.getAttribute('name');
    const id = await input.getAttribute('id');
    const placeholder = await input.getAttribute('placeholder');

    if (!testId) {
      console.log(`  [NEEDS TESTID] Input: name="${name}" id="${id}"`);
      console.log(`    Suggested: data-testid="${name || id || 'input'}"`);
    }
  }

  console.log('\n=== END AUDIT ===\n');
});

function suggestTestId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 30);
}

// =============================================================================
// Step 5: Migration Checklist
// =============================================================================

/*
LEGACY APP MIGRATION CHECKLIST:

1. AUDIT PHASE
   - [ ] Run audit test to identify elements needing test IDs
   - [ ] Prioritize: forms > CTAs > navigation > display elements
   - [ ] Document current selector strategies in use

2. PAGE OBJECT PHASE
   - [ ] Create page objects with fallback selectors
   - [ ] Use .or() chaining for resilience
   - [ ] Add explicit waits for legacy AJAX

3. INCREMENTAL TESTID PHASE
   - [ ] Add data-testid to high-priority elements
   - [ ] Update page objects to prefer testId
   - [ ] Keep fallbacks for backward compatibility

4. TEST STABILIZATION
   - [ ] Add network idle waits
   - [ ] Handle jQuery/Angular loading states
   - [ ] Use retry logic for flaky interactions

5. CI INTEGRATION
   - [ ] Configure retries (2-3 for legacy apps)
   - [ ] Enable trace on failure
   - [ ] Set appropriate timeouts
*/
