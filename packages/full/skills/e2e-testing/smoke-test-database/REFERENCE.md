# Smoke Test Database - Comprehensive Reference

**Load this for detailed implementation patterns and advanced use cases**

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Configuration Reference](#configuration-reference)
3. [Testing Patterns](#testing-patterns)
4. [Database-Specific Implementation](#database-specific-implementation)
5. [Performance Optimization](#performance-optimization)
6. [Migration Testing](#migration-testing)
7. [Replication and High Availability](#replication-and-high-availability)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Test Execution Flow

```
1. Load Configuration
   ↓
2. Establish Database Connection
   ↓
3. Execute Test Categories
   ├── Connectivity Tests
   ├── Query Performance Tests
   ├── Schema Validation
   ├── Data Integrity Tests
   ├── Replication Health
   └── Backup Validation
   ↓
4. Collect Metrics
   ↓
5. Generate Report
   ↓
6. Close Connections
   ↓
7. Return Pass/Fail Result
```

### Components

- **SmokeTestDatabase**: Main orchestrator class
- **ConnectionManager**: Manages database connections and pooling
- **QueryExecutor**: Executes queries with performance tracking
- **SchemaValidator**: Validates database schema structure
- **DataIntegrityChecker**: Checks data constraints and relationships
- **ReplicationMonitor**: Monitors replication health and lag
- **BackupValidator**: Validates backup recency and integrity

---

## Configuration Reference

### Complete Configuration Schema

```yaml
# Environment configuration
environment: staging

# Database configuration
database:
  type: postgresql  # Options: postgresql, mysql, mongodb, redis
  host: staging-db.example.com
  port: 5432
  database: app_staging
  username: app_user
  password: ${DB_PASSWORD}  # Environment variable

  # Connection pool settings
  pool:
    min: 2
    max: 10
    idleTimeout: 30000
    connectionTimeout: 5000

  # SSL/TLS configuration
  ssl:
    enabled: true
    rejectUnauthorized: true
    ca: ${DB_SSL_CA}
    cert: ${DB_SSL_CERT}
    key: ${DB_SSL_KEY}

  # Replica configuration (optional)
  replicas:
    - host: staging-db-replica-1.example.com
      port: 5432
    - host: staging-db-replica-2.example.com
      port: 5432

# Test configuration
tests:
  # 1. Connectivity tests
  connectivity:
    enabled: true
    timeout: 5000
    retries: 2
    testReplicas: true

  # 2. Query performance tests
  queryPerformance:
    enabled: true
    queries:
      - name: simple-query
        sql: SELECT 1
        sla: 10

      - name: table-scan
        sql: SELECT * FROM users LIMIT 1
        sla: 50

      - name: join-query
        sql: |
          SELECT u.id, u.email, COUNT(o.id) as order_count
          FROM users u
          LEFT JOIN orders o ON u.id = o.user_id
          GROUP BY u.id, u.email
          LIMIT 10
        sla: 200

      - name: write-operation
        sql: |
          INSERT INTO smoke_test_logs (message, created_at)
          VALUES ('Smoke test', NOW())
          RETURNING id
        sla: 100
        cleanup: DELETE FROM smoke_test_logs WHERE message = 'Smoke test'

  # 3. Schema validation
  schemaValidation:
    enabled: true
    tables:
      - name: users
        columns:
          - name: id
            type: uuid
            nullable: false
            primaryKey: true
          - name: email
            type: varchar
            nullable: false
            unique: true
          - name: created_at
            type: timestamp
            nullable: false
        indexes:
          - name: idx_users_email
            columns: [email]
            unique: true
        constraints:
          - name: users_email_check
            type: CHECK
            definition: email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}$'

      - name: orders
        columns:
          - name: id
            type: uuid
            nullable: false
            primaryKey: true
          - name: user_id
            type: uuid
            nullable: false
            foreignKey:
              table: users
              column: id
              onDelete: CASCADE
          - name: total
            type: numeric
            nullable: false
        indexes:
          - name: idx_orders_user_id
            columns: [user_id]

  # 4. Data integrity tests
  dataIntegrity:
    enabled: true
    checks:
      - name: user-count-check
        description: Verify minimum user count
        query: SELECT COUNT(*) as count FROM users
        validation:
          field: count
          operator: '>='
          value: 100

      - name: orphaned-orders-check
        description: Check for orders without users
        query: |
          SELECT COUNT(*) as count FROM orders o
          WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id)
        validation:
          field: count
          operator: '='
          value: 0

      - name: price-constraint-check
        description: Verify all products have positive prices
        query: SELECT COUNT(*) as count FROM products WHERE price <= 0
        validation:
          field: count
          operator: '='
          value: 0

  # 5. Replication health
  replicationHealth:
    enabled: true
    maxLag: 1000  # Maximum lag in milliseconds
    checkReplicas: true

  # 6. Backup validation
  backupValidation:
    enabled: true
    maxAge: 86400000  # Maximum backup age in milliseconds (24 hours)
    backupPath: /backups/postgres
    verifyChecksum: true

# Performance SLA targets
slaTargets:
  connectivity: 1000      # Connection: ≤1000ms
  simpleQuery: 10         # SELECT 1: ≤10ms
  tableQuery: 50          # Table scan: ≤50ms
  joinQuery: 200          # Multi-table join: ≤200ms
  writeOperation: 100     # INSERT/UPDATE/DELETE: ≤100ms
  replicationLag: 1000    # Replication lag: ≤1000ms
  default: 30000          # Default timeout: ≤30000ms

# Failure handling
failureHandling:
  stopOnFirstFailure: false
  reportAllFailures: true
  includeQueryPlans: true
  includeStackTraces: false
```

---

## Testing Patterns

### Pattern 1: Basic Connectivity Test

```javascript
const tester = new SmokeTestDatabase({
  type: 'postgresql',
  host: 'localhost',
  port: 5432,
  database: 'staging_db',
  username: 'app_user',
  password: process.env.DB_PASSWORD
});

const result = await tester.testConnectivity({
  timeout: 5000,
  retries: 2
});

if (result.passed) {
  console.log('✅ Database connectivity OK');
  console.log(`Connection time: ${result.duration}ms`);
}
```

### Pattern 2: Query Performance Testing

```javascript
const queries = [
  {
    name: 'simple-query',
    sql: 'SELECT 1',
    sla: 10
  },
  {
    name: 'user-lookup',
    sql: 'SELECT * FROM users WHERE id = $1',
    params: ['123e4567-e89b-12d3-a456-426614174000'],
    sla: 50
  },
  {
    name: 'complex-join',
    sql: `
      SELECT u.id, u.email, COUNT(o.id) as order_count
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.created_at > NOW() - INTERVAL '30 days'
      GROUP BY u.id, u.email
      LIMIT 100
    `,
    sla: 200,
    explainAnalyze: true  // Include query plan
  }
];

const result = await tester.testQueryPerformance({ queries });
```

### Pattern 3: Schema Validation

```javascript
const result = await tester.validateSchema({
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar', nullable: false, unique: true },
        { name: 'created_at', type: 'timestamp', nullable: false }
      ],
      indexes: [
        { name: 'idx_users_email', columns: ['email'], unique: true },
        { name: 'idx_users_created_at', columns: ['created_at'] }
      ],
      constraints: [
        { name: 'users_email_check', type: 'CHECK' }
      ]
    }
  ]
});

if (!result.passed) {
  console.error('Schema validation failed:');
  result.failures.forEach(f => {
    console.log(`  ${f.table}.${f.column}: ${f.reason}`);
  });
}
```

### Pattern 4: Data Integrity Testing

```javascript
const result = await tester.validateDataIntegrity({
  checks: [
    {
      name: 'user-count-check',
      query: 'SELECT COUNT(*) as count FROM users',
      validation: { field: 'count', operator: '>=', value: 100 }
    },
    {
      name: 'orphaned-orders-check',
      query: `
        SELECT COUNT(*) as count FROM orders o
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id)
      `,
      validation: { field: 'count', operator: '=', value: 0 }
    },
    {
      name: 'price-constraint-check',
      query: 'SELECT COUNT(*) as count FROM products WHERE price <= 0',
      validation: { field: 'count', operator: '=', value: 0 }
    }
  ]
});
```

### Pattern 5: Replication Health Monitoring

```javascript
const result = await tester.validateReplicationHealth({
  maxLag: 1000,  // Maximum 1 second lag
  replicas: [
    { host: 'replica-1.example.com', port: 5432 },
    { host: 'replica-2.example.com', port: 5432 }
  ]
});

if (!result.passed) {
  console.error('Replication issues detected:');
  result.replicas.forEach(r => {
    console.log(`  ${r.host}: lag ${r.lag}ms (max: ${result.maxLag}ms)`);
  });
}
```

---

## Database-Specific Implementation

### PostgreSQL

#### Connection Configuration

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'app_staging',
  user: 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/ca.pem').toString(),
    cert: fs.readFileSync('/path/to/client-cert.pem').toString(),
    key: fs.readFileSync('/path/to/client-key.pem').toString()
  },
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});
```

#### Schema Validation Queries

```sql
-- Check table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'users'
);

-- Check column exists and type
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'users';

-- Check indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'users';

-- Check constraints
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass;
```

#### Replication Health Queries

```sql
-- Primary: Check replication status
SELECT
  client_addr,
  state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 as lag_ms
FROM pg_stat_replication;

-- Replica: Check replication lag
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 as lag_ms,
  pg_is_in_recovery() as is_replica;
```

### MySQL

#### Connection Configuration

```javascript
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  port: 3306,
  database: 'app_staging',
  user: 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/ca.pem').toString()
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});
```

#### Schema Validation Queries

```sql
-- Check table exists
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'app_staging'
AND TABLE_NAME = 'users';

-- Check columns
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'app_staging'
AND TABLE_NAME = 'users';

-- Check indexes
SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'app_staging'
AND TABLE_NAME = 'users';

-- Check constraints
SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = 'app_staging'
AND TABLE_NAME = 'users';
```

#### Replication Health Queries

```sql
-- Primary: Check replication status
SHOW MASTER STATUS;

-- Replica: Check replication lag
SHOW SLAVE STATUS;

-- Calculate lag in seconds
SELECT
  UNIX_TIMESTAMP() - UNIX_TIMESTAMP(ts) AS lag_seconds
FROM (
  SELECT MAX(ts) AS ts FROM mysql.slave_master_info
) AS replication_lag;
```

### MongoDB

#### Connection Configuration

```javascript
const { MongoClient } = require('mongodb');

const client = new MongoClient('mongodb://localhost:27017', {
  auth: {
    username: 'app_user',
    password: process.env.DB_PASSWORD
  },
  ssl: true,
  sslValidate: true,
  sslCA: fs.readFileSync('/path/to/ca.pem'),
  minPoolSize: 2,
  maxPoolSize: 10,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000
});

await client.connect();
const db = client.db('app_staging');
```

#### Schema Validation

```javascript
// Check collection exists
const collections = await db.listCollections({ name: 'users' }).toArray();
const exists = collections.length > 0;

// Check indexes
const indexes = await db.collection('users').indexes();

// Validate documents against schema
const schema = {
  bsonType: 'object',
  required: ['email', 'createdAt'],
  properties: {
    email: { bsonType: 'string' },
    createdAt: { bsonType: 'date' }
  }
};

await db.command({
  collMod: 'users',
  validator: { $jsonSchema: schema },
  validationLevel: 'strict'
});
```

#### Replication Health

```javascript
// Check replica set status
const status = await client.db('admin').command({ replSetGetStatus: 1 });

// Calculate replication lag
const primary = status.members.find(m => m.stateStr === 'PRIMARY');
const secondaries = status.members.filter(m => m.stateStr === 'SECONDARY');

for (const secondary of secondaries) {
  const lag = (primary.optime.ts.getHighBits() - secondary.optime.ts.getHighBits()) * 1000;
  console.log(`${secondary.name}: lag ${lag}ms`);
}
```

### Redis

#### Connection Configuration

```javascript
const redis = require('redis');

const client = redis.createClient({
  socket: {
    host: 'localhost',
    port: 6379,
    tls: true,
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/ca.pem').toString()
  },
  password: process.env.REDIS_PASSWORD,
  database: 0
});

await client.connect();
```

#### Operations Testing

```javascript
// Test basic operations
const tests = [
  { op: 'SET', key: 'smoke:test', value: '1', sla: 10 },
  { op: 'GET', key: 'smoke:test', sla: 10 },
  { op: 'INCR', key: 'smoke:counter', sla: 10 },
  { op: 'EXPIRE', key: 'smoke:test', seconds: 3600, sla: 10 },
  { op: 'DEL', key: 'smoke:test', sla: 10 }
];

for (const test of tests) {
  const start = performance.now();
  await client[test.op.toLowerCase()](test.key, test.value || test.seconds);
  const duration = performance.now() - start;

  if (duration > test.sla) {
    console.error(`${test.op} exceeded SLA: ${duration}ms > ${test.sla}ms`);
  }
}
```

#### Replication Health

```javascript
// Check replication info
const info = await client.info('replication');
const lines = info.split('\r\n');

const role = lines.find(l => l.startsWith('role:'))?.split(':')[1];
const connectedSlaves = parseInt(lines.find(l => l.startsWith('connected_slaves:'))?.split(':')[1] || '0');

if (role === 'master' && connectedSlaves === 0) {
  console.error('No slaves connected to master');
}

// Check slave lag
if (role === 'slave') {
  const masterLastIO = lines.find(l => l.startsWith('master_last_io_seconds_ago:'))?.split(':')[1];
  const lag = parseInt(masterLastIO || '0') * 1000;

  if (lag > 1000) {
    console.error(`Slave lag too high: ${lag}ms`);
  }
}
```

---

## Performance Optimization

### Connection Pooling

```javascript
// Efficient connection pool configuration
const pool = new Pool({
  min: 2,              // Minimum connections
  max: 10,             // Maximum connections
  idleTimeout: 30000,  // Close idle connections after 30s
  acquireTimeout: 5000 // Max time to acquire connection
});

// Use connection pooling for all queries
async function executeQuery(sql, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();  // Always release connection
  }
}
```

### Query Optimization

```javascript
// Use EXPLAIN ANALYZE to identify slow queries
const result = await client.query('EXPLAIN ANALYZE SELECT * FROM users WHERE email = $1', [email]);
console.log(result.rows[0]['QUERY PLAN']);

// Verify index usage
if (!result.rows[0]['QUERY PLAN'].includes('Index Scan')) {
  console.warn('Query not using index');
}

// Add missing indexes
await client.query('CREATE INDEX CONCURRENTLY idx_users_email ON users (email)');
```

### Parallel Testing

```javascript
// Execute multiple tests in parallel
const tests = [
  tester.testConnectivity(),
  tester.testQueryPerformance({ queries: simpleQueries }),
  tester.validateSchema({ tables: ['users'] }),
  tester.validateDataIntegrity({ checks: integrityChecks })
];

const results = await Promise.all(tests);
const allPassed = results.every(r => r.passed);
```

---

## Migration Testing

### Pre-Migration Validation

```javascript
// Before running migrations, validate current state
const preMigration = await tester.captureSchemaSnapshot({
  tables: ['users', 'orders', 'products'],
  includeData: true,
  dataSample: 1000  // Sample 1000 rows per table
});

// Run migrations
await runMigrations();

// Post-migration validation
const postMigration = await tester.captureSchemaSnapshot({
  tables: ['users', 'orders', 'products'],
  includeData: true,
  dataSample: 1000
});

// Compare snapshots
const diff = tester.compareSnapshots(preMigration, postMigration);
console.log('Schema changes:', diff);
```

### Rollback Testing

```javascript
// Test rollback capability
const result = await tester.testRollback({
  migrations: [
    '20240101000001_add_user_status.sql',
    '20240101000002_add_order_tracking.sql'
  ],
  rollbackTo: '20240101000001_add_user_status.sql'
});

if (result.passed) {
  console.log('✅ Rollback successful');
  console.log(`Schema reverted to: ${result.targetMigration}`);
}
```

---

## Replication and High Availability

### Failover Testing

```javascript
// Test failover to replica
const result = await tester.testFailover({
  primary: { host: 'primary.example.com', port: 5432 },
  replica: { host: 'replica.example.com', port: 5432 },
  timeout: 30000
});

if (result.passed) {
  console.log('✅ Failover successful');
  console.log(`New primary: ${result.newPrimary}`);
  console.log(`Failover time: ${result.duration}ms`);
}
```

### Split-Brain Detection

```javascript
// Detect split-brain scenarios
const result = await tester.detectSplitBrain({
  nodes: [
    { host: 'node-1.example.com', port: 5432 },
    { host: 'node-2.example.com', port: 5432 },
    { host: 'node-3.example.com', port: 5432 }
  ]
});

if (result.splitBrain) {
  console.error('⚠️  Split-brain detected');
  console.log('Multiple primaries:', result.primaries);
}
```

---

## Troubleshooting

### Common Issues

#### Issue 1: Connection Timeouts

**Symptom**: Database connections timing out

**Solutions**:
```javascript
// Increase connection timeout
const tester = new SmokeTestDatabase({
  connectionTimeout: 10000,  // 10 seconds
  retries: 3
});

// Check firewall rules
await tester.testNetworkConnectivity({
  host: 'db.example.com',
  port: 5432
});

// Verify connection pool not exhausted
const poolStats = await tester.getPoolStats();
console.log(`Active: ${poolStats.active}, Idle: ${poolStats.idle}`);
```

#### Issue 2: Slow Queries

**Symptom**: Queries exceeding SLA targets

**Solutions**:
```javascript
// Identify slow queries
const slowQueries = await tester.identifySlowQueries({
  threshold: 1000,  // Queries taking > 1 second
  limit: 10
});

// Check missing indexes
const missingIndexes = await tester.suggestIndexes({
  tables: ['users', 'orders']
});

// Analyze query plans
const plans = await tester.analyzeQueryPlans({
  queries: slowQueries
});
```

#### Issue 3: Replication Lag

**Symptom**: Replica lag exceeding threshold

**Solutions**:
```javascript
// Monitor replication lag over time
const lagHistory = await tester.monitorReplicationLag({
  duration: 60000,  // 1 minute
  interval: 1000    // Check every second
});

// Identify lag causes
const causes = await tester.identifyLagCauses();

// Consider read replica rotation
if (lagHistory.maxLag > 5000) {
  await tester.rotateReadReplicas();
}
```

---

## Advanced Use Cases

### Transaction Testing

```javascript
// Test transaction isolation
const result = await tester.testTransactionIsolation({
  isolationLevel: 'READ COMMITTED',
  scenarios: [
    {
      name: 'dirty-read-test',
      transaction1: [
        'BEGIN',
        'UPDATE users SET balance = balance - 100 WHERE id = $1',
        'COMMIT'
      ],
      transaction2: [
        'BEGIN',
        'SELECT balance FROM users WHERE id = $1',
        'COMMIT'
      ],
      validation: 'No dirty reads detected'
    }
  ]
});
```

### Deadlock Detection

```javascript
// Test deadlock scenarios
const result = await tester.testDeadlockHandling({
  timeout: 5000,
  retries: 3,
  scenarios: [
    {
      name: 'update-order-deadlock',
      queries: [
        'UPDATE orders SET status = $1 WHERE id = $2',
        'UPDATE users SET balance = balance - $1 WHERE id = $2'
      ]
    }
  ]
});
```

---

## See Also

- **smoke-test-api**: API health and endpoint smoke tests
- **smoke-test-external-services**: External service integration smoke tests
- **smoke-test-auth**: Authentication and authorization smoke tests
- **smoke-test-critical-paths**: Critical user journey smoke tests
- **smoke-test-runner**: Orchestration skill for all smoke test categories
