/**
 * Reusable Component Template
 *
 * For UI components that appear across multiple pages (tables, modals, forms).
 *
 * Usage:
 *   const table = new DataTableComponent(page, '[data-testid="users-table"]');
 *   await table.search('john');
 *   await table.clickRow(0);
 */

import { Page, Locator, expect } from '@playwright/test';

/**
 * Data Table Component
 * Handles sortable, searchable tables with pagination.
 */
export class DataTableComponent {
  readonly page: Page;
  readonly container: Locator;
  readonly searchInput: Locator;
  readonly headerRow: Locator;
  readonly rows: Locator;
  readonly pagination: PaginationComponent;
  readonly loadingIndicator: Locator;
  readonly emptyState: Locator;

  constructor(page: Page, containerSelector: string) {
    this.page = page;
    this.container = page.locator(containerSelector);
    this.searchInput = this.container.getByPlaceholder(/search/i);
    this.headerRow = this.container.locator('thead tr');
    this.rows = this.container.locator('tbody tr');
    this.pagination = new PaginationComponent(this.container);
    this.loadingIndicator = this.container.getByTestId('table-loading');
    this.emptyState = this.container.getByTestId('empty-state');
  }

  // Wait for table to be ready
  async waitForLoad() {
    await expect(this.loadingIndicator).toBeHidden();
  }

  // Search
  async search(term: string) {
    await this.searchInput.fill(term);
    await this.searchInput.press('Enter');
    await this.waitForLoad();
  }

  async clearSearch() {
    await this.searchInput.clear();
    await this.waitForLoad();
  }

  // Row operations
  async getRowCount(): Promise<number> {
    return await this.rows.count();
  }

  async getRow(index: number): Locator {
    return this.rows.nth(index);
  }

  async clickRow(index: number) {
    await this.rows.nth(index).click();
  }

  async getCellText(rowIndex: number, columnIndex: number): Promise<string> {
    const cell = this.rows.nth(rowIndex).locator('td').nth(columnIndex);
    return await cell.textContent() ?? '';
  }

  // Sorting
  async sortBy(columnName: string) {
    await this.headerRow.getByRole('columnheader', { name: columnName }).click();
    await this.waitForLoad();
  }

  // Assertions
  async expectRowCount(count: number) {
    await expect(this.rows).toHaveCount(count);
  }

  async expectEmpty() {
    await expect(this.emptyState).toBeVisible();
  }

  async expectRowContains(index: number, text: string) {
    await expect(this.rows.nth(index)).toContainText(text);
  }
}

/**
 * Pagination Component
 */
export class PaginationComponent {
  readonly container: Locator;
  readonly prevButton: Locator;
  readonly nextButton: Locator;
  readonly pageInfo: Locator;

  constructor(parent: Locator) {
    this.container = parent.getByTestId('pagination');
    this.prevButton = this.container.getByRole('button', { name: /previous/i });
    this.nextButton = this.container.getByRole('button', { name: /next/i });
    this.pageInfo = this.container.getByTestId('page-info');
  }

  async goToNext() {
    await this.nextButton.click();
  }

  async goToPrevious() {
    await this.prevButton.click();
  }

  async goToPage(page: number) {
    await this.container.getByRole('button', { name: String(page) }).click();
  }

  async getCurrentPage(): Promise<string> {
    return await this.pageInfo.textContent() ?? '';
  }
}

/**
 * Modal/Dialog Component
 */
export class ModalComponent {
  readonly page: Page;
  readonly dialog: Locator;
  readonly title: Locator;
  readonly closeButton: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  readonly content: Locator;

  constructor(page: Page, titleText?: string) {
    this.page = page;
    this.dialog = titleText
      ? page.getByRole('dialog', { name: titleText })
      : page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading');
    this.closeButton = this.dialog.getByRole('button', { name: /close/i });
    this.confirmButton = this.dialog.getByRole('button', { name: /confirm|save|submit|ok/i });
    this.cancelButton = this.dialog.getByRole('button', { name: /cancel/i });
    this.content = this.dialog.locator('[data-testid="modal-content"]');
  }

  async waitForOpen() {
    await expect(this.dialog).toBeVisible();
  }

  async waitForClose() {
    await expect(this.dialog).toBeHidden();
  }

  async close() {
    await this.closeButton.click();
    await this.waitForClose();
  }

  async confirm() {
    await this.confirmButton.click();
  }

  async cancel() {
    await this.cancelButton.click();
    await this.waitForClose();
  }
}

/**
 * Form Component
 */
export class FormComponent {
  readonly page: Page;
  readonly container: Locator;
  readonly submitButton: Locator;
  readonly resetButton: Locator;
  readonly errorSummary: Locator;

  constructor(page: Page, containerSelector: string) {
    this.page = page;
    this.container = page.locator(containerSelector);
    this.submitButton = this.container.getByRole('button', { name: /submit|save/i });
    this.resetButton = this.container.getByRole('button', { name: /reset|clear/i });
    this.errorSummary = this.container.getByRole('alert');
  }

  async fillField(label: string, value: string) {
    await this.container.getByLabel(label).fill(value);
  }

  async selectOption(label: string, value: string) {
    await this.container.getByLabel(label).selectOption(value);
  }

  async checkOption(label: string) {
    await this.container.getByLabel(label).check();
  }

  async submit() {
    await this.submitButton.click();
  }

  async reset() {
    await this.resetButton.click();
  }

  async getFieldError(fieldName: string): Promise<string> {
    const error = this.container.locator(`[data-error-for="${fieldName}"]`);
    return await error.textContent() ?? '';
  }

  async expectFieldError(fieldName: string, message: string) {
    const error = this.container.locator(`[data-error-for="${fieldName}"]`);
    await expect(error).toContainText(message);
  }
}
