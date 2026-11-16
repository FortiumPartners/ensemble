import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:8080',
  },
  webServer: {
    command: 'npx http-server public -p 8080',
    url: 'http://localhost:8080/contact.html',
    reuseExistingServer: true,
  },
});
