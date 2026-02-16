# Jujutsu (jj) + Git-Town Stacked PR Skill for Claude Code Agents

> Stacked PR workflow automation: jj (local) → git-town (remote) → git (transport)

**Version**: 1.0.0
**Last Updated**: 2026-02-06
**License**: MIT
**Author**: Fortium Partners

---

## Quick Links

**Core Documentation**
- [SKILL.md](./SKILL.md) - Quick start, tool chain overview, and common workflows
- [REFERENCE.md](./REFERENCE.md) - jj + git-town command reference, revsets, decision trees
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error recovery for all three layers

**Getting Started**
- [Onboarding Guide](./guides/onboarding.md) - Migration from git/git-town-only to jj+git-town
- [Validation Script](./scripts/validate-jj-vcs.sh) - Verify jj, git-town, and gh CLI

**Templates**
- [Stack Creation Interview](./templates/interview-stack-creation.md) - Gather info for new stacks
- [PR Submission Interview](./templates/interview-pr-submission.md) - Gather info for PR creation

---

## Tool Chain

```
jj (local changes) → git-town (remote workflow) → git (transport)
```

- **jj**: Change management, stack building, mid-stack editing, conflict recording
- **git-town**: PR creation (propose), merge & cleanup (ship), remote sync, parent tracking
- **git**: Underlying transport, CI/CD, GitHub hosting

### Why This Combination?

| Capability | jj | git-town | Combined |
|------------|-----|----------|----------|
| Mid-stack editing | Auto-rebase descendants | N/A | Edit anywhere, auto-rebase |
| Stable references | Change IDs survive rebase | N/A | Always use change IDs |
| Non-blocking conflicts | Records, doesn't block | N/A | Resolve at convenience |
| PR creation | Manual (gh CLI) | `propose` with auto-targeting | One command per PR |
| Merge & cleanup | Manual | `ship` with auto-cleanup | One command to merge |
| Parent tracking | N/A | Built-in branch hierarchy | Correct PR bases always |

---

## Prerequisites

### Required
- **jj**: Version 0.25.0+ ([install](https://jj-vcs.github.io/jj/latest/install/))
- **git-town**: Version 14.0.0+ ([install](https://www.git-town.com/install))
- **gh CLI**: Authenticated ([install](https://cli.github.com/))
- **Git**: Any recent version

### Optional
- **jj-stack (jst)**: Automated PR management ([install](https://github.com/nicholasphair/jj-stack))

### Quick Validate

```bash
bash packages/git/skills/jj-vcs/scripts/validate-jj-vcs.sh
```

---

## Quick Start

```bash
# 1. Initialize (one-time)
jj git init --colocate
git town config set-main-branch main

# 2. Create stack (jj)
jj new main -m "feat: first change"
jj new -m "feat: second change"

# 3. Bridge to git-town
jj bookmark create stack-1-first -r <change-id-1>
jj bookmark create stack-2-second -r <change-id-2>
jj git push -b "glob:stack-*" --allow-new
git town config set-parent stack-1-first main
git town config set-parent stack-2-second stack-1-first

# 4. Create PRs (git-town)
git checkout stack-1-first && git-town propose --title "First change"
git checkout stack-2-second && git-town propose --title "Second change"

# 5. Ship (git-town)
git checkout stack-1-first && git-town ship
```

---

## Directory Structure

```
jj-vcs/
├── README.md                              # This file
├── SKILL.md                               # Quick start, workflows, tool chain
├── REFERENCE.md                           # jj + git-town commands, revsets, patterns
├── ERROR_HANDLING.md                      # Error recovery for all layers
├── scripts/
│   └── validate-jj-vcs.sh                # Environment validation
├── templates/
│   ├── interview-stack-creation.md        # Stack creation interview
│   └── interview-pr-submission.md         # PR submission interview
└── guides/
    └── onboarding.md                      # Migration guide
```

---

*jj-vcs Skill v1.0.0 (jj → git-town → git)*
