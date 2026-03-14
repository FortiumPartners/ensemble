# OpenCode Integration — Quick Reference

> **Tested against:** OpenCode v0.3.x | **Version compatibility note:** Pin your OpenCode version; CLI flags may change between releases.

## Quick Setup

**Prerequisites:** Node.js >= 20, OpenCode installed, Ensemble plugin installed.

```bash
# 1. Install OpenCode
curl -fsSL https://opencode.ai/install.sh | sh

# 2. Set your API key
export OPENCODE_API_KEY=your-key-here

# 3. Install ensemble-opencode plugin
claude plugin install ensemble-opencode --scope local

# 4. Verify detection
node -e "const {detectOpenCode}=require('ensemble-opencode');console.log(detectOpenCode())"
```

## Running Ensemble Commands

All Ensemble slash commands work identically under OpenCode:

```bash
# Fix a bug end-to-end
/ensemble:fix-issue

# Create a Product Requirements Document
/ensemble:create-prd

# Create a Technical Requirements Document
/ensemble:create-trd

# Implement a TRD with git-town workflow
/ensemble:implement-trd

# Run a full release
/ensemble:release
```

Agent delegation via the `Task` tool is coding-agent-agnostic — no changes needed.

## Key Configuration

| Variable / File | Purpose | Example |
|----------------|---------|---------|
| `OPENCODE_API_KEY` | API key for OpenCode | `export OPENCODE_API_KEY=sk-...` |
| `opencode.json` | Project-level config | `{"model": "claude-opus-4-6"}` |
| `opencode.toml` | Alternative config format | `[model]\nname = "claude-opus-4-6"` |
| `.opencode/` | OpenCode working directory | Auto-created by OpenCode |

XDG config path: `~/.config/opencode/` or `~/.opencode/`

## Common Issues

| Symptom | Fix |
|---------|-----|
| `opencode: command not found` | Add OpenCode to PATH; re-run `which opencode` |
| `OPENCODE_API_KEY not set` | `export OPENCODE_API_KEY=your-key` in shell profile |
| Detection returns `detected: false` | Ensure ≥2 signals present (binary + config file or directory) |
| Hook system not working | OpenCode hooks differ from Claude Code; configure manually per OpenCode docs |
| Version mismatch errors | Pin OpenCode version; check REFERENCE.md compatibility table |
