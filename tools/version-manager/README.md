# Version Manager

Automated version management for the Ensemble plugin ecosystem. Parses conventional commit messages and determines semantic version bumps.

## Features

- **Conventional Commit Parsing**: Uses `conventional-commits-parser` library for robust commit message parsing
- **Input Sanitization**: Security-first approach with character allowlisting and injection protection
- **Bump Type Resolution**: Automatic determination of major/minor/patch bumps based on commit type
- **Breaking Change Detection**: Supports both `!` suffix and `BREAKING CHANGE` footer
- **Comprehensive Error Handling**: Fail-fast with actionable error messages

## Installation

```bash
npm install
```

## Usage

```typescript
import {
  parseConventionalCommit,
  determineBumpType,
  sanitizeCommitMessage
} from '@ensemble/version-manager';

// Parse a commit message
const commit = parseConventionalCommit('feat(core): add new utility');
console.log(commit.type); // 'feat'
console.log(commit.scope); // 'core'
console.log(commit.breaking); // false

// Determine version bump
const bumpType = determineBumpType([commit]);
console.log(bumpType); // 'minor'

// Sanitize input
const sanitized = sanitizeCommitMessage('feat(core): add feature\r\n\r\nBody');
// Returns normalized version with LF line endings
```

## API

### `parseConventionalCommit(message: string): CommitMessage`

Parses a conventional commit message and validates it.

**Throws**: `VersionError` if message is malformed or invalid

**Example**:
```typescript
const commit = parseConventionalCommit('fix(api): resolve bug #123');
// {
//   type: 'fix',
//   scope: 'api',
//   subject: 'resolve bug #123',
//   breaking: false,
//   ...
// }
```

### `determineBumpType(commits: CommitMessage[]): BumpType`

Determines the semantic version bump type based on commit messages.

**Returns**: `'major' | 'minor' | 'patch' | 'none'`

**Rules**:
- Breaking change (`!` or `BREAKING CHANGE`) → `major`
- `feat` → `minor`
- `fix` → `patch`
- Other types → `none`

**Example**:
```typescript
const bumpType = determineBumpType([
  { type: 'fix', breaking: false, subject: 'bug fix' },
  { type: 'feat', breaking: false, subject: 'new feature' }
]);
// Returns: 'minor' (precedence: major > minor > patch > none)
```

### `sanitizeCommitMessage(message: string): string`

Sanitizes and validates commit message for security.

**Security Controls**:
- Removes null bytes
- Normalizes line endings (CRLF → LF)
- Validates character set (alphanumeric + safe punctuation)
- Enforces length limit (8192 characters)

**Throws**: `VersionError` if message contains invalid characters or is too long

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Test Coverage

Current coverage exceeds TRD requirements (≥90%):
- **Statements**: 95.38%
- **Functions**: 100%
- **Lines**: 95.38%
- **Branches**: 86.11%

## Error Codes

| Code | Description | Recovery Action |
|------|-------------|----------------|
| E001 | Parse error | Use conventional commit format: type(scope): subject |
| E002 | Sanitization failed | Use only allowed characters |
| E010 | Empty commit | Provide meaningful commit message |

## Development

Built with:
- TypeScript 5.3.3
- Jest 29.7.0
- conventional-commits-parser 5.0.0

## License

MIT
