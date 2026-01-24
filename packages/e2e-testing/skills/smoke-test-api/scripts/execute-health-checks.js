/**
 * API Health Check Execution Script
 *
 * Executes comprehensive API smoke tests to validate service availability,
 * response times, and critical endpoint functionality.
 *
 * @module execute-health-checks
 * @version 1.0.0
 */

const { performance } = require('perf_hooks');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * API Smoke Test Executor
 */
class SmokeTestAPI {
  constructor(config = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'http://localhost:3000',
      timeout: config.timeout || 5000,
      retries: config.retries || 2,
      retryDelay: config.retryDelay || 1000,
      validateSSL: config.validateSSL !== false,
      followRedirects: config.followRedirects !== false,
      stopOnFirstFailure: config.stopOnFirstFailure || false,
      parallel: config.parallel || false,
      maxConcurrency: config.maxConcurrency || 5,
      debug: config.debug || false,
      ...config
    };

    this.results = [];
    this.metrics = {
      totalEndpoints: 0,
      passed: 0,
      failed: 0,
      executionTime: 0,
      responseTimes: []
    };
  }

  /**
   * Execute health checks for all configured endpoints
   *
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution results
   */
  async executeHealthChecks(context) {
    const startTime = performance.now();

    console.log(`🔍 Executing API smoke tests...`);
    console.log(`   Environment: ${context.environment}`);
    console.log(`   Base URL: ${this.config.baseUrl}`);
    console.log(`   Endpoints: ${context.endpoints.length}`);
    console.log('');

    this.metrics.totalEndpoints = context.endpoints.length;

    try {
      if (this.config.parallel) {
        await this.executeParallel(context.endpoints);
      } else {
        await this.executeSequential(context.endpoints);
      }

      const executionTime = performance.now() - startTime;
      this.metrics.executionTime = Math.round(executionTime);

      return this.buildResult();

    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.metrics.executionTime = Math.round(executionTime);

      return {
        passed: false,
        reason: `API smoke tests failed: ${error.message}`,
        error: error.stack,
        details: this.metrics,
        results: this.results
      };
    }
  }

  /**
   * Execute endpoints sequentially
   *
   * @param {Array<Object>} endpoints - Endpoints to test
   */
  async executeSequential(endpoints) {
    for (const endpoint of endpoints) {
      const result = await this.testEndpoint(endpoint);
      this.results.push(result);

      if (result.passed) {
        this.metrics.passed++;
        console.log(`✅ ${endpoint.name || endpoint.path}: ${result.status} (${result.responseTime}ms)`);
      } else {
        this.metrics.failed++;
        console.log(`❌ ${endpoint.name || endpoint.path}: ${result.reason}`);

        if (this.config.stopOnFirstFailure) {
          throw new Error(`Endpoint failed: ${endpoint.path}`);
        }
      }

      this.metrics.responseTimes.push(result.responseTime);
    }
  }

  /**
   * Execute endpoints in parallel
   *
   * @param {Array<Object>} endpoints - Endpoints to test
   */
  async executeParallel(endpoints) {
    const batches = this.createBatches(endpoints, this.config.maxConcurrency);

    for (const batch of batches) {
      const promises = batch.map(endpoint => this.testEndpoint(endpoint));
      const results = await Promise.all(promises);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const endpoint = batch[i];

        this.results.push(result);

        if (result.passed) {
          this.metrics.passed++;
          console.log(`✅ ${endpoint.name || endpoint.path}: ${result.status} (${result.responseTime}ms)`);
        } else {
          this.metrics.failed++;
          console.log(`❌ ${endpoint.name || endpoint.path}: ${result.reason}`);
        }

        this.metrics.responseTimes.push(result.responseTime);
      }
    }
  }

  /**
   * Test a single endpoint
   *
   * @param {Object} endpoint - Endpoint configuration
   * @returns {Promise<Object>} Test result
   */
  async testEndpoint(endpoint) {
    const startTime = performance.now();

    try {
      const response = await this.makeRequest(endpoint);
      const responseTime = Math.round(performance.now() - startTime);

      // Validate status code
      const statusMatches = response.statusCode === endpoint.expectedStatus;

      // Validate SLA
      const sla = endpoint.sla || this.config.timeout;
      const slaMatches = responseTime <= sla;

      // Validate response structure
      let responseValid = true;
      if (endpoint.validateResponse && response.data) {
        responseValid = this.validateResponse(response.data, endpoint.validateResponse);
      }

      const passed = statusMatches && slaMatches && responseValid;

      return {
        endpoint: endpoint.path,
        name: endpoint.name || endpoint.path,
        method: endpoint.method,
        status: response.statusCode,
        expectedStatus: endpoint.expectedStatus,
        responseTime,
        sla,
        passed,
        reason: passed
          ? `Endpoint healthy (${responseTime}ms)`
          : this.buildFailureReason(statusMatches, slaMatches, responseValid, responseTime, sla)
      };

    } catch (error) {
      const responseTime = Math.round(performance.now() - startTime);

      return {
        endpoint: endpoint.path,
        name: endpoint.name || endpoint.path,
        method: endpoint.method,
        status: error.statusCode || null,
        expectedStatus: endpoint.expectedStatus,
        responseTime,
        sla: endpoint.sla || this.config.timeout,
        passed: false,
        reason: `Request failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Make HTTP request with retries
   *
   * @param {Object} endpoint - Endpoint configuration
   * @returns {Promise<Object>} HTTP response
   */
  async makeRequest(endpoint, attempt = 1) {
    try {
      const url = new URL(endpoint.path, this.config.baseUrl);

      // Add query parameters
      if (endpoint.query) {
        for (const [key, value] of Object.entries(endpoint.query)) {
          url.searchParams.append(key, value);
        }
      }

      const protocol = url.protocol === 'https:' ? https : http;

      const options = {
        method: endpoint.method || 'GET',
        headers: {
          'User-Agent': 'SmokeTestAPI/1.0',
          'Accept': 'application/json',
          ...this.config.headers,
          ...endpoint.headers
        },
        timeout: endpoint.timeout || this.config.timeout
      };

      // Add authentication
      if (this.config.auth) {
        if (this.config.auth.type === 'bearer') {
          options.headers['Authorization'] = `Bearer ${this.config.auth.token}`;
        } else if (this.config.auth.type === 'basic') {
          const credentials = Buffer.from(`${this.config.auth.username}:${this.config.auth.password}`).toString('base64');
          options.headers['Authorization'] = `Basic ${credentials}`;
        } else if (this.config.auth.type === 'apikey') {
          const headerName = this.config.auth.headerName || 'X-API-Key';
          options.headers[headerName] = this.config.auth.apiKey;
        }
      }

      if (this.config.debug) {
        console.log(`[DEBUG] ${options.method} ${url.href}`);
      }

      const response = await this.httpRequest(protocol, url, options, endpoint.body);

      if (this.config.debug) {
        console.log(`[DEBUG] Response: ${response.statusCode} (${response.data?.length || 0} bytes)`);
      }

      return response;

    } catch (error) {
      // Retry logic
      if (attempt < this.config.retries) {
        console.log(`   ⚠️  Retry ${attempt}/${this.config.retries} for ${endpoint.path}`);
        await this.delay(this.config.retryDelay * attempt);
        return this.makeRequest(endpoint, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Make HTTP request
   *
   * @param {Object} protocol - HTTP or HTTPS protocol module
   * @param {URL} url - Request URL
   * @param {Object} options - Request options
   * @param {Object} body - Request body
   * @returns {Promise<Object>} HTTP response
   */
  httpRequest(protocol, url, options, body) {
    return new Promise((resolve, reject) => {
      const req = protocol.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          let parsedData = null;

          try {
            if (data && res.headers['content-type']?.includes('application/json')) {
              parsedData = JSON.parse(data);
            }
          } catch (error) {
            // Ignore JSON parse errors
          }

          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: parsedData || data
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // Send body if present
      if (body) {
        const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(bodyData);
      }

      req.end();
    });
  }

  /**
   * Validate response structure
   *
   * @param {Object} data - Response data
   * @param {Array<Object>} validators - Validation rules
   * @returns {boolean} True if valid
   */
  validateResponse(data, validators) {
    for (const validator of validators) {
      const value = this.getNestedValue(data, validator.field);

      // Check type
      if (validator.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== validator.type) {
          return false;
        }
      }

      // Check value
      if (validator.value !== undefined && value !== validator.value) {
        return false;
      }

      // Check min/max
      if (validator.min !== undefined && value < validator.min) {
        return false;
      }
      if (validator.max !== undefined && value > validator.max) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get nested value from object
   *
   * @param {Object} obj - Object to search
   * @param {string} path - Dot-separated path
   * @returns {*} Value at path
   */
  getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Build failure reason message
   *
   * @param {boolean} statusMatches - Status code matches
   * @param {boolean} slaMatches - SLA matches
   * @param {boolean} responseValid - Response structure valid
   * @param {number} responseTime - Actual response time
   * @param {number} sla - Target SLA
   * @returns {string} Failure reason
   */
  buildFailureReason(statusMatches, slaMatches, responseValid, responseTime, sla) {
    const reasons = [];

    if (!statusMatches) {
      reasons.push('unexpected status code');
    }
    if (!slaMatches) {
      reasons.push(`exceeded SLA (${responseTime}ms > ${sla}ms)`);
    }
    if (!responseValid) {
      reasons.push('invalid response structure');
    }

    return `Endpoint failed: ${reasons.join(', ')}`;
  }

  /**
   * Build final result
   *
   * @returns {Object} Execution result
   */
  buildResult() {
    const allPassed = this.metrics.failed === 0;

    // Calculate response time statistics
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? Math.round(this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length)
      : 0;

    return {
      passed: allPassed,
      details: {
        totalEndpoints: this.metrics.totalEndpoints,
        passed: this.metrics.passed,
        failed: this.metrics.failed,
        executionTime: this.metrics.executionTime
      },
      reason: allPassed
        ? `API smoke tests passed: All ${this.metrics.passed} endpoints responding`
        : `API smoke tests failed: ${this.metrics.failed} of ${this.metrics.totalEndpoints} endpoints failed`,
      metrics: {
        endpointsPassed: this.metrics.passed,
        endpointsFailed: this.metrics.failed,
        averageResponseTime: avgResponseTime,
        executionTime: this.metrics.executionTime
      },
      results: this.results
    };
  }

  /**
   * Create batches for parallel execution
   *
   * @param {Array} items - Items to batch
   * @param {number} batchSize - Batch size
   * @returns {Array<Array>} Batches
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Delay helper
   *
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Export class
 */
module.exports = { SmokeTestAPI };

/**
 * CLI usage example:
 *
 * const { SmokeTestAPI } = require('./execute-health-checks.js');
 *
 * const tester = new SmokeTestAPI({
 *   baseUrl: 'https://staging.example.com',
 *   timeout: 5000,
 *   retries: 2
 * });
 *
 * const result = await tester.executeHealthChecks({
 *   environment: 'staging',
 *   endpoints: [
 *     { path: '/health', method: 'GET', expectedStatus: 200, sla: 100 },
 *     { path: '/api/v1/users', method: 'GET', expectedStatus: 200, sla: 500 }
 *   ]
 * });
 *
 * if (result.passed) {
 *   console.log('✅ API smoke tests passed');
 *   console.log(`Endpoints tested: ${result.details.totalEndpoints}`);
 *   console.log(`Execution time: ${result.details.executionTime}ms`);
 * } else {
 *   console.error('❌ API smoke tests failed');
 *   console.error(`Reason: ${result.reason}`);
 *   result.results.forEach(r => {
 *     if (!r.passed) {
 *       console.log(`  ${r.endpoint}: ${r.reason}`);
 *     }
 *   });
 * }
 */
