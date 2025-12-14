# @fortium/ensemble-jest

Jest testing framework integration for Claude Code AI-Mesh ecosystem.

## Description

The Jest plugin provides comprehensive test execution and generation capabilities for JavaScript and TypeScript projects. It enables AI-powered test creation, execution, and analysis with support for unit, integration, and E2E testing patterns.

## Installation

### Via Claude Marketplace

```bash
claude plugin install @fortium/ensemble-jest
```

### Manual Installation

```bash
git clone https://github.com/FortiumPartners/ensemble.git
cd ensemble/packages/jest
claude plugin install .
```

## Features

- **Test Generation**: Automatically generate Jest test files from bug reports or feature descriptions
- **Test Execution**: Run Jest tests with structured output parsing and detailed failure reports
- **Multiple Test Types**: Support for unit, integration, and E2E test patterns
- **Framework Support**: React, Node.js, Express, and generic JavaScript/TypeScript
- **Template-Based**: Customizable templates for different testing scenarios
- **JSON Output**: Structured results for easy integration with CI/CD pipelines
- **Coverage Reports**: Execute tests with coverage analysis

## Usage

### Test Generation

Generate a test file from a source file:

```bash
# Basic unit test generation
node lib/generate-test.js \
  --source src/components/Button.js \
  --output tests/components/Button.test.js \
  --type unit \
  --description "Button component click handling"

# React component test
node lib/generate-test.js \
  --source src/components/UserProfile.jsx \
  --output tests/components/UserProfile.test.jsx \
  --type unit \
  --framework react \
  --description "User profile displays user information"

# Integration test
node lib/generate-test.js \
  --source src/services/UserService.js \
  --output tests/services/UserService.integration.test.js \
  --type integration \
  --description "User service integrates with database"
```

#### Generation Options

- `--source <path>` - Source file to test (required)
- `--output <path>` - Output test file path (required)
- `--type <unit|integration|e2e>` - Test type (default: unit)
- `--description <text>` - Bug description or test purpose
- `--framework <react|node|express>` - Framework-specific patterns

#### Generation Output

```json
{
  "success": true,
  "testFile": "tests/components/Button.test.js",
  "testCount": 3,
  "template": "unit-test",
  "framework": "react"
}
```

### Test Execution

Run Jest tests with structured output:

```bash
# Run a single test file
node lib/run-test.js \
  --file tests/components/Button.test.js

# Run with custom config
node lib/run-test.js \
  --file tests/components/Button.test.js \
  --config jest.config.js

# Run with coverage
node lib/run-test.js \
  --file tests/components/Button.test.js \
  --coverage
```

#### Execution Options

- `--file <path>` - Test file to execute (required)
- `--config <path>` - Jest config file (optional)
- `--coverage` - Run with coverage report
- `--watch` - Run in watch mode (not recommended for CI)

#### Execution Output

```json
{
  "success": false,
  "passed": 2,
  "failed": 1,
  "total": 3,
  "duration": 1.234,
  "failures": [
    {
      "test": "Button handles click events",
      "error": "Expected onClick to be called with: [\"click\"], but it was called with: []",
      "file": "tests/components/Button.test.js",
      "line": 15
    }
  ]
}
```

### Programmatic Usage

The plugin can also be used programmatically in Node.js:

```javascript
const { generateTest, runTest } = require('@fortium/ensemble-jest/lib');

// Generate a test file
async function createTest() {
  const result = await generateTest({
    source: 'src/utils/calculator.js',
    output: 'tests/utils/calculator.test.js',
    type: 'unit',
    description: 'Calculator addition and subtraction'
  });
  console.log('Generated:', result.testFile);
}

// Run tests
async function executeTest() {
  const result = await runTest({
    file: 'tests/utils/calculator.test.js',
    coverage: true
  });
  console.log(`Tests: ${result.passed}/${result.total} passed`);
}
```

## Directory Structure

```
packages/jest/
├── .claude-plugin/
│   └── plugin.json          # Plugin configuration
├── agents/                   # Agent definitions (future)
├── commands/                 # Command definitions (future)
├── lib/                      # Implementation utilities
│   ├── index.js             # Main entry point with exports
│   ├── generate-test.js     # Test generator
│   └── run-test.js          # Test runner
├── skills/                   # Skill documentation
│   ├── SKILL.md             # Quick reference guide
│   ├── REFERENCE.md         # Comprehensive API reference
│   └── templates/           # Test file templates
│       ├── unit-test.template.js
│       └── integration-test.template.js
├── tests/                    # Plugin tests (future)
├── CHANGELOG.md             # Version history
├── package.json             # NPM package configuration
└── README.md                # This file
```

## Integration with Deep Debugger

This plugin is designed to work seamlessly with the `deep-debugger` agent for AI-powered debugging workflows:

1. **Bug Report Analysis**: Deep debugger receives a bug report
2. **Framework Detection**: Identifies Jest as the testing framework
3. **Test Generation**: Uses `generate-test.js` to create failing test
4. **Validation**: Runs `run-test.js` to verify test fails consistently
5. **Fix Implementation**: Delegates fix to appropriate specialist agent
6. **Verification**: Re-runs test to verify fix resolves the issue

## Test Templates

### Unit Test Template

Designed for testing individual functions or components in isolation:

```javascript
describe('ComponentName', () => {
  beforeEach(() => {
    // Setup code
  });

  it('test description', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

### Integration Test Template

Designed for testing multiple components working together:

```javascript
describe('ServiceName Integration Tests', () => {
  beforeAll(async () => {
    // One-time setup (database, server)
  });

  it('test description', async () => {
    // Arrange - Setup multiple components
    // Act - Execute integration workflow
    // Assert - Verify integration behavior
  });
});
```

## Framework-Specific Patterns

### React Components

```javascript
import { render, fireEvent, screen } from '@testing-library/react';
import { Button } from '../components/Button';

describe('Button', () => {
  it('handles click events', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByText('Click me'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

### Node.js/Express APIs

```javascript
const request = require('supertest');
const app = require('../app');

describe('GET /api/users', () => {
  it('returns list of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });
});
```

## Dependencies

This plugin requires Jest to be installed in your project:

```bash
# Basic Jest setup
npm install --save-dev jest @types/jest

# For React testing
npm install --save-dev @testing-library/react @testing-library/jest-dom

# For Node.js/Express API testing
npm install --save-dev supertest
```

## Configuration

Recommended `jest.config.js` for optimal test execution:

```javascript
module.exports = {
  testEnvironment: 'node', // or 'jsdom' for browser
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    }
  },
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.test.{js,jsx,ts,tsx}',
    '!src/**/*.spec.{js,jsx,ts,tsx}'
  ],
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[tj]s?(x)'
  ]
};
```

## Error Handling

The plugin provides structured error output for easy debugging:

### Generation Errors

```json
{
  "success": false,
  "error": "Source file not found",
  "file": "src/components/Missing.js"
}
```

### Execution Errors

```json
{
  "success": false,
  "error": "Jest configuration not found",
  "config": "jest.config.js"
}
```

## Documentation

- **[SKILL.md](skills/SKILL.md)**: Quick reference guide for using the Jest skill
- **[REFERENCE.md](skills/REFERENCE.md)**: Comprehensive API reference and best practices

## Plugin Dependencies

- `ensemble-quality@4.0.0` - Quality assurance and testing infrastructure

## Contributing

See the [main ensemble repository](https://github.com/FortiumPartners/ensemble) for contribution guidelines.

## Version History

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

## License

MIT

## Support

For issues, questions, or contributions:
- **Email**: support@fortiumpartners.com
- **Repository**: https://github.com/FortiumPartners/ensemble
- **Documentation**: See [skills/](skills/) directory for detailed guides

## Related Plugins

- `@fortium/ensemble-quality` - Quality assurance infrastructure
- `@fortium/ensemble-playwright` - E2E testing with Playwright
- `@fortium/ensemble-vitest` - Vitest testing framework integration
