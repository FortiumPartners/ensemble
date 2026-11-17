import { test, expect } from '@playwright/test';

test('a shopper checks out with one item', async ({ page }) => {
  await page.goto('/cart.html');
  await expect(page.getByTestId('cart-line-item')).toHaveCount(1);
  await page.getByTestId('cart-button-checkout').click();

  await expect(page).toHaveURL(/checkout\.html$/);
  await page.getByLabel('Email').fill('shopper@example.com');
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByTestId('checkout-button-pay').click();

  await expect(page).toHaveURL(/confirmation\.html$/);
  await expect(page.getByTestId('confirmation-heading')).toHaveText('Thank you for your order');
});
