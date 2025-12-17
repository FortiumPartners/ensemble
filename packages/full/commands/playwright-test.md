---
name: ensemble:playwright-test
description: Automated E2E testing and error resolution using Playwright
---

Automated application testing and error resolution using Playwright MCP integration.

## Mission

Execute E2E tests with Playwright:
- Generate test specifications
- Execute tests with trace capture
- Analyze failures
- Provide debugging context

## Workflow

1. **Test Planning**
   - Identify critical user flows to test
   - Generate Playwright test specifications

2. **Test Execution**
   - Execute Playwright tests with trace capture
   - Analyze test results and capture failures

3. **Error Resolution**
   - Analyze failure screenshots and traces
   - Implement fixes for identified issues

## Usage

```
/ensemble:playwright-test <application URL or test configuration>
```

## Expected Input

- **Application URL** (required): URL of application to test
- **User Flows** (optional): Specific flows to test

## Expected Output

- Test Report: Pass/fail status for all tests
- Traces: Playwright traces for failed tests
- Screenshots: Failure screenshots for debugging

Delegates to `playwright-tester` agent.
