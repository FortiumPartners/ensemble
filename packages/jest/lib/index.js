/**
 * Jest Testing Plugin - Entry Point
 * Exports skill metadata and utilities
 */

const { JestTestGenerator } = require('./generate-test');
const { JestTestRunner } = require('./run-test');

module.exports = {
  // Skill metadata
  skill: {
    name: 'Jest Test Framework',
    description: 'Execute and generate Jest tests for JavaScript/TypeScript projects with support for unit, integration, and E2E testing',
    version: '1.0.0',
    capabilities: [
      'test-generation',
      'test-execution',
      'unit-testing',
      'integration-testing',
      'e2e-testing',
      'react-testing',
      'node-testing',
      'express-testing'
    ]
  },

  // Utilities
  JestTestGenerator,
  JestTestRunner,

  // Helper functions
  async generateTest(options) {
    const generator = new JestTestGenerator(options);
    return await generator.generate();
  },

  async runTest(options) {
    const runner = new JestTestRunner(options);
    return await runner.run();
  }
};
