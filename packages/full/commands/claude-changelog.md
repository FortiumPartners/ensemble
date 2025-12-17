---
name: ensemble:claude-changelog
description: Generate changelog from git history using conventional commits
---

Generate a changelog from git history using conventional commit parsing.

## Mission

Parse git commits and generate structured changelog:
- Group by change type (breaking, features, fixes)
- Extract scope and description
- Link to commits and PRs
- Support multiple output formats

## Workflow

1. **Commit Analysis**
   - Parse commits since last release/tag
   - Extract conventional commit metadata
   - Categorize changes

2. **Changelog Generation**
   - Group by change type
   - Format with links and references
   - Generate markdown output

3. **Output**
   - CHANGELOG.md update
   - Release notes

## Usage

```
/ensemble:claude-changelog [--from <ref>] [--to <ref>]
```

## Options

- `--from`: Starting reference (default: last tag)
- `--to`: Ending reference (default: HEAD)

Uses `changelog-generator` skill.
