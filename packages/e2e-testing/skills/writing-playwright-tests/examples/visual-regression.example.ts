/**
 * Visual Regression Testing Example
 *
 * Demonstrates visual testing patterns including:
 * - Full page screenshots
 * - Component screenshots
 * - Handling dynamic content
 * - Cross-browser visual testing
 * - Responsive design testing
 */

import { test, expect, Page } from '@playwright/test';

// =============================================================================
// Configuration for Visual Tests
// =============================================================================

// Extend test to configure visual testing defaults
const visualTest = test.extend({
  // Default options for visual tests
  page: async ({ page }, use) => {
    // Disable animations for consistent screenshots
    await page.addInitScript(() => {
      // Disable CSS animations
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `;
      document.head.appendChild(style);
    });

    await use(page);
  },
});

// =============================================================================
// Full Page Visual Tests
// =============================================================================

visualTest.describe('Full Page Visual Tests', () => {
  visualTest('homepage matches snapshot', async ({ page }) => {
    await page.goto('/');

    // Wait for content to load
    await page.waitForLoadState('networkidle');

    // Hide dynamic elements
    await hideDynamicElements(page);

    await expect(page).toHaveScreenshot('homepage.png', {
      fullPage: true,
      maxDiffPixels: 100,
    });
  });

  visualTest('dashboard matches snapshot', async ({ page }) => {
    // Assumes authenticated
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await hideDynamicElements(page);

    await expect(page).toHaveScreenshot('dashboard.png', {
      fullPage: true,
    });
  });

  visualTest('login page matches snapshot', async ({ page }) => {
    await page.goto('/login');

    await expect(page).toHaveScreenshot('login.png');
  });
});

// =============================================================================
// Component Visual Tests
// =============================================================================

visualTest.describe('Component Visual Tests', () => {
  visualTest('navigation component', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation');
    await expect(nav).toHaveScreenshot('navigation.png');
  });

  visualTest('footer component', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('footer');
    await expect(footer).toHaveScreenshot('footer.png');
  });

  visualTest('card component variants', async ({ page }) => {
    await page.goto('/components/cards');

    // Test each card variant
    const defaultCard = page.getByTestId('card-default');
    await expect(defaultCard).toHaveScreenshot('card-default.png');

    const elevatedCard = page.getByTestId('card-elevated');
    await expect(elevatedCard).toHaveScreenshot('card-elevated.png');

    const outlinedCard = page.getByTestId('card-outlined');
    await expect(outlinedCard).toHaveScreenshot('card-outlined.png');
  });

  visualTest('button states', async ({ page }) => {
    await page.goto('/components/buttons');

    const button = page.getByTestId('primary-button');

    // Default state
    await expect(button).toHaveScreenshot('button-default.png');

    // Hover state
    await button.hover();
    await expect(button).toHaveScreenshot('button-hover.png');

    // Focus state
    await button.focus();
    await expect(button).toHaveScreenshot('button-focus.png');

    // Disabled state
    const disabledButton = page.getByTestId('disabled-button');
    await expect(disabledButton).toHaveScreenshot('button-disabled.png');
  });

  visualTest('form field states', async ({ page }) => {
    await page.goto('/components/forms');

    const input = page.getByLabel('Email');

    // Empty state
    await expect(input).toHaveScreenshot('input-empty.png');

    // Filled state
    await input.fill('test@example.com');
    await expect(input).toHaveScreenshot('input-filled.png');

    // Error state
    await page.getByLabel('Invalid field').fill('bad');
    await page.getByLabel('Invalid field').blur();
    const errorField = page.locator('.field-group:has(.error)');
    await expect(errorField).toHaveScreenshot('input-error.png');
  });
});

// =============================================================================
// Responsive Visual Tests
// =============================================================================

const viewports = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'wide', width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  visualTest.describe(`Responsive - ${viewport.name}`, () => {
    visualTest.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    visualTest(`homepage at ${viewport.name}`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await hideDynamicElements(page);

      await expect(page).toHaveScreenshot(`homepage-${viewport.name}.png`, {
        fullPage: true,
      });
    });

    visualTest(`navigation at ${viewport.name}`, async ({ page }) => {
      await page.goto('/');

      const nav = page.getByRole('navigation');
      await expect(nav).toHaveScreenshot(`navigation-${viewport.name}.png`);
    });
  });
}

// =============================================================================
// Theme Visual Tests
// =============================================================================

visualTest.describe('Theme Visual Tests', () => {
  visualTest('light theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });

    await expect(page).toHaveScreenshot('theme-light.png');
  });

  visualTest('dark theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await expect(page).toHaveScreenshot('theme-dark.png');
  });

  visualTest('high contrast theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'high-contrast');
    });

    await expect(page).toHaveScreenshot('theme-high-contrast.png');
  });
});

// =============================================================================
// Dynamic Content Handling
// =============================================================================

visualTest.describe('Dynamic Content', () => {
  visualTest('masks user-specific content', async ({ page }) => {
    await page.goto('/profile');

    await expect(page).toHaveScreenshot('profile.png', {
      mask: [
        page.getByTestId('user-avatar'),
        page.getByTestId('user-name'),
        page.getByTestId('user-email'),
        page.getByTestId('last-login'),
      ],
    });
  });

  visualTest('hides timestamps', async ({ page }) => {
    await page.goto('/activity');

    // Hide all timestamp elements
    await page.evaluate(() => {
      document.querySelectorAll('[data-timestamp], .timestamp, time').forEach(el => {
        (el as HTMLElement).style.visibility = 'hidden';
      });
    });

    await expect(page).toHaveScreenshot('activity.png');
  });

  visualTest('freezes animated content', async ({ page }) => {
    await page.goto('/dashboard');

    // Freeze charts/graphs at specific state
    await page.evaluate(() => {
      // Stop any running animations
      document.getAnimations().forEach(anim => anim.cancel());

      // Replace animated charts with static versions
      document.querySelectorAll('[data-animated-chart]').forEach(chart => {
        chart.setAttribute('data-animation', 'disabled');
      });
    });

    await expect(page).toHaveScreenshot('dashboard-static.png');
  });

  visualTest('waits for images to load', async ({ page }) => {
    await page.goto('/gallery');

    // Wait for all images
    await page.waitForFunction(() => {
      const images = document.querySelectorAll('img');
      return Array.from(images).every(img => img.complete && img.naturalHeight > 0);
    });

    await expect(page).toHaveScreenshot('gallery.png', {
      fullPage: true,
    });
  });
});

// =============================================================================
// Cross-Browser Visual Tests
// =============================================================================

// These run in different browser projects defined in playwright.config.ts

visualTest.describe('Cross-Browser', () => {
  visualTest('renders consistently across browsers', async ({ page, browserName }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await hideDynamicElements(page);

    // Each browser will have its own snapshot
    await expect(page).toHaveScreenshot(`homepage-${browserName}.png`, {
      // Higher tolerance for cross-browser differences
      maxDiffPixelRatio: 0.02,
    });
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

async function hideDynamicElements(page: Page) {
  await page.evaluate(() => {
    const selectors = [
      '[data-testid="timestamp"]',
      '[data-testid="user-avatar"]',
      '.advertisement',
      '.cookie-banner',
      '[data-dynamic="true"]',
      'time',
      '.live-chat',
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        (el as HTMLElement).style.visibility = 'hidden';
      });
    });
  });
}

async function waitForStableDOM(page: Page, timeout = 2000) {
  let lastHTML = '';
  let stableCount = 0;

  while (stableCount < 3) {
    await page.waitForTimeout(100);
    const currentHTML = await page.content();

    if (currentHTML === lastHTML) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHTML = currentHTML;
    }

    if (stableCount * 100 > timeout) break;
  }
}

async function setMockDate(page: Page, date: Date) {
  await page.addInitScript((dateString) => {
    const mockDate = new Date(dateString);
    const OriginalDate = Date;

    // @ts-ignore
    window.Date = class extends OriginalDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(mockDate);
        } else {
          // @ts-ignore
          super(...args);
        }
      }

      static now() {
        return mockDate.getTime();
      }
    };
  }, date.toISOString());
}

// =============================================================================
// Visual Diff Configuration Examples
// =============================================================================

/*
In playwright.config.ts, configure visual testing:

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      // Allow slight differences
      maxDiffPixels: 100,

      // Or use percentage
      // maxDiffPixelRatio: 0.01,

      // Animation handling
      animations: 'disabled',

      // Caret handling for inputs
      caret: 'hide',
    },
  },

  // Separate snapshots per browser/platform
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
});
*/

// =============================================================================
// Updating Snapshots
// =============================================================================

/*
To update snapshots when UI intentionally changes:

# Update all snapshots
npx playwright test --update-snapshots

# Update specific test snapshots
npx playwright test homepage.spec.ts --update-snapshots

# Review changes in HTML report
npx playwright show-report
*/
