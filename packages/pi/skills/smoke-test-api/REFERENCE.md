# Smoke Test API - Comprehensive Reference

**Load this for detailed implementation patterns and advanced use cases**

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Configuration Reference](#configuration-reference)
3. [Testing Patterns](#testing-patterns)
4. [Error Handling](#error-handling)
5. [Performance Optimization](#performance-optimization)
6. [Multi-Environment Testing](#multi-environment-testing)
7. [Integration Patterns](#integration-patterns)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Test Execution Flow

```
1. Load Configuration
   ↓
2. Initialize HTTP Client
   ↓
3. Execute Endpoints Sequentially
   ↓
4. Validate Responses
   ↓
5. Collect Metrics
   ↓
6. Generate Report
   ↓
7. Return Pass/Fail Result
```

### Components

- **SmokeTestAPI**: Main orchestrator class
- **HTTPClient**: Configurable HTTP client with retries
- **ResponseValidator**: Validates status codes, response structure, SLAs
- **MetricsCollector**: Collects response times, success/failure counts
- **ReportGenerator**: Generates human-readable reports

---

## Configuration Reference

### Complete Configuration Schema

```yaml
# Environment configuration
environment: staging
baseUrl: https://staging.example.com

# Global settings
timeout: 5000           # Global timeout in milliseconds
retries: 2              # Number of retries for failed requests
retryDelay: 1000        # Delay between retries in milliseconds
validateSSL: true       # Validate SSL certificates
followRedirects: true   # Follow HTTP redirects

# Authentication
auth:
  type: bearer          # Auth type: bearer, basic, apikey
  token: ${AUTH_TOKEN}  # Environment variable reference
  # OR for basic auth:
  # username: ${API_USER}
  # password: ${API_PASS}
  # OR for API key:
  # apiKey: ${API_KEY}
  # headerName: X-API-Key

# Global headers
headers:
  User-Agent: SmokeTestAPI/1.0
  Accept: application/json
  Content-Type: application/json

# Endpoints to test
endpoints:
  # Health check endpoint
  - name: system-health
    path: /health
    method: GET
    expectedStatus: 200
    sla: 100
    validateResponse:
      - field: status
        value: ok
      - field: database
        value: connected

  # Database health check
  - name: database-health
    path: /health/db
    method: GET
    expectedStatus: 200
    sla: 200
    validateResponse:
      - field: connected
        value: true

  # Create resource
  - name: create-user
    path: /api/v1/users
    method: POST
    expectedStatus: 201
    sla: 1000
    body:
      name: Smoke Test User
      email: smoketest@example.com
    validateResponse:
      - field: id
        type: string
      - field: email
        value: smoketest@example.com

  # Read resource
  - name: get-users
    path: /api/v1/users
    method: GET
    expectedStatus: 200
    sla: 500
    validateResponse:
      - field: data
        type: array
      - field: pagination.total
        type: number

  # Search operation
  - name: search-users
    path: /api/v1/search
    method: GET
    expectedStatus: 200
    sla: 2000
    query:
      q: test
      limit: 10
    validateResponse:
      - field: results
        type: array

  # Error handling test
  - name: not-found-test
    path: /api/v1/nonexistent
    method: GET
    expectedStatus: 404
    sla: 100

# Performance SLA targets
slaTargets:
  health: 100       # Health endpoints
  read: 500         # Read operations
  write: 1000       # Write operations
  search: 2000      # Search operations
  default: 5000     # Default timeout

# Failure handling
failureHandling:
  stopOnFirstFailure: false   # Continue testing after failures
  reportAllFailures: true     # Report all failures, not just first
  includeStackTraces: false   # Include stack traces in report
```

---

## Testing Patterns

### Pattern 1: Sequential Health Checks

Test critical endpoints in order, stopping on first failure:

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  stopOnFirstFailure: true
});

const result = await tester.executeHealthChecks({
  environment: 'staging',
  endpoints: [
    { path: '/health', method: 'GET', expectedStatus: 200, sla: 100 },
    { path: '/health/db', method: 'GET', expectedStatus: 200, sla: 200 },
    { path: '/health/cache', method: 'GET', expectedStatus: 200, sla: 200 }
  ]
});
```

### Pattern 2: Parallel Health Checks

Test multiple endpoints in parallel for faster execution:

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  parallel: true,
  maxConcurrency: 5
});

const result = await tester.executeHealthChecks({
  environment: 'staging',
  endpoints: [
    { path: '/health', method: 'GET', expectedStatus: 200, sla: 100 },
    { path: '/api/v1/users', method: 'GET', expectedStatus: 200, sla: 500 },
    { path: '/api/v1/products', method: 'GET', expectedStatus: 200, sla: 500 },
    { path: '/api/v1/orders', method: 'GET', expectedStatus: 200, sla: 500 }
  ]
});
```

### Pattern 3: Authenticated Requests

Test endpoints requiring authentication:

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  auth: {
    type: 'bearer',
    token: process.env.AUTH_TOKEN
  }
});

const result = await tester.executeHealthChecks({
  environment: 'staging',
  endpoints: [
    {
      path: '/api/v1/protected',
      method: 'GET',
      expectedStatus: 200,
      sla: 500
    }
  ]
});
```

### Pattern 4: CRUD Operation Testing

Test complete CRUD cycle:

```javascript
const endpoints = [
  // Create
  {
    name: 'create-resource',
    path: '/api/v1/resources',
    method: 'POST',
    expectedStatus: 201,
    sla: 1000,
    body: { name: 'Test Resource' },
    saveResponse: 'resourceId'  // Save ID for subsequent tests
  },
  // Read
  {
    name: 'read-resource',
    path: '/api/v1/resources/${resourceId}',  // Use saved ID
    method: 'GET',
    expectedStatus: 200,
    sla: 500
  },
  // Update
  {
    name: 'update-resource',
    path: '/api/v1/resources/${resourceId}',
    method: 'PUT',
    expectedStatus: 200,
    sla: 1000,
    body: { name: 'Updated Resource' }
  },
  // Delete
  {
    name: 'delete-resource',
    path: '/api/v1/resources/${resourceId}',
    method: 'DELETE',
    expectedStatus: 204,
    sla: 500
  }
];

const result = await tester.executeHealthChecks({
  environment: 'staging',
  endpoints
});
```

### Pattern 5: Response Validation

Validate response structure and content:

```javascript
const result = await tester.testEndpoint({
  path: '/api/v1/users',
  method: 'GET',
  expectedStatus: 200,
  sla: 500,
  validateResponse: [
    { field: 'data', type: 'array' },
    { field: 'pagination.total', type: 'number', min: 0 },
    { field: 'pagination.page', value: 1 },
    { field: 'pagination.limit', value: 10 }
  ]
});
```

---

## Error Handling

### Retry Logic with Exponential Backoff

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  retries: 3,
  retryDelay: 1000,
  retryMultiplier: 2,  // Exponential backoff: 1s, 2s, 4s
  retryOnStatusCodes: [500, 502, 503, 504]  // Retry only on server errors
});

const result = await tester.executeHealthChecks({
  environment: 'staging',
  endpoints: [
    { path: '/health', method: 'GET', expectedStatus: 200, sla: 100 }
  ]
});
```

### Circuit Breaker Pattern

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,      // Open circuit after 3 failures
    successThreshold: 2,      // Close circuit after 2 successes
    timeout: 30000,           // Half-open state after 30 seconds
    resetTimeout: 60000       // Reset circuit after 60 seconds
  }
});
```

### Timeout Handling

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  timeout: 5000,              // Global timeout
  endpointTimeouts: {
    '/health': 100,           // Override for specific endpoints
    '/api/v1/search': 2000
  }
});
```

---

## Performance Optimization

### Connection Pooling

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  connectionPool: {
    enabled: true,
    maxConnections: 10,       // Max connections in pool
    keepAlive: true,          // Keep connections alive
    keepAliveMsecs: 1000      // Keep-alive timeout
  }
});
```

### Caching

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  cache: {
    enabled: true,
    ttl: 60000,               // Cache TTL: 60 seconds
    maxSize: 100              // Max cached responses
  }
});
```

### Compression

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  compression: true,          // Enable gzip/deflate compression
  headers: {
    'Accept-Encoding': 'gzip, deflate'
  }
});
```

---

## Multi-Environment Testing

### Environment-Specific Configurations

```javascript
const environments = {
  preRelease: {
    baseUrl: 'https://pre-release.example.com',
    auth: { token: process.env.PRE_RELEASE_TOKEN }
  },
  staging: {
    baseUrl: 'https://staging.example.com',
    auth: { token: process.env.STAGING_TOKEN }
  },
  canary: {
    baseUrl: 'https://canary.example.com',
    auth: { token: process.env.CANARY_TOKEN }
  },
  production: {
    baseUrl: 'https://api.example.com',
    auth: { token: process.env.PRODUCTION_TOKEN }
  }
};

// Test across multiple environments
for (const [env, config] of Object.entries(environments)) {
  console.log(`Testing ${env}...`);
  const tester = new SmokeTestAPI(config);
  const result = await tester.executeHealthChecks({
    environment: env,
    endpoints: commonEndpoints
  });

  if (!result.passed) {
    console.error(`❌ ${env} failed: ${result.reason}`);
    break;
  }
}
```

### Canary Testing Pattern

```javascript
// Test canary with 5% traffic
const canaryResult = await tester.executeHealthChecks({
  environment: 'canary-5',
  baseUrl: 'https://canary.example.com',
  endpoints: criticalEndpoints,
  samplingRate: 0.05  // Only test 5% of requests
});

if (canaryResult.passed) {
  console.log('✅ Canary 5% healthy, promoting to 25%...');
  // Continue with 25% and 100% testing
}
```

---

## Integration Patterns

### Integration with Monitoring Systems

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  monitoring: {
    enabled: true,
    provider: 'datadog',  // Or 'prometheus', 'cloudwatch', etc.
    metrics: {
      namespace: 'smoke-tests',
      tags: {
        environment: 'staging',
        service: 'api'
      }
    }
  }
});

// Metrics automatically published to monitoring system
const result = await tester.executeHealthChecks({
  environment: 'staging',
  endpoints: healthEndpoints
});
```

### Integration with Alerting Systems

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  alerting: {
    enabled: true,
    provider: 'pagerduty',  // Or 'opsgenie', 'slack', etc.
    onFailure: async (result) => {
      // Custom alert logic
      await alerting.sendAlert({
        severity: 'high',
        message: `API smoke tests failed: ${result.reason}`,
        details: result.details
      });
    }
  }
});
```

### Integration with CI/CD Pipelines

```bash
#!/bin/bash
# ci/smoke-tests.sh

# Load environment-specific configuration
export BASE_URL="https://staging.example.com"
export AUTH_TOKEN="${STAGING_API_TOKEN}"

# Execute smoke tests
node skills/smoke-test-api/scripts/execute-health-checks.js \
  --config smoke-test-config.yaml \
  --environment staging \
  --output junit

# Check exit code
if [ $? -ne 0 ]; then
  echo "❌ API smoke tests failed"
  exit 1
fi

echo "✅ API smoke tests passed"
exit 0
```

---

## Troubleshooting

### Common Issues

#### Issue 1: Timeouts

**Symptom**: Tests consistently timing out

**Solutions**:
```javascript
// Increase timeout for slow endpoints
const tester = new SmokeTestAPI({
  timeout: 10000,  // Increase global timeout
  endpointTimeouts: {
    '/api/v1/search': 5000  // Specific endpoint timeout
  }
});

// Or use connection pooling
const tester = new SmokeTestAPI({
  connectionPool: {
    enabled: true,
    keepAlive: true
  }
});
```

#### Issue 2: SSL Certificate Errors

**Symptom**: SSL certificate validation failures in staging

**Solutions**:
```javascript
// Disable SSL validation for staging (NOT for production!)
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  validateSSL: false  // Only for non-production environments
});
```

#### Issue 3: Rate Limiting

**Symptom**: 429 Too Many Requests errors

**Solutions**:
```javascript
// Add rate limiting with delay between requests
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  rateLimiting: {
    enabled: true,
    requestsPerSecond: 10,  // Max 10 requests per second
    delayBetweenRequests: 100  // 100ms delay between requests
  }
});
```

#### Issue 4: Flaky Tests

**Symptom**: Tests randomly failing

**Solutions**:
```javascript
// Add retries with exponential backoff
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  retries: 3,
  retryDelay: 1000,
  retryMultiplier: 2,
  jitter: true  // Add random jitter to retries
});
```

### Debug Mode

```javascript
// Enable debug logging
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  debug: true,  // Verbose logging
  logLevel: 'debug',  // Log level: debug, info, warn, error
  logRequests: true,  // Log all HTTP requests
  logResponses: true  // Log all HTTP responses
});
```

---

## Advanced Use Cases

### Custom Response Validators

```javascript
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  customValidators: {
    // Validate response time is within SLA
    slaValidator: (response, sla) => {
      return response.duration <= sla;
    },
    // Validate response structure
    structureValidator: (response, schema) => {
      return validateSchema(response.data, schema);
    },
    // Custom business logic validation
    businessLogicValidator: (response, rules) => {
      return validateBusinessRules(response.data, rules);
    }
  }
});
```

### Load Testing Integration

```javascript
// Combine smoke tests with light load testing
const tester = new SmokeTestAPI({
  baseUrl: 'https://staging.example.com',
  loadTesting: {
    enabled: true,
    concurrentUsers: 10,    // Simulate 10 concurrent users
    requestsPerUser: 5,     // 5 requests per user
    rampUpTime: 5000        // Ramp up over 5 seconds
  }
});
```

### Synthetic Monitoring

```javascript
// Run smoke tests continuously as synthetic monitoring
const tester = new SmokeTestAPI({
  baseUrl: 'https://api.example.com',
  continuous: true,
  interval: 60000,  // Run every 60 seconds
  alerting: {
    enabled: true,
    onFailure: sendAlert
  }
});

// Start continuous monitoring
tester.startMonitoring();
```

---

## Performance Metrics Reference

### Target SLAs by Operation Type

| Operation Type | Target | P95 | P99 | Timeout |
|---------------|--------|-----|-----|---------|
| Health Check  | 100ms  | 150ms | 200ms | 500ms |
| Read (GET)    | 500ms  | 750ms | 1000ms | 2000ms |
| Write (POST/PUT) | 1000ms | 1500ms | 2000ms | 5000ms |
| Search        | 2000ms | 3000ms | 4000ms | 10000ms |

### Metric Collection

```javascript
{
  totalEndpoints: 10,
  passed: 9,
  failed: 1,
  executionTime: 5432,
  averageResponseTime: 234,
  p95ResponseTime: 456,
  p99ResponseTime: 678,
  minResponseTime: 45,
  maxResponseTime: 789,
  throughput: 1.84,  // requests per second
  errorRate: 0.1     // 10% error rate
}
```

---

## See Also

- **smoke-test-database**: Database connectivity and query smoke tests
- **smoke-test-external-services**: External service integration smoke tests
- **smoke-test-auth**: Authentication and authorization smoke tests
- **smoke-test-critical-paths**: Critical user journey smoke tests
- **smoke-test-runner**: Orchestration skill for all smoke test categories
