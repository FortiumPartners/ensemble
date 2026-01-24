# Playwright Skill

End-to-end testing skill for converting legacy applications to automated test suites using Playwright.

## Overview

This skill provides patterns, templates, and examples for building maintainable E2E test suites, with particular emphasis on retrofitting applications that lack proper test infrastructure (missing data-testid attributes, inconsistent selectors, dynamic content).

## Contents

| File | Purpose | Lines |
|------|---------|-------|
| SKILL.md | Core patterns and quick reference | ~500 |
| REFERENCE.md | Advanced topics and deep dives | ~800 |
| VALIDATION.md | Coverage assessment | ~150 |
| templates/ | Reusable code templates | 8 files |
| examples/ | Complete working examples | 5 files |

## Quick Start

1. **Load this skill** when working on E2E testing tasks
2. **Start with SKILL.md** for selector strategies and page object patterns
3. **Consult REFERENCE.md** for authentication, fixtures, and debugging
4. **Copy templates** as starting points for new test files

## Key Topics

### SKILL.md
- Selector strategy hierarchy (resilient to UI changes)
- Page Object Model implementation
- Wait strategies for dynamic content
- Test organization and structure
- Basic assertions and interactions

### REFERENCE.md
- Authentication fixtures and session reuse
- Network interception and mocking
- Visual regression testing
- Debugging with traces and screenshots
- CI/CD integration patterns
- Legacy app retrofitting strategies

## Target Audience

- Developers converting manual QA to automated testing
- Teams working with legacy UIs lacking test infrastructure
- Projects needing reliable, maintainable E2E test suites

## Prerequisites

- Node.js 18+ or 20+
- Playwright Test (`@playwright/test`)
- Basic understanding of async/await patterns

## Related Skills

- **jest** - Unit and integration testing
- **pytest** - Python testing patterns
- **rspec** - Ruby testing patterns

## Version

- Playwright: 1.40+
- Node.js: 18+, 20+
