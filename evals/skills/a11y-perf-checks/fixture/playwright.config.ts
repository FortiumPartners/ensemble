import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.cases.ts',
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npx http-server public -p 4173',
    url: 'http://localhost:4173/cart.html',
    reuseExistingServer: true,
  },
});
