# Changelog Generator - Comprehensive Reference

**Production Patterns and Advanced Configuration**

## Overview

The changelog-generator skill provides comprehensive changelog generation from conventional commits with advanced features including custom categorization, multi-repository support, semantic version suggestion, and multiple output formats. Designed for integration with release workflows and automated version management.

## Architecture

```
changelog-generator/
├── SKILL.md                    # Quick reference (<5KB)
├── REFERENCE.md                # This file
├── scripts/
│   └── generate-changelog.js  # Core generation logic
└── templates/
    └── changelog-config.yaml  # Default configuration
```

## Conventional Commit Specification

### Standard Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Type Categories

| Type | Category | Description | Version Impact |
|------|----------|-------------|----------------|
| `feat` | Features | New feature | Minor |
| `fix` | Bug Fixes | Bug fix | Patch |
| `perf` | Performance | Performance improvement | Patch |
| `docs` | Documentation | Documentation only | None |
| `style` | Code Style | Formatting, no logic change | None |
| `refactor` | Refactoring | Code refactoring | None |
| `test` | Testing | Test additions/updates | None |
| `build` | Build System | Build/tooling changes | None |
| `ci` | CI/CD | CI configuration changes | None |
| `chore` | Maintenance | Maintenance tasks | None |
| `revert` | Reverts | Revert previous commit | None |

### Breaking Change Detection

**Footer Syntax**:
```
feat(auth): Add OAuth 2.0 support

BREAKING CHANGE: OAuth 1.0 is no longer supported.
Migrate to OAuth 2.0 before upgrading.
```

**Exclamation Mark Syntax**:
```
feat(api)!: Remove deprecated v1 endpoints
```

Both syntaxes result in **Major** version bump and inclusion in Breaking Changes section.

## Change Categorization

### Category Priority Order

1. **Breaking Changes** - Highest impact, major version bump
2. **Features** - New functionality, minor version bump
3. **Bug Fixes** - Fixes, patch version bump
4. **Performance** - Optimizations, patch version bump
5. **Documentation** - Documentation updates, no version bump
6. **Code Quality** - Refactoring, no version bump
7. **Testing** - Test updates, no version bump
8. **Build System** - Build/CI changes, no version bump

### Custom Categories

Define custom categories in configuration:

```yaml
customCategories:
  - name: "Security Fixes"
    types: ["security"]
    priority: 1  # After Breaking Changes
    emoji: "🔒"

  - name: "Dependencies"
    types: ["deps"]
    priority: 8
    emoji: "📦"
```

## Semantic Version Suggestion

The generator suggests version bumps based on commit types:

```javascript
// Example version suggestion logic
{
  currentVersion: "2.3.4",
  suggestedVersion: "3.0.0",  // Major bump due to breaking change
  reason: "1 breaking change, 3 features, 5 bug fixes",
  breakdown: {
    breaking: 1,  // -> Major bump
    features: 3,  // -> Minor bump (if no breaking)
    fixes: 5      // -> Patch bump (if no features/breaking)
  }
}
```

### Version Bump Rules

- **Breaking Change** → Major version (X.0.0)
- **Feature** (no breaking) → Minor version (0.X.0)
- **Fix** (no features/breaking) → Patch version (0.0.X)
- **Other** → No version bump

## Output Formats

### Markdown Format (Default)

```markdown
## [2.1.0] - 2025-11-05

### Breaking Changes
- **auth**: Remove OAuth 1.0 support (a1b2c3d)

  OAuth 1.0 is deprecated. Migrate to OAuth 2.0.

### Features
- **api**: Add rate limiting with Redis (d4e5f6g)
- **ui**: Implement dark mode toggle (h7i8j9k)

### Bug Fixes
- **database**: Fix connection pool exhaustion (l0m1n2o)
- **auth**: Resolve JWT expiration edge case (p3q4r5s)

### Performance
- **api**: Optimize query with indexes (t6u7v8w)

### Documentation
- **readme**: Update installation instructions (x9y0z1a)
```

### JSON Format

```json
{
  "version": "2.1.0",
  "date": "2025-11-05",
  "changes": [
    {
      "category": "Breaking Changes",
      "commits": [
        {
          "type": "feat",
          "scope": "auth",
          "subject": "Remove OAuth 1.0 support",
          "hash": "a1b2c3d",
          "breaking": true,
          "body": "OAuth 1.0 is deprecated. Migrate to OAuth 2.0."
        }
      ]
    },
    {
      "category": "Features",
      "commits": [
        {
          "type": "feat",
          "scope": "api",
          "subject": "Add rate limiting with Redis",
          "hash": "d4e5f6g",
          "breaking": false
        }
      ]
    }
  ]
}
```

### Plain Text Format

```
Release 2.1.0 - 2025-11-05

BREAKING CHANGES:
* auth: Remove OAuth 1.0 support (a1b2c3d)
  OAuth 1.0 is deprecated. Migrate to OAuth 2.0.

FEATURES:
* api: Add rate limiting with Redis (d4e5f6g)
* ui: Implement dark mode toggle (h7i8j9k)

BUG FIXES:
* database: Fix connection pool exhaustion (l0m1n2o)
* auth: Resolve JWT expiration edge case (p3q4r5s)
```

## Configuration Options

### Complete Configuration Example

```yaml
# skills/changelog-generator/templates/changelog-config.yaml
fromTag: v2.0.0
toTag: HEAD
format: markdown  # 'markdown', 'json', 'plain'

# Repository settings
repository:
  path: ./
  remote: origin
  branch: main

# Category configuration
categories:
  - breaking
  - features
  - fixes
  - performance
  - documentation
  - refactoring
  - testing
  - build

# Type mapping
typeMapping:
  feat: features
  fix: fixes
  perf: performance
  docs: documentation
  refactor: refactoring
  test: testing
  build: build
  chore: maintenance

# Exclude types from changelog
excludeTypes:
  - style
  - ci
  - chore

# Include commit hash in output
includeCommitHash: true

# Include commit author
includeAuthor: false

# Group by scope
groupByScope: false

# Link to commit in remote repository
linkCommits: true
commitUrlTemplate: "https://github.com/owner/repo/commit/{hash}"

# Version suggestion
suggestVersion: true
currentVersion: 2.0.0

# Performance limits
maxCommits: 10000
timeout: 60000  # 60 seconds
```

## Advanced Parsing Patterns

### Multi-Line Commit Messages

```
feat(api): Add pagination support

This commit adds pagination to all list endpoints with
configurable page size and cursor-based navigation.

BREAKING CHANGE: List endpoints now return paginated
results. Update clients to handle pagination.

Closes #123
Refs #124, #125
```

**Parsed Structure**:
```javascript
{
  type: 'feat',
  scope: 'api',
  subject: 'Add pagination support',
  body: 'This commit adds pagination to all list endpoints...',
  breaking: true,
  breakingChangeDescription: 'List endpoints now return paginated results...',
  references: ['#123', '#124', '#125']
}
```

### Scope Patterns

```
feat(api/v2): Add new endpoint          # Nested scope
feat(ui,ux): Improve user experience    # Multiple scopes
feat: Add global feature                # No scope
```

### Revert Commits

```
revert: feat(api): Add rate limiting

This reverts commit a1b2c3d4e5f6g7h8.
```

## Multi-Repository Support

### Monorepo Configuration

```yaml
# Multi-package monorepo
repositories:
  - name: "Core API"
    path: packages/api
    prefix: api

  - name: "Web UI"
    path: packages/web
    prefix: web

  - name: "Mobile App"
    path: packages/mobile
    prefix: mobile

# Generate separate changelogs per package
separateChangelogs: true

# Or generate combined changelog
separateChangelogs: false
```

### Combined Changelog Output

```markdown
## [2.1.0] - 2025-11-05

### Core API

#### Features
- **api/auth**: Add OAuth 2.0 support (a1b2c3d)
- **api/rate-limit**: Implement Redis-based rate limiting (d4e5f6g)

### Web UI

#### Features
- **web/theme**: Add dark mode toggle (h7i8j9k)
- **web/i18n**: Add Spanish localization (l0m1n2o)
```

## Integration Examples

### Integration with release-agent

```javascript
// In release workflow
const { ChangelogGenerator } = require('./skills/changelog-generator/scripts/generate-changelog.js');

// Generate changelog from last tag to HEAD
const generator = new ChangelogGenerator({
  fromTag: await getLastTag(),
  toTag: 'HEAD',
  format: 'markdown'
});

const changelog = await generator.generate();

// Get version suggestion
const versionSuggestion = generator.suggestVersion();
console.log(`Suggested version: ${versionSuggestion.version}`);

// Write to CHANGELOG.md
fs.writeFileSync('CHANGELOG.md', changelog);

// Use in PR description
const prBody = `
## Release ${versionSuggestion.version}

${changelog}

## Test Results
- Unit tests: ✅ PASS
- Integration tests: ✅ PASS
- Smoke tests: ✅ PASS
`;
```

### Integration with git-workflow

```javascript
// After creating release branch
Task({
  subagent_type: "git-workflow",
  prompt: `Create release branch release/v${suggestedVersion}`
});

// Generate changelog
const changelog = await generator.generate();

// Create commit with changelog
Task({
  subagent_type: "git-workflow",
  prompt: `Update CHANGELOG.md with ${changelog}. Create conventional commit: chore(release): Update changelog for v${suggestedVersion}`
});
```

### Integration with github-specialist

```javascript
// Create PR with changelog
Task({
  subagent_type: "github-specialist",
  prompt: `Create pull request for release v${suggestedVersion} with changelog:
${changelog}

Include test execution results and deployment checklist.`
});
```

## Performance Optimization

### Large Repository Handling

**Problem**: 10,000+ commits take >60 seconds to parse

**Solution**: Incremental parsing with pagination

```javascript
const generator = new ChangelogGenerator({
  fromTag: 'v2.0.0',
  toTag: 'HEAD',
  batchSize: 1000,  // Process 1000 commits at a time
  parallelProcessing: true  // Use worker threads
});
```

### Caching Strategy

```javascript
// Cache parsed commits for 1 hour
const cacheKey = `changelog:${fromTag}:${toTag}`;
const cached = await cache.get(cacheKey);

if (cached) {
  return cached;
}

const changelog = await generator.generate();
await cache.set(cacheKey, changelog, { ttl: 3600 });
```

## Error Handling

### Non-Conventional Commits

```javascript
// Handle commits that don't follow convention
{
  commit: "Fixed bug in authentication",  // Missing type
  action: "categorize_as_other",
  category: "Other Changes",
  warning: "Commit does not follow conventional format"
}
```

### Git Operations Failures

```javascript
// Graceful degradation
try {
  const commits = await git.log({ from: fromTag, to: toTag });
} catch (error) {
  if (error.code === 'TAG_NOT_FOUND') {
    // Fall back to all commits
    const commits = await git.log({ from: null, to: toTag });
  }
}
```

## Testing Strategy

### Unit Tests

```javascript
describe('ChangelogGenerator', () => {
  it('parses conventional commit correctly', () => {
    const commit = 'feat(api): Add rate limiting';
    const parsed = parser.parse(commit);

    expect(parsed.type).toBe('feat');
    expect(parsed.scope).toBe('api');
    expect(parsed.subject).toBe('Add rate limiting');
  });

  it('detects breaking change from footer', () => {
    const commit = 'feat(api): Add OAuth 2.0\n\nBREAKING CHANGE: OAuth 1.0 removed';
    const parsed = parser.parse(commit);

    expect(parsed.breaking).toBe(true);
  });
});
```

### Integration Tests

```javascript
describe('Changelog Generation', () => {
  it('generates markdown changelog', async () => {
    const generator = new ChangelogGenerator({
      fromTag: 'v2.0.0',
      toTag: 'v2.1.0',
      format: 'markdown'
    });

    const changelog = await generator.generate();

    expect(changelog).toContain('## [2.1.0]');
    expect(changelog).toContain('### Features');
  });
});
```

## Troubleshooting

### Common Issues

**Issue**: Execution time exceeds 60 seconds
**Solution**: Enable parallel processing and reduce batch size

**Issue**: Non-conventional commits break parser
**Solution**: Enable lenient mode to categorize as "Other Changes"

**Issue**: Missing commits in changelog
**Solution**: Verify tag exists and git log returns expected commits

## Best Practices

1. **Enforce Conventional Commits**: Use git hooks to validate commit messages
2. **Automate Changelog Generation**: Integrate into release workflow
3. **Review Generated Changelog**: Manual review before publishing
4. **Version Suggestion**: Use suggested version but allow manual override
5. **Link to Commits**: Include commit hashes or URLs for traceability
6. **Group by Scope**: Enable for large projects with multiple components

## Metrics & Monitoring

```javascript
// Track generation performance
{
  executionTime: 45000,  // 45 seconds
  commitsProcessed: 5432,
  categoriesCounted: {
    breaking: 2,
    features: 47,
    fixes: 123,
    performance: 8,
    documentation: 34
  },
  suggestedVersion: "3.0.0",
  currentVersion: "2.15.3"
}
```

## Related Skills

- **semantic-version-validator**: Validates semantic versions
- **release-report-generator**: Generates complete release reports
- **audit-log-generator**: Tracks release events

## References

- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
