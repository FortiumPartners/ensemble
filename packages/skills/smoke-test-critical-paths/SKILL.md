# Smoke Test Critical Paths Skill

**Quick Reference** - Load this first for fast context (~2KB)

## Mission

Execute comprehensive critical user journey smoke tests to validate end-to-end business flows during release workflows.

## Core Capabilities

- **User Registration**: Complete registration flow validation
- **Authentication Journey**: Login → Browse → Action → Logout flow
- **Checkout Flow**: Browse → Add to Cart → Checkout → Payment → Confirmation
- **Search Journey**: Search → Filter → View Results → Detail View
- **Profile Management**: Login → View Profile → Edit → Save → Verify

## Quick Start

```javascript
const { SmokeTestCriticalPaths } = require('./scripts/execute-journeys.js');

const tester = new SmokeTestCriticalPaths({
  baseUrl: 'https://staging.example.com',
  journeys: [
    'registration',
    'checkout',
    'search'
  ]
});

const result = await tester.executeTests({
  environment: 'staging'
});

if (result.passed) {
  console.log('✅ Critical path tests passed');
}
```

## Performance SLAs

```javascript
const SLA_TARGETS = {
  registration: 5000,    // Registration flow: ≤5s
  checkout: 8000,        // Checkout flow: ≤8s
  search: 3000,          // Search flow: ≤3s
  profile: 4000          // Profile management: ≤4s
};
```

## Pass/Fail Criteria

**Pass**: All critical paths must complete successfully
- ✅ All journey steps execute without errors
- ✅ All SLA targets met
- ✅ Data persisted correctly
- ✅ User feedback/confirmations displayed

**Fail**: Any critical path failure blocks deployment
- ❌ Journey step fails or times out
- ❌ Data not persisted
- ❌ Missing confirmations or error states

## Need More Detail?

**Load**: `skills/smoke-test-critical-paths/REFERENCE.md` (~10KB)
