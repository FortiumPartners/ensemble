/**
 * Legacy Selector Utilities Template
 *
 * Patterns for working with legacy UIs that lack proper test attributes.
 * Use these as fallbacks while incrementally adding data-testid attributes.
 *
 * Usage:
 *   import { resilientLocator, waitForLegacyPage } from '../utils/legacy-selectors';
 *   const button = resilientLocator(page, { testId: 'submit', fallbackCss: '.btn-primary' });
 */

import { Page, Locator, expect } from '@playwright/test';

/**
 * Selector strategy with fallbacks
 * Tries selectors in order of preference
 */
export function resilientLocator(
  page: Page,
  options: ResilientLocatorOptions
): Locator {
  // Priority 1: data-testid
  if (options.testId) {
    return page.getByTestId(options.testId);
  }

  // Priority 2: Accessible role + name
  if (options.role && options.name) {
    return page.getByRole(options.role as any, { name: options.name });
  }

  // Priority 3: Label (for form inputs)
  if (options.label) {
    return page.getByLabel(options.label);
  }

  // Priority 4: Visible text
  if (options.text) {
    return page.getByText(options.text, { exact: options.exactText });
  }

  // Priority 5: Placeholder (for inputs without labels)
  if (options.placeholder) {
    return page.getByPlaceholder(options.placeholder);
  }

  // Fallback: CSS selector (log warning)
  if (options.fallbackCss) {
    console.warn(`Using fallback CSS selector: ${options.fallbackCss}`);
    return page.locator(options.fallbackCss);
  }

  throw new Error('No valid selector provided');
}

interface ResilientLocatorOptions {
  testId?: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  exactText?: boolean;
  placeholder?: string;
  fallbackCss?: string;
}

/**
 * Wait for legacy SPA page to be ready
 * Handles common loading patterns in older frameworks
 */
export async function waitForLegacyPage(
  page: Page,
  options: LegacyWaitOptions = {}
) {
  const {
    loadingSelectors = ['.loading', '.spinner', '[data-loading]', '.skeleton'],
    networkIdle = true,
    checkJQuery = true,
    checkAngular = true,
    timeout = 30000,
  } = options;

  // Wait for loading indicators to disappear
  for (const selector of loadingSelectors) {
    const loading = page.locator(selector);
    const count = await loading.count();
    if (count > 0) {
      await expect(loading.first()).toBeHidden({ timeout });
    }
  }

  // Wait for network to settle
  if (networkIdle) {
    await page.waitForLoadState('networkidle');
  }

  // Wait for jQuery AJAX (legacy apps)
  if (checkJQuery) {
    await page.waitForFunction(
      () => !(window as any).jQuery || (window as any).jQuery.active === 0,
      { timeout }
    );
  }

  // Wait for Angular stability
  if (checkAngular) {
    await page.waitForFunction(
      () => {
        const ng = (window as any).getAllAngularTestabilities;
        if (!ng) return true;
        return ng().every((t: any) => t.isStable());
      },
      { timeout }
    );
  }
}

interface LegacyWaitOptions {
  loadingSelectors?: string[];
  networkIdle?: boolean;
  checkJQuery?: boolean;
  checkAngular?: boolean;
  timeout?: number;
}

/**
 * Audit page for testability
 * Reports elements that need data-testid attributes
 */
export async function auditPageSelectors(page: Page): Promise<SelectorAudit> {
  const audit: SelectorAudit = {
    total: 0,
    withTestId: 0,
    withAriaLabel: 0,
    textOnly: 0,
    needsAttention: [],
  };

  // Audit buttons
  const buttons = await page.getByRole('button').all();
  for (const button of buttons) {
    audit.total++;
    const result = await auditElement(button, 'button');
    if (result.hasTestId) audit.withTestId++;
    else if (result.hasAriaLabel) audit.withAriaLabel++;
    else if (result.hasText) audit.textOnly++;
    else audit.needsAttention.push(result);
  }

  // Audit links
  const links = await page.getByRole('link').all();
  for (const link of links) {
    audit.total++;
    const result = await auditElement(link, 'link');
    if (result.hasTestId) audit.withTestId++;
    else if (result.hasAriaLabel) audit.withAriaLabel++;
    else if (result.hasText) audit.textOnly++;
    else audit.needsAttention.push(result);
  }

  // Audit form inputs
  const inputs = await page.locator('input, select, textarea').all();
  for (const input of inputs) {
    audit.total++;
    const result = await auditElement(input, 'input');
    if (result.hasTestId) audit.withTestId++;
    else if (result.hasAriaLabel) audit.withAriaLabel++;
    else if (result.hasLabel) audit.textOnly++;
    else audit.needsAttention.push(result);
  }

  return audit;
}

async function auditElement(locator: Locator, type: string): Promise<ElementAuditResult> {
  const testId = await locator.getAttribute('data-testid');
  const ariaLabel = await locator.getAttribute('aria-label');
  const text = await locator.textContent();
  const id = await locator.getAttribute('id');
  const name = await locator.getAttribute('name');
  const className = await locator.getAttribute('class');

  // Check if input has associated label
  let hasLabel = false;
  if (id) {
    const label = locator.page().locator(`label[for="${id}"]`);
    hasLabel = (await label.count()) > 0;
  }

  return {
    type,
    hasTestId: !!testId,
    hasAriaLabel: !!ariaLabel,
    hasText: !!text?.trim(),
    hasLabel,
    details: {
      testId,
      ariaLabel,
      text: text?.trim().substring(0, 50),
      id,
      name,
      className: className?.substring(0, 50),
    },
  };
}

interface SelectorAudit {
  total: number;
  withTestId: number;
  withAriaLabel: number;
  textOnly: number;
  needsAttention: ElementAuditResult[];
}

interface ElementAuditResult {
  type: string;
  hasTestId: boolean;
  hasAriaLabel: boolean;
  hasText: boolean;
  hasLabel?: boolean;
  details: {
    testId: string | null;
    ariaLabel: string | null;
    text: string | undefined;
    id: string | null;
    name: string | null;
    className: string | null | undefined;
  };
}

/**
 * Generate suggested test IDs for elements
 */
export function suggestTestId(
  context: string,
  elementType: string,
  qualifier?: string
): string {
  const parts = [
    context.toLowerCase().replace(/\s+/g, '-'),
    elementType.toLowerCase(),
  ];

  if (qualifier) {
    parts.push(qualifier.toLowerCase().replace(/\s+/g, '-'));
  }

  return parts.join('-');
}

// Example:
// suggestTestId('Contact Form', 'button', 'submit') => 'contact-form-button-submit'
// suggestTestId('User List', 'row', '123') => 'user-list-row-123'
