/**
 * Authentication Flow Example
 *
 * Demonstrates testing complete authentication flows including:
 * - Login/logout
 * - Password reset
 * - Session management
 * - Protected routes
 * - OAuth flows
 */

import { test, expect, Page } from '@playwright/test';

// =============================================================================
// Page Objects
// =============================================================================

class LoginPage {
  constructor(private page: Page) {}

  get emailInput() {
    return this.page.getByLabel('Email');
  }

  get passwordInput() {
    return this.page.getByLabel('Password');
  }

  get rememberMeCheckbox() {
    return this.page.getByLabel('Remember me');
  }

  get submitButton() {
    return this.page.getByRole('button', { name: 'Sign in' });
  }

  get errorMessage() {
    return this.page.getByRole('alert');
  }

  get forgotPasswordLink() {
    return this.page.getByRole('link', { name: /forgot password/i });
  }

  get googleLoginButton() {
    return this.page.getByRole('button', { name: /google/i });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string, remember = false) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    if (remember) {
      await this.rememberMeCheckbox.check();
    }
    await this.submitButton.click();
  }
}

class PasswordResetPage {
  constructor(private page: Page) {}

  get emailInput() {
    return this.page.getByLabel('Email');
  }

  get submitButton() {
    return this.page.getByRole('button', { name: 'Send reset link' });
  }

  get successMessage() {
    return this.page.getByTestId('reset-success');
  }

  get backToLoginLink() {
    return this.page.getByRole('link', { name: /back to login/i });
  }

  async requestReset(email: string) {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }
}

class NewPasswordPage {
  constructor(private page: Page) {}

  get passwordInput() {
    return this.page.getByLabel('New password');
  }

  get confirmPasswordInput() {
    return this.page.getByLabel('Confirm password');
  }

  get submitButton() {
    return this.page.getByRole('button', { name: 'Reset password' });
  }

  get successMessage() {
    return this.page.getByTestId('password-changed');
  }

  async goto(token: string) {
    await this.page.goto(`/reset-password?token=${token}`);
  }

  async resetPassword(newPassword: string) {
    await this.passwordInput.fill(newPassword);
    await this.confirmPasswordInput.fill(newPassword);
    await this.submitButton.click();
  }
}

class Header {
  constructor(private page: Page) {}

  get userMenu() {
    return this.page.getByTestId('user-menu');
  }

  get logoutButton() {
    return this.page.getByRole('button', { name: 'Logout' });
  }

  get loginLink() {
    return this.page.getByRole('link', { name: 'Login' });
  }

  async logout() {
    await this.userMenu.click();
    await this.logoutButton.click();
  }

  async isLoggedIn(): Promise<boolean> {
    return await this.userMenu.isVisible();
  }
}

// =============================================================================
// Test Suite: Login Flow
// =============================================================================

test.describe('Login Flow', () => {
  let loginPage: LoginPage;
  let header: Header;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    header = new Header(page);
    await loginPage.goto();
  });

  test('logs in with valid credentials', async ({ page }) => {
    await loginPage.login('user@example.com', 'password123');

    // Verify redirect to dashboard
    await expect(page).toHaveURL(/dashboard/);

    // Verify user is logged in
    await expect(header.userMenu).toBeVisible();
  });

  test('shows error with invalid credentials', async () => {
    await loginPage.login('user@example.com', 'wrongpassword');

    await expect(loginPage.errorMessage).toBeVisible();
    await expect(loginPage.errorMessage).toContainText(/invalid/i);
  });

  test('shows error with non-existent user', async () => {
    await loginPage.login('nonexistent@example.com', 'password123');

    await expect(loginPage.errorMessage).toContainText(/not found|invalid/i);
  });

  test('validates required fields', async () => {
    await loginPage.submitButton.click();

    // Check for validation
    await expect(loginPage.page.locator(':invalid')).not.toHaveCount(0);
  });

  test('persists session with remember me', async ({ page, context }) => {
    await loginPage.login('user@example.com', 'password123', true);

    // Verify logged in
    await expect(page).toHaveURL(/dashboard/);

    // Get cookies
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name.includes('session'));

    // Remember me should set longer expiry
    expect(sessionCookie?.expires).toBeGreaterThan(Date.now() / 1000 + 86400); // > 1 day
  });

  test('handles account lockout', async ({ page }) => {
    // Attempt multiple failed logins
    for (let i = 0; i < 5; i++) {
      await loginPage.login('user@example.com', 'wrongpassword');
      await page.waitForTimeout(100); // Small delay between attempts
    }

    // Should show lockout message
    await expect(loginPage.errorMessage).toContainText(/locked|too many attempts/i);

    // Submit should be disabled
    await expect(loginPage.submitButton).toBeDisabled();
  });
});

// =============================================================================
// Test Suite: Logout Flow
// =============================================================================

test.describe('Logout Flow', () => {
  // Use authenticated state
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('logs out successfully', async ({ page }) => {
    const header = new Header(page);

    await page.goto('/dashboard');
    await header.logout();

    // Verify redirect to login
    await expect(page).toHaveURL(/login/);

    // Verify logged out
    await expect(header.loginLink).toBeVisible();
  });

  test('clears session on logout', async ({ page, context }) => {
    const header = new Header(page);

    await page.goto('/dashboard');
    await header.logout();

    // Check cookies cleared
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name.includes('session'));
    expect(sessionCookie).toBeUndefined();
  });

  test('redirects to login after logout on protected page', async ({ page }) => {
    const header = new Header(page);

    await page.goto('/dashboard');
    await header.logout();

    // Try to access protected page
    await page.goto('/settings');

    // Should redirect to login
    await expect(page).toHaveURL(/login/);
  });
});

// =============================================================================
// Test Suite: Password Reset
// =============================================================================

test.describe('Password Reset', () => {
  test('sends password reset email', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const resetPage = new PasswordResetPage(page);

    await loginPage.goto();
    await loginPage.forgotPasswordLink.click();

    await expect(page).toHaveURL(/forgot-password/);

    await resetPage.requestReset('user@example.com');

    await expect(resetPage.successMessage).toBeVisible();
    await expect(resetPage.successMessage).toContainText(/email sent/i);
  });

  test('validates email format', async ({ page }) => {
    const resetPage = new PasswordResetPage(page);

    await page.goto('/forgot-password');
    await resetPage.emailInput.fill('invalid-email');
    await resetPage.submitButton.click();

    await expect(page.locator(':invalid')).not.toHaveCount(0);
  });

  test('resets password with valid token', async ({ page }) => {
    const newPasswordPage = new NewPasswordPage(page);
    const validToken = 'valid-reset-token-123';

    // Mock token validation
    await page.route('**/api/validate-reset-token*', route =>
      route.fulfill({ status: 200, body: '{"valid": true}' })
    );

    await newPasswordPage.goto(validToken);
    await newPasswordPage.resetPassword('NewPassword123!');

    await expect(newPasswordPage.successMessage).toBeVisible();
  });

  test('rejects expired token', async ({ page }) => {
    const newPasswordPage = new NewPasswordPage(page);
    const expiredToken = 'expired-token';

    await page.route('**/api/validate-reset-token*', route =>
      route.fulfill({
        status: 400,
        body: '{"error": "Token expired"}',
      })
    );

    await newPasswordPage.goto(expiredToken);

    await expect(page.getByText(/expired|invalid/i)).toBeVisible();
  });
});

// =============================================================================
// Test Suite: Protected Routes
// =============================================================================

test.describe('Protected Routes', () => {
  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/login/);
  });

  test('preserves intended destination after login', async ({ page }) => {
    const loginPage = new LoginPage(page);

    // Try to access protected page
    await page.goto('/settings/profile');

    // Redirected to login
    await expect(page).toHaveURL(/login/);

    // Login
    await loginPage.login('user@example.com', 'password123');

    // Should redirect back to intended page
    await expect(page).toHaveURL(/settings\/profile/);
  });

  test('allows access to authenticated user', async ({ page }) => {
    // Use authenticated state
    test.use({ storageState: 'playwright/.auth/user.json' });

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

// =============================================================================
// Test Suite: Session Management
// =============================================================================

test.describe('Session Management', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('handles session expiry gracefully', async ({ page }) => {
    await page.goto('/dashboard');

    // Mock session expiry on next API call
    await page.route('**/api/**', route =>
      route.fulfill({
        status: 401,
        body: '{"error": "Session expired"}',
      })
    );

    // Trigger API call
    await page.getByRole('button', { name: 'Refresh' }).click();

    // Should redirect to login with message
    await expect(page).toHaveURL(/login/);
    await expect(page.getByText(/session expired/i)).toBeVisible();
  });

  test('refreshes session before expiry', async ({ page, context }) => {
    await page.goto('/dashboard');

    // Get initial session
    const initialCookies = await context.cookies();
    const initialSession = initialCookies.find(c => c.name.includes('session'));

    // Wait for refresh (if app auto-refreshes)
    await page.waitForTimeout(5000);

    // Trigger activity
    await page.mouse.move(100, 100);

    // Check session was refreshed
    const newCookies = await context.cookies();
    const newSession = newCookies.find(c => c.name.includes('session'));

    // Session should still be valid
    expect(newSession).toBeDefined();
  });
});

// =============================================================================
// Test Suite: OAuth Login (mocked)
// =============================================================================

test.describe('OAuth Login', () => {
  test('initiates Google OAuth flow', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    // Mock OAuth redirect
    await page.route('**/auth/google', route => {
      route.fulfill({
        status: 302,
        headers: {
          location: 'https://accounts.google.com/o/oauth2/auth?...',
        },
      });
    });

    // Click would normally redirect
    await expect(loginPage.googleLoginButton).toBeVisible();
  });

  test('handles OAuth callback', async ({ page }) => {
    // Simulate OAuth callback
    await page.goto('/auth/callback?code=mock-auth-code&state=mock-state');

    // Mock the token exchange
    await page.route('**/api/auth/oauth/callback', route =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          user: { id: 1, email: 'user@gmail.com' },
          token: 'mock-jwt-token',
        }),
      })
    );

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard/);
  });
});
