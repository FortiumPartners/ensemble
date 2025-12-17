# Jest Test Framework - API Reference

This document provides detailed API reference and best practices for the Jest test skill.

## Jest Configuration

### jest.config.js

Recommended Jest configuration for optimal test execution:

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

## Test Matchers

### Common Matchers

- `expect(value).toBe(expected)` - Strict equality (===)
- `expect(value).toEqual(expected)` - Deep equality
- `expect(value).toBeTruthy()` / `.toBeFalsy()` - Boolean coercion
- `expect(value).toBeNull()` - Null check
- `expect(value).toBeUndefined()` - Undefined check
- `expect(value).toBeDefined()` - Defined check

### Numeric Matchers

- `expect(value).toBeGreaterThan(number)`
- `expect(value).toBeLessThan(number)`
- `expect(value).toBeCloseTo(number, precision)`

### String Matchers

- `expect(string).toMatch(regexp)`
- `expect(string).toContain(substring)`

### Array/Object Matchers

- `expect(array).toContain(item)`
- `expect(array).toHaveLength(number)`
- `expect(object).toHaveProperty(key, value)`
- `expect(object).toMatchObject(subset)`

### Exception Matchers

- `expect(() => fn()).toThrow()`
- `expect(() => fn()).toThrow(Error)`
- `expect(() => fn()).toThrow('error message')`

## Mock Functions

### Creating Mocks

```javascript
const mockFn = jest.fn();
const mockFnWithReturn = jest.fn().mockReturnValue(42);
const mockFnWithPromise = jest.fn().mockResolvedValue(data);
```

### Mock Assertions

```javascript
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(2);
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
expect(mockFn).toHaveBeenLastCalledWith(arg1, arg2);
```

## Async Testing

### Promises

```javascript
it('works with promises', () => {
  return fetchData().then(data => {
    expect(data).toBe('peanut butter');
  });
});

it('works with async/await', async () => {
  const data = await fetchData();
  expect(data).toBe('peanut butter');
});
```

### Resolves/Rejects

```javascript
it('resolves to peanut butter', () => {
  return expect(fetchData()).resolves.toBe('peanut butter');
});

it('rejects with error', () => {
  return expect(fetchData()).rejects.toThrow('error');
});
```

## Setup and Teardown

### Lifecycle Hooks

- `beforeAll(() => {})` - Runs once before all tests
- `beforeEach(() => {})` - Runs before each test
- `afterEach(() => {})` - Runs after each test
- `afterAll(() => {})` - Runs once after all tests

## Test Organization

### describe Blocks

```javascript
describe('Calculator', () => {
  describe('addition', () => {
    it('adds two numbers', () => {
      expect(add(1, 2)).toBe(3);
    });
  });

  describe('subtraction', () => {
    it('subtracts two numbers', () => {
      expect(subtract(5, 3)).toBe(2);
    });
  });
});
```

### test.each for Parameterized Tests

```javascript
test.each([
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
])('add(%i, %i) returns %i', (a, b, expected) => {
  expect(add(a, b)).toBe(expected);
});
```

## Best Practices

### 1. Arrange-Act-Assert Pattern

```javascript
it('creates a user', () => {
  // Arrange
  const userData = { name: 'John', email: 'john@example.com' };

  // Act
  const user = createUser(userData);

  // Assert
  expect(user.name).toBe('John');
  expect(user.email).toBe('john@example.com');
});
```

### 2. Test One Thing

```javascript
// Bad - tests multiple things
it('handles user creation and deletion', () => {
  const user = createUser(data);
  expect(user).toBeDefined();

  deleteUser(user.id);
  expect(getUser(user.id)).toBeNull();
});

// Good - split into separate tests
it('creates a user', () => {
  const user = createUser(data);
  expect(user).toBeDefined();
});

it('deletes a user', () => {
  const user = createUser(data);
  deleteUser(user.id);
  expect(getUser(user.id)).toBeNull();
});
```

### 3. Descriptive Test Names

```javascript
// Bad
it('works', () => { /* ... */ });

// Good
it('returns user data when valid ID is provided', () => { /* ... */ });
```

### 4. Avoid Test Interdependence

```javascript
// Bad - tests depend on order
let user;
it('creates user', () => {
  user = createUser(data);
});
it('updates user', () => {
  updateUser(user.id, newData); // Depends on previous test
});

// Good - each test is independent
it('creates user', () => {
  const user = createUser(data);
  expect(user).toBeDefined();
});
it('updates user', () => {
  const user = createUser(data);
  updateUser(user.id, newData);
  expect(getUser(user.id).name).toBe(newData.name);
});
```

## Coverage Reports

### Generating Coverage

```bash
jest --coverage
```

### Coverage Thresholds

Configure in jest.config.js:

```javascript
coverageThreshold: {
  global: {
    statements: 80,
    branches: 70,
    functions: 80,
    lines: 80
  },
  './src/critical/': {
    statements: 100,
    branches: 100
  }
}
```

## Debugging Tests

### Running Specific Tests

```bash
# Run only tests matching pattern
jest Button

# Run only one test file
jest path/to/test.js

# Run tests in watch mode
jest --watch
```

### Using debugger

```javascript
it('debugs a test', () => {
  debugger; // Pause execution here
  const result = someFunction();
  expect(result).toBe(expected);
});
```

Run with:
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Performance Optimization

### Parallel Execution

Jest runs tests in parallel by default. For sequential execution:

```bash
jest --runInBand
```

### Selective Test Execution

```bash
# Only run changed tests
jest --onlyChanged

# Only run related tests
jest --findRelatedTests src/utils.js
```

## Common Pitfalls

### 1. Forgetting to Return Promises

```javascript
// Bad - test completes before promise resolves
it('fetches data', () => {
  fetchData().then(data => {
    expect(data).toBe('peanut butter');
  });
});

// Good - return the promise
it('fetches data', () => {
  return fetchData().then(data => {
    expect(data).toBe('peanut butter');
  });
});
```

### 2. Incorrect Async Syntax

```javascript
// Bad - missing await
it('fetches data', async () => {
  const data = fetchData(); // Missing await!
  expect(data).toBe('peanut butter');
});

// Good
it('fetches data', async () => {
  const data = await fetchData();
  expect(data).toBe('peanut butter');
});
```

### 3. Testing Implementation Details

```javascript
// Bad - tests internal implementation
it('uses array to store items', () => {
  const cart = new ShoppingCart();
  expect(cart.items).toBeInstanceOf(Array);
});

// Good - tests behavior
it('stores added items', () => {
  const cart = new ShoppingCart();
  cart.addItem('apple');
  expect(cart.getItems()).toContain('apple');
});
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)
- [Jest Cheat Sheet](https://github.com/sapegin/jest-cheat-sheet)
