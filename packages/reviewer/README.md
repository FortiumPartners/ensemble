# Reviewer Package

Secondary LLM review CLI for code review and quality gates.

## Purpose

This package provides a secondary LLM review capability that runs after primary implementation to verify:

- Code quality and style compliance
- Security vulnerabilities
- Test coverage requirements
- Documentation completeness

## Structure

```
packages/reviewer/
├── cli/           # Review CLI implementation
│   └── review.js  # Main CLI entry point
└── README.md      # This file
```

## Usage

The reviewer is invoked automatically by the `code-reviewer` agent or can be run manually:

```bash
# Review a specific file
node packages/reviewer/cli/review.js --file src/app.js

# Review all changes in a branch
node packages/reviewer/cli/review.js --branch feature/my-feature
```

## Implementation Status

**Phase 3** - This package is scheduled for implementation in Phase 3 of the TRD.

Current status: Directory structure created, implementation pending.
