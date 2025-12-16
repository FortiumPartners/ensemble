/**
 * Jest test setup
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Mock filesystem operations if needed
jest.setTimeout(10000);

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
