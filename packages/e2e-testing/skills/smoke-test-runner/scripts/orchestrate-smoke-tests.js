/**
 * Smoke Test Runner - Orchestration Script
 *
 * Orchestrates execution of all smoke test categories in sequential order
 * with early exit on failure.
 *
 * @module orchestrate-smoke-tests
 * @version 1.0.0
 */

const { performance } = require('perf_hooks');
const { SmokeTestAPI } = require('../../smoke-test-api/scripts/execute-health-checks.js');
const { SmokeTestDatabase } = require('../../smoke-test-database/scripts/test-connectivity.js');
const { SmokeTestExternalServices } = require('../../smoke-test-external-services/scripts/test-integrations.js');
const { SmokeTestAuth } = require('../../smoke-test-auth/scripts/test-auth-flows.js');
const { SmokeTestCriticalPaths } = require('../../smoke-test-critical-paths/scripts/execute-journeys.js');

/**
 * Smoke test categories in execution order
 */
const SMOKE_TEST_CATEGORIES = [
  {
    id: 'api',
    name: 'API Health',
    skill: 'smoke-test-api',
    target: 180000,  // 3 minutes
    timeout: 300000, // 5 minutes
    order: 1
  },
  {
    id: 'database',
    name: 'Database',
    skill: 'smoke-test-database',
    target: 120000,  // 2 minutes
    timeout: 300000, // 5 minutes
    order: 2
  },
  {
    id: 'externalServices',
    name: 'External Services',
    skill: 'smoke-test-external-services',
    target: 180000,  // 3 minutes
    timeout: 300000, // 5 minutes
    order: 3
  },
  {
    id: 'auth',
    name: 'Auth',
    skill: 'smoke-test-auth',
    target: 120000,  // 2 minutes
    timeout: 300000, // 5 minutes
    order: 4
  },
  {
    id: 'criticalPaths',
    name: 'Critical Paths',
    skill: 'smoke-test-critical-paths',
    target: 300000,  // 5 minutes
    timeout: 600000, // 10 minutes
    order: 5
  }
];

/**
 * Smoke Test Runner Orchestrator
 */
class SmokeTestRunner {
  constructor(config = {}) {
    this.config = {
      environment: config.environment || 'staging',
      stopOnFirstFailure: config.stopOnFirstFailure !== false,
      categories: config.categories || SMOKE_TEST_CATEGORIES.map(c => c.id),
      ...config
    };

    this.results = {};
    this.totalDuration = 0;
  }

  /**
   * Execute all smoke test categories
   *
   * @returns {Promise<Object>} Execution results
   */
  async executeAll() {
    console.log('🚀 Starting smoke test orchestration...');
    console.log(`📦 Environment: ${this.config.environment}`);
    console.log(`🎯 Categories: ${this.config.categories.join(', ')}`);
    console.log('');

    const startTime = performance.now();

    const categoriesToExecute = SMOKE_TEST_CATEGORIES.filter(c =>
      this.config.categories.includes(c.id)
    );

    for (const category of categoriesToExecute) {
      console.log(`[${category.order}/${categoriesToExecute.length}] Executing ${category.name}...`);

      const result = await this.executeCategory(category);
      this.results[category.id] = result;

      // Display result
      if (result.passed) {
        console.log(`✅ ${category.name} passed (${result.duration}ms)`);
      } else {
        console.log(`❌ ${category.name} failed (${result.duration}ms)`);
        console.log(`   Reason: ${result.reason}`);
      }
      console.log('');

      // Early exit on failure
      if (!result.passed && this.config.stopOnFirstFailure) {
        const totalDuration = performance.now() - startTime;
        return this.buildFailureResult(category, result, totalDuration, categoriesToExecute.length);
      }
    }

    const totalDuration = performance.now() - startTime;
    return this.buildSuccessResult(totalDuration, categoriesToExecute.length);
  }

  /**
   * Execute a single smoke test category
   *
   * @param {Object} category - Category configuration
   * @returns {Promise<Object>} Category execution result
   */
  async executeCategory(category) {
    const startTime = performance.now();

    try {
      let result;

      // In production, would use Skill tool to invoke the specific smoke test skill
      // For now, execute directly via require'd modules
      switch (category.id) {
        case 'api':
          result = await this.executeAPITests();
          break;
        case 'database':
          result = await this.executeDatabaseTests();
          break;
        case 'externalServices':
          result = await this.executeExternalServicesTests();
          break;
        case 'auth':
          result = await this.executeAuthTests();
          break;
        case 'criticalPaths':
          result = await this.executeCriticalPathsTests();
          break;
        default:
          throw new Error(`Unknown category: ${category.id}`);
      }

      const duration = Math.round(performance.now() - startTime);

      // Check if execution exceeded target
      if (duration > category.target) {
        console.warn(`⚠️  ${category.name} exceeded target (${duration}ms > ${category.target}ms)`);
      }

      return {
        category: category.id,
        name: category.name,
        passed: result.passed,
        duration,
        target: category.target,
        reason: result.reason,
        details: result.details
      };

    } catch (error) {
      const duration = Math.round(performance.now() - startTime);

      return {
        category: category.id,
        name: category.name,
        passed: false,
        duration,
        target: category.target,
        reason: error.message,
        error: error.stack
      };
    }
  }

  /**
   * Execute API smoke tests
   */
  async executeAPITests() {
    const tester = new SmokeTestAPI({
      baseUrl: process.env.BASE_URL || 'http://localhost:3000'
    });

    return tester.executeHealthChecks({
      environment: this.config.environment,
      endpoints: [
        { path: '/health', method: 'GET', expectedStatus: 200, sla: 100 }
      ]
    });
  }

  /**
   * Execute database smoke tests
   */
  async executeDatabaseTests() {
    const tester = new SmokeTestDatabase({
      type: 'postgresql',
      host: process.env.DB_HOST || 'localhost'
    });

    return tester.executeTests({
      environment: this.config.environment,
      tests: ['connectivity', 'query-performance']
    });
  }

  /**
   * Execute external services smoke tests
   */
  async executeExternalServicesTests() {
    const tester = new SmokeTestExternalServices({
      services: []  // Would be configured per environment
    });

    return tester.executeTests({
      environment: this.config.environment,
      tests: ['connectivity', 'authentication']
    });
  }

  /**
   * Execute auth smoke tests
   */
  async executeAuthTests() {
    const tester = new SmokeTestAuth({
      baseUrl: process.env.BASE_URL || 'http://localhost:3000'
    });

    return tester.executeTests({
      environment: this.config.environment,
      tests: ['login', 'token-validation']
    });
  }

  /**
   * Execute critical paths smoke tests
   */
  async executeCriticalPathsTests() {
    const tester = new SmokeTestCriticalPaths({
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      journeys: ['registration', 'checkout']
    });

    return tester.executeTests({
      environment: this.config.environment
    });
  }

  /**
   * Build success result
   *
   * @param {number} totalDuration - Total execution time
   * @param {number} totalCategories - Total categories executed
   * @returns {Object} Success result
   */
  buildSuccessResult(totalDuration, totalCategories) {
    return {
      status: 'success',
      passed: true,
      totalDuration: Math.round(totalDuration),
      targetDuration: SMOKE_TEST_CATEGORIES.reduce((sum, c) => sum + c.target, 0),
      categoriesExecuted: totalCategories,
      categoriesPassed: totalCategories,
      categoriesFailed: 0,
      results: this.results
    };
  }

  /**
   * Build failure result
   *
   * @param {Object} failedCategory - Category that failed
   * @param {Object} failedResult - Failed category result
   * @param {number} totalDuration - Total execution time
   * @param {number} totalCategories - Total categories
   * @returns {Object} Failure result
   */
  buildFailureResult(failedCategory, failedResult, totalDuration, totalCategories) {
    const categoriesExecuted = Object.keys(this.results).length;

    return {
      status: 'failure',
      passed: false,
      failedCategory: failedCategory.id,
      failedCategoryName: failedCategory.name,
      failureReason: failedResult.reason,
      totalDuration: Math.round(totalDuration),
      categoriesExecuted,
      categoriesPassed: categoriesExecuted - 1,
      categoriesFailed: 1,
      results: this.results
    };
  }
}

/**
 * Export runner and configuration
 */
module.exports = {
  SmokeTestRunner,
  SMOKE_TEST_CATEGORIES
};

/**
 * CLI usage example:
 *
 * const { SmokeTestRunner } = require('./orchestrate-smoke-tests.js');
 *
 * const runner = new SmokeTestRunner({
 *   environment: 'staging',
 *   stopOnFirstFailure: true
 * });
 *
 * const result = await runner.executeAll();
 *
 * if (result.passed) {
 *   console.log('✅ All smoke tests passed!');
 *   console.log(`Total time: ${result.totalDuration}ms`);
 * } else {
 *   console.error(`❌ Smoke tests failed: ${result.failedCategoryName}`);
 *   console.error(`Reason: ${result.failureReason}`);
 * }
 */
