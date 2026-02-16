# Auto-Implement: AI-Powered Issue Resolution

Automatically implements GitHub issues using Claude Code and opens a PR for review.

## How It Works

This workflow uses the **full Ensemble pipeline** rather than invoking Claude Code directly:

1. A new issue is created (or labeled) with the **`auto-implement`** label
2. GitHub Actions spins up a runner and installs Claude Code + Ensemble
3. **Phase 1: PRD** — `/ensemble:create-prd` generates a Product Requirements Document from the issue
4. **Phase 2: TRD** — `/ensemble:create-trd` converts the PRD into a Technical Requirements Document
5. **Phase 3: Implement** — `/ensemble:implement-trd` implements the TRD following project conventions
6. Changes (including PRD + TRD docs) are committed to a `feat/issue-{number}` branch
7. A PR is created linking back to the original issue
8. A comment is posted on the issue with the PR link

### Why the Pipeline?

Running the full Ensemble flow ensures:
- **Structured requirements** before any code is written
- **Traceability** — every implementation has a PRD and TRD on record
- **Better implementations** — Claude Code works from a detailed TRD, not a vague issue description
- **Review artifacts** — reviewers can check the PRD/TRD reasoning, not just the code

## Setup

### 1. Add the Anthropic API Key

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token (same one used by the code review workflow) |

#### Token Scoping

The `CLAUDE_CODE_OAUTH_TOKEN` is an OAuth token from Anthropic's Claude Code service. It authenticates Claude Code CLI runs in CI. If you're already using the code review workflow (`claude-code-review.yml`), this secret is already configured — no additional setup needed.

**Rotate tokens every 90 days** as a best practice.

### 2. Create the Label

Create an `auto-implement` label in your repository:
- Go to **Issues → Labels → New label**
- Name: `auto-implement`
- Color: suggestion `#7C3AED` (purple)
- Description: "Automatically implement this issue with Claude Code"

### 3. Ensure CLAUDE.md Exists

The workflow instructs Claude Code to read `CLAUDE.md` for project conventions. Make sure this file contains:
- Project structure overview
- Coding standards and conventions
- Build/test instructions
- Any constraints or patterns to follow

## Usage

### Option A: Label on creation
Create an issue and add the `auto-implement` label before submitting.

### Option B: Label an existing issue
Add the `auto-implement` label to any existing issue to trigger implementation.

## Configuration

### Timeout
- **Job timeout**: 30 minutes total (configurable in workflow)
- **Phase timeout**: 10 minutes per phase (PRD, TRD, Implementation)

### Concurrency & Rate Limiting
- Only one auto-implement job runs per issue at a time. Re-labeling cancels any in-progress run.
- **Max 2 concurrent** auto-implement runs across all issues
- **Max 5 runs per hour** to prevent cost overruns

### Claude Code Permissions
The workflow creates a `.claude/settings.json` that restricts Claude Code to:

**Allowed:**
- File read/write/edit
- Git read-only (diff, log, status)
- File exploration (find, cat, ls, grep, head, tail, wc)
- Node/npm/npx (for build/test)
- File operations (mkdir, cp, mv)

**Denied:**
- Network access (curl, wget, WebFetch, WebSearch)
- Git write operations (push, commit)
- Destructive commands (rm -rf)

### Input Sanitization
- Issue body is written to a temp file via `actions/github-script` to avoid shell injection
- Issue title and number are passed via environment variables, not direct interpolation

## Limitations

- **Review required** — AI-generated code should always be reviewed before merging
- **Complex issues** — Multi-step or ambiguous issues may produce incomplete implementations
- **Cost** — Each run consumes Anthropic API credits. Expect ~$1-3 for simple issues (single file changes), ~$3-8 for moderate issues (multi-file features), and potentially more for complex architectural changes. The 3-phase pipeline uses more tokens than a single-shot approach but produces better results.
- **No iteration** — The bot makes one pass; it doesn't respond to PR review comments (yet)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Workflow doesn't trigger | Ensure the `auto-implement` label exists and is spelled exactly |
| "Credit balance too low" | Add credits at [console.anthropic.com](https://console.anthropic.com) |
| No changes made | Issue description may be too vague — add more detail and re-trigger |
| PR has issues | Review, comment, and fix manually — or close and re-create with better description |
