import '@testing-library/jest-dom';

// Mock import.meta.env for Vite compatibility - this needs to be handled by babel plugin
// jest.config will handle this via moduleNameMapper

// Mock fetch globally
global.fetch = jest.fn();

// Reset mocks before each test
beforeEach(() => {
  fetch.mockClear();
});
