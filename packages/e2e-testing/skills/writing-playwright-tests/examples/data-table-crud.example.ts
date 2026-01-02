/**
 * Data Table CRUD Operations Example
 *
 * Demonstrates testing CRUD operations on a data table including:
 * - Listing with pagination
 * - Searching and filtering
 * - Create, Read, Update, Delete
 * - Bulk operations
 * - Sorting
 */

import { test, expect, Page, Locator } from '@playwright/test';

// =============================================================================
// Components
// =============================================================================

class DataTable {
  readonly page: Page;
  readonly container: Locator;
  readonly headers: Locator;
  readonly rows: Locator;
  readonly searchInput: Locator;
  readonly filterDropdown: Locator;
  readonly selectAllCheckbox: Locator;
  readonly bulkActionsButton: Locator;
  readonly emptyState: Locator;
  readonly loadingState: Locator;

  constructor(page: Page, containerSelector: string = '[data-testid="data-table"]') {
    this.page = page;
    this.container = page.locator(containerSelector);
    this.headers = this.container.locator('thead th');
    this.rows = this.container.locator('tbody tr');
    this.searchInput = page.getByPlaceholder(/search/i);
    this.filterDropdown = page.getByLabel('Filter by status');
    this.selectAllCheckbox = this.container.getByLabel('Select all');
    this.bulkActionsButton = page.getByRole('button', { name: 'Bulk actions' });
    this.emptyState = this.container.getByTestId('empty-state');
    this.loadingState = this.container.getByTestId('loading');
  }

  async waitForLoad() {
    await expect(this.loadingState).toBeHidden();
  }

  async getRowCount(): Promise<number> {
    await this.waitForLoad();
    return await this.rows.count();
  }

  getRow(index: number): Locator {
    return this.rows.nth(index);
  }

  getCellInRow(rowIndex: number, columnIndex: number): Locator {
    return this.rows.nth(rowIndex).locator('td').nth(columnIndex);
  }

  async getCellText(rowIndex: number, columnIndex: number): Promise<string> {
    return await this.getCellInRow(rowIndex, columnIndex).textContent() ?? '';
  }

  async sortBy(columnName: string) {
    await this.container.getByRole('columnheader', { name: columnName }).click();
    await this.waitForLoad();
  }

  async search(term: string) {
    await this.searchInput.fill(term);
    await this.searchInput.press('Enter');
    await this.waitForLoad();
  }

  async filter(status: string) {
    await this.filterDropdown.selectOption(status);
    await this.waitForLoad();
  }

  async selectRow(index: number) {
    await this.rows.nth(index).getByRole('checkbox').check();
  }

  async selectAll() {
    await this.selectAllCheckbox.check();
  }

  async clickRowAction(rowIndex: number, actionName: string) {
    const row = this.rows.nth(rowIndex);
    await row.getByRole('button', { name: actionName }).click();
  }

  async clickBulkAction(actionName: string) {
    await this.bulkActionsButton.click();
    await this.page.getByRole('menuitem', { name: actionName }).click();
  }
}

class Pagination {
  readonly page: Page;
  readonly container: Locator;

  constructor(page: Page) {
    this.page = page;
    this.container = page.getByTestId('pagination');
  }

  get prevButton() {
    return this.container.getByRole('button', { name: 'Previous' });
  }

  get nextButton() {
    return this.container.getByRole('button', { name: 'Next' });
  }

  get pageInfo() {
    return this.container.getByTestId('page-info');
  }

  async goToPage(pageNumber: number) {
    await this.container.getByRole('button', { name: String(pageNumber) }).click();
  }

  async getCurrentPage(): Promise<number> {
    const text = await this.pageInfo.textContent() ?? '';
    const match = text.match(/Page (\d+)/);
    return match ? parseInt(match[1]) : 1;
  }
}

class ItemModal {
  readonly page: Page;
  readonly dialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog');
  }

  get nameInput() {
    return this.dialog.getByLabel('Name');
  }

  get emailInput() {
    return this.dialog.getByLabel('Email');
  }

  get statusSelect() {
    return this.dialog.getByLabel('Status');
  }

  get saveButton() {
    return this.dialog.getByRole('button', { name: /save/i });
  }

  get cancelButton() {
    return this.dialog.getByRole('button', { name: /cancel/i });
  }

  get deleteButton() {
    return this.dialog.getByRole('button', { name: /delete/i });
  }

  async waitForOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async waitForClose() {
    await expect(this.dialog).toBeHidden();
  }

  async fill(data: { name: string; email: string; status?: string }) {
    await this.nameInput.fill(data.name);
    await this.emailInput.fill(data.email);
    if (data.status) {
      await this.statusSelect.selectOption(data.status);
    }
  }

  async save() {
    await this.saveButton.click();
    await this.waitForClose();
  }

  async cancel() {
    await this.cancelButton.click();
    await this.waitForClose();
  }
}

// =============================================================================
// Test Suite
// =============================================================================

test.describe('User Management Table', () => {
  let table: DataTable;
  let pagination: Pagination;
  let modal: ItemModal;

  test.beforeEach(async ({ page }) => {
    table = new DataTable(page);
    pagination = new Pagination(page);
    modal = new ItemModal(page);

    await page.goto('/admin/users');
    await table.waitForLoad();
  });

  test.describe('List Display', () => {
    test('displays users in table', async () => {
      const rowCount = await table.getRowCount();
      expect(rowCount).toBeGreaterThan(0);
    });

    test('shows correct columns', async () => {
      await expect(table.headers.nth(1)).toHaveText('Name');
      await expect(table.headers.nth(2)).toHaveText('Email');
      await expect(table.headers.nth(3)).toHaveText('Status');
      await expect(table.headers.nth(4)).toHaveText('Actions');
    });

    test('shows empty state when no data', async ({ page }) => {
      // Mock empty response
      await page.route('**/api/users*', route =>
        route.fulfill({
          status: 200,
          body: JSON.stringify({ data: [], total: 0 }),
        })
      );

      await page.reload();

      await expect(table.emptyState).toBeVisible();
      await expect(table.emptyState).toContainText('No users found');
    });
  });

  test.describe('Pagination', () => {
    test('navigates to next page', async () => {
      const firstPageFirstRow = await table.getCellText(0, 1);

      await pagination.nextButton.click();
      await table.waitForLoad();

      const secondPageFirstRow = await table.getCellText(0, 1);
      expect(secondPageFirstRow).not.toBe(firstPageFirstRow);
    });

    test('navigates to specific page', async () => {
      await pagination.goToPage(3);
      await table.waitForLoad();

      const currentPage = await pagination.getCurrentPage();
      expect(currentPage).toBe(3);
    });

    test('disables previous on first page', async () => {
      await expect(pagination.prevButton).toBeDisabled();
    });
  });

  test.describe('Sorting', () => {
    test('sorts by name ascending', async () => {
      await table.sortBy('Name');

      const firstRowName = await table.getCellText(0, 1);
      const secondRowName = await table.getCellText(1, 1);

      expect(firstRowName.localeCompare(secondRowName)).toBeLessThanOrEqual(0);
    });

    test('toggles sort direction on second click', async () => {
      await table.sortBy('Name');
      const ascFirstRow = await table.getCellText(0, 1);

      await table.sortBy('Name');
      const descFirstRow = await table.getCellText(0, 1);

      expect(descFirstRow).not.toBe(ascFirstRow);
    });
  });

  test.describe('Search & Filter', () => {
    test('filters by search term', async () => {
      const initialCount = await table.getRowCount();

      await table.search('John');

      const filteredCount = await table.getRowCount();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);

      // All results should contain search term
      for (let i = 0; i < filteredCount; i++) {
        const rowText = await table.getRow(i).textContent();
        expect(rowText?.toLowerCase()).toContain('john');
      }
    });

    test('filters by status', async () => {
      await table.filter('Active');

      const rowCount = await table.getRowCount();
      for (let i = 0; i < rowCount; i++) {
        await expect(table.getCellInRow(i, 3)).toHaveText('Active');
      }
    });

    test('combines search and filter', async () => {
      await table.search('John');
      await table.filter('Active');

      const rowCount = await table.getRowCount();
      for (let i = 0; i < rowCount; i++) {
        const rowText = await table.getRow(i).textContent();
        expect(rowText?.toLowerCase()).toContain('john');
        await expect(table.getCellInRow(i, 3)).toHaveText('Active');
      }
    });
  });

  test.describe('CRUD Operations', () => {
    test('creates new user', async ({ page }) => {
      await page.getByRole('button', { name: 'Add user' }).click();
      await modal.waitForOpen();

      await modal.fill({
        name: 'New Test User',
        email: 'newuser@example.com',
        status: 'Active',
      });

      await modal.save();

      // Verify user appears in table
      await table.search('newuser@example.com');
      await expect(table.rows).toHaveCount(1);
      await expect(table.getCellInRow(0, 1)).toHaveText('New Test User');
    });

    test('views user details', async () => {
      await table.clickRowAction(0, 'View');
      await modal.waitForOpen();

      await expect(modal.nameInput).not.toBeEmpty();
      await expect(modal.emailInput).not.toBeEmpty();
    });

    test('edits existing user', async () => {
      await table.clickRowAction(0, 'Edit');
      await modal.waitForOpen();

      const originalName = await modal.nameInput.inputValue();
      await modal.nameInput.fill('Updated Name');
      await modal.save();

      // Verify update
      const newName = await table.getCellText(0, 1);
      expect(newName).toBe('Updated Name');
      expect(newName).not.toBe(originalName);
    });

    test('deletes user', async ({ page }) => {
      const originalCount = await table.getRowCount();
      const deletedEmail = await table.getCellText(0, 2);

      await table.clickRowAction(0, 'Delete');

      // Confirm deletion dialog
      await page.getByRole('button', { name: 'Confirm' }).click();

      await table.waitForLoad();

      const newCount = await table.getRowCount();
      expect(newCount).toBe(originalCount - 1);

      // Verify user no longer appears
      await table.search(deletedEmail);
      await expect(table.emptyState).toBeVisible();
    });
  });

  test.describe('Bulk Operations', () => {
    test('selects multiple rows', async () => {
      await table.selectRow(0);
      await table.selectRow(1);
      await table.selectRow(2);

      await expect(table.bulkActionsButton).toBeEnabled();
      await expect(table.bulkActionsButton).toContainText('3 selected');
    });

    test('selects all rows', async () => {
      await table.selectAll();

      const rowCount = await table.getRowCount();
      await expect(table.bulkActionsButton).toContainText(`${rowCount} selected`);
    });

    test('bulk deletes selected rows', async ({ page }) => {
      const originalCount = await table.getRowCount();

      await table.selectRow(0);
      await table.selectRow(1);

      await table.clickBulkAction('Delete');

      // Confirm
      await page.getByRole('button', { name: 'Confirm' }).click();

      await table.waitForLoad();

      const newCount = await table.getRowCount();
      expect(newCount).toBe(originalCount - 2);
    });

    test('bulk updates status', async () => {
      await table.selectRow(0);
      await table.selectRow(1);

      await table.clickBulkAction('Set status');
      await page.getByRole('menuitem', { name: 'Inactive' }).click();

      await table.waitForLoad();

      // Verify status updated
      await expect(table.getCellInRow(0, 3)).toHaveText('Inactive');
      await expect(table.getCellInRow(1, 3)).toHaveText('Inactive');
    });
  });
});
