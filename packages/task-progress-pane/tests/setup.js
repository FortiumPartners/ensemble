/**
 * Vitest test setup
 */

import { vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

// Mock the home directory for tests
const TEST_HOME = path.join(os.tmpdir(), 'task-progress-pane-test');

// Store original environment
const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset mocks
  vi.clearAllMocks();

  // Set test home directory
  process.env.HOME = TEST_HOME;
});

afterEach(() => {
  // Restore environment
  process.env = { ...originalEnv };
});

// Export test utilities
export { TEST_HOME };
