# OpenCode Integration — Comprehensive Reference

> **Tested against:** OpenCode v0.3.x (February 2026)
> **Compatibility note:** OpenCode's CLI interface and config format evolve quickly. Pin the version you test against and check the [OpenCode changelog](https://github.com/sst/opencode) before upgrading.

---

## Overview

`ensemble-opencode` adds OpenCode coding agent support to the Ensemble orchestration ecosystem.

**Key architectural fact:** Ensemble's 28-agent mesh communicates through Claude Code's `Task` tool, which is agent-agnostic. Switching the host coding agent from Claude Code to OpenCode requires no changes to any existing agent, command, or workflow. Ensemble workflows work identically under either agent.

What this package provides:
- Multi-signal detection module (`opencode-detector.js`) to identify OpenCode environments
- Skills documentation (this file + `SKILL.md`) for setup, configuration, and troubleshooting
- Router rules for routing "opencode" prompts to appropriate agents
- Permitter allowlist samples for OpenCode CLI commands

**What this package does NOT do:**
- Modify any existing Claude Code functionality
- Auto-switch between Claude Code and OpenCode at runtime
- Configure OpenCode's hook system automatically (see [Known Limitations](#known-limitations))

---

## Installation & Prerequisites

### Prerequisites

| Requirement | Minimum Version | Check |
|------------|----------------|-------|
| Node.js | >= 20 | `node --version` |
| OpenCode | >= 0.3.0 | `opencode --version` |
| Claude Code | any | `claude --version` |
| Ensemble | >= 5.3.0 | `claude plugin list` |

### Install OpenCode

```bash
# macOS / Linux (official installer)
curl -fsSL https://opencode.ai/install.sh | sh

# macOS via Homebrew
brew install opencode

# Verify
opencode --version
which opencode
```

### Install ensemble-opencode

```bash
# Local scope (single project)
claude plugin install ensemble-opencode --scope local

# User scope (all projects)
claude plugin install ensemble-opencode --scope user

# From monorepo source
claude plugin install ./packages/opencode --scope local
```

---

## Configuration

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENCODE_API_KEY` | Yes | API key passed to the underlying LLM provider |
| `OPENCODE_MODEL` | No | Override the default model (e.g., `claude-opus-4-6`) |
| `OPENCODE_LOG_LEVEL` | No | Logging verbosity (`debug`, `info`, `warn`, `error`) |

Set in your shell profile for persistence:

```bash
# ~/.bashrc or ~/.zshrc
export OPENCODE_API_KEY=sk-ant-...
export OPENCODE_MODEL=claude-opus-4-6
```

### Configuration Files

OpenCode looks for configuration in this priority order:

1. `opencode.json` (project root)
2. `opencode.toml` (project root)
3. `~/.config/opencode/config.json` (XDG user config)
4. `~/.opencode/config.json` (fallback)

**`opencode.json` example:**

```json
{
  "model": "claude-opus-4-6",
  "maxTokens": 8192,
  "temperature": 0.7
}
```

**`opencode.toml` example:**

```toml
[model]
name = "claude-opus-4-6"
max_tokens = 8192

[logging]
level = "info"
```

### XDG-Compliant Paths

Ensemble itself uses XDG paths (`~/.config/ensemble/` or `~/.ensemble/`). OpenCode uses `~/.config/opencode/` or `~/.opencode/`. These are separate and do not conflict.

---

## Ensemble Commands Under OpenCode

All Ensemble slash commands are compatible with OpenCode. The table below documents verified behaviour:

| Command | Works Under OpenCode | Notes |
|---------|---------------------|-------|
| `/ensemble:fix-issue` | Yes | Full pipeline: analysis → implementation → PR |
| `/ensemble:create-prd` | Yes | Product Requirements Document creation |
| `/ensemble:create-trd` | Yes | Technical Requirements Document creation |
| `/ensemble:implement-trd` | Yes | TRD implementation with git-town |
| `/ensemble:release` | Yes | Release orchestration |
| `/ensemble:playwright-test` | Yes | E2E test execution |
| `/ensemble:manager-dashboard` | Yes | Productivity metrics |
| `/ensemble:sprint-status` | Yes | Sprint status report |
| `/ensemble:fold-prompt` | Yes | Environment optimization |

**How it works:** Each command delegates work to Ensemble's agent mesh via the `Task` tool. Agents receive file paths and instructions — they do not call OpenCode or Claude Code APIs directly. The host agent (Claude Code or OpenCode) executes `Task` calls, but the sub-agent logic is identical.

---

## Agent Delegation

Ensemble's 28 agents use the `Task` tool for delegation:

```
ensemble-orchestrator
├── backend-developer    → implements API, services, DB changes
├── frontend-developer   → implements UI, components
├── code-reviewer        → security and quality review
├── test-runner          → executes test suites
└── git-workflow         → commits, PRs, semantic versioning
```

**Agent-agnostic delegation example (no changes needed for OpenCode):**

```
Task(subagent_type="backend-developer", prompt="Implement the user auth endpoint...")
Task(subagent_type="code-reviewer", prompt="Review changes in src/auth/...")
```

Neither the orchestrator nor the sub-agents inspect the host coding agent. The Task tool abstraction makes the entire mesh portable.

---

## Router Configuration

The `ensemble-router` package includes a `coding_agents` category in `router-rules.json` that routes OpenCode-related prompts to appropriate agents:

```json
"coding_agents": {
  "description": "Coding agent configuration, setup, and orchestration",
  "triggers": [
    "opencode", "open code", "coding agent", "coding agent setup",
    "use opencode", "switch to opencode", "opencode agent",
    "configure opencode", "opencode setup"
  ],
  "agents": [
    {
      "name": "general-purpose",
      "purpose": "OpenCode setup questions, configuration guidance, and troubleshooting"
    },
    {
      "name": "documentation-specialist",
      "purpose": "OpenCode integration documentation and reference guides"
    }
  ],
  "skills": ["opencode-integration"]
}
```

**To trigger OpenCode routing**, include any of the keywords above in your prompt. The router will inject delegation hints pointing to `general-purpose` or `documentation-specialist` and pass the `opencode-integration` skill context.

**To verify routing is active:**

```bash
npm test --workspace=packages/router
```

---

## Permitter Setup

The `ensemble-permitter` package manages command allowlists. When running Ensemble workflows under OpenCode, the following CLI commands may be invoked by agents:

### Recommended Allowlist Entries

```json
{
  "allowlist": [
    "opencode",
    "opencode run",
    "opencode --version",
    "opencode --help",
    "which opencode",
    "opencode --model",
    "opencode chat"
  ]
}
```

### Sample Permitter Config (`lib/opencode-permitter.json`)

```json
{
  "description": "Permitter allowlist for OpenCode CLI commands used by Ensemble agents",
  "version": "1.0.0",
  "allowlist": [
    {
      "command": "opencode",
      "description": "OpenCode coding agent CLI",
      "patterns": ["opencode.*"]
    },
    {
      "command": "which opencode",
      "description": "Verify OpenCode is in PATH"
    }
  ]
}
```

**Important:** The permitter config is documentation-only. It does not auto-apply to your Claude Code settings. Copy the entries you need into your `.claude/settings.local.json` `allowedTools` configuration.

---

## Troubleshooting

### `opencode: command not found`

**Cause:** OpenCode binary not in PATH.

```bash
# Find where it was installed
find /usr/local/bin ~/.local/bin ~/bin -name opencode 2>/dev/null

# Add to PATH (adjust path as needed)
export PATH="$HOME/.local/bin:$PATH"

# Verify
which opencode
```

### `OPENCODE_API_KEY` not recognised

**Cause:** Environment variable not exported, or set in wrong shell profile.

```bash
# Check if set
echo $OPENCODE_API_KEY

# Set for current session
export OPENCODE_API_KEY=sk-ant-...

# Persist across sessions
echo 'export OPENCODE_API_KEY=sk-ant-...' >> ~/.bashrc
source ~/.bashrc
```

### Detection returns `detected: false`

**Cause:** Fewer than two strong signals present. The threshold is 0.8; a single binary signal contributes 0.5.

```bash
node -e "
const {detectOpenCode} = require('ensemble-opencode');
const r = detectOpenCode();
console.log('confidence:', r.confidence);
console.log('signals:', r.signals);
"
```

Add a second signal (e.g., create `opencode.json` or set `OPENCODE_API_KEY`) to exceed the threshold.

### Hook system not working

**Cause:** OpenCode's hook system is independent from Claude Code's and is not automatically configured by `ensemble-opencode`.

**Resolution:** Consult OpenCode's documentation for its hook system configuration. Ensemble's `agent-progress-pane` and `task-progress-pane` hooks are Claude Code-specific and will not fire under OpenCode.

### Version mismatch errors

**Cause:** OpenCode CLI interface or config format changed between versions.

**Resolution:**
1. Check the OpenCode version this plugin was tested against: **v0.3.x**
2. Pin your OpenCode version: `npm install opencode@0.3.x` (if using npm distribution)
3. Review the [OpenCode changelog](https://github.com/sst/opencode/releases) for breaking changes
4. Update REFERENCE.md after verifying against a new version

### `npm run validate` fails after installing ensemble-opencode

**Cause:** The `plugin.json` or `marketplace.json` entry does not match the schema.

```bash
npm run validate -- --verbose
```

Fix any reported schema violations. Common issues: missing `author.name`, version not matching `x.y.z` pattern.

---

## Comparison with Claude Code

| Feature | Claude Code | OpenCode | Notes |
|---------|-------------|----------|-------|
| Ensemble agent mesh | Full support | Full support | Task tool is agent-agnostic |
| Slash commands | Full support | Full support | Commands call Ensemble agents |
| Hooks (`PreToolUse`, `PostToolUse`) | Full support | Not configured | Hook format differs |
| `agent-progress-pane` | Works | Not available | Claude Code hook required |
| `task-progress-pane` | Works | Not available | Claude Code hook required |
| XDG config (`~/.config/ensemble/`) | Supported | Supported | Ensemble config is agent-agnostic |
| Permitter allowlist | Auto-applied | Manual setup | See Permitter Setup section |
| MCP server integration | Supported | Version-dependent | Check OpenCode MCP docs |

**What works identically:** All core Ensemble orchestration workflows, agent delegation, skill invocation, git operations, and PR creation work the same under both agents.

**What differs:** Claude Code-specific hooks (`agent-progress-pane`, `task-progress-pane`) do not fire under OpenCode. The hook system architecture is different and not auto-configured.

---

## Known Limitations

1. **No hook auto-configuration.** OpenCode's hook system is undocumented at the time of writing (v0.3.x). `ensemble-opencode` does not configure hooks for OpenCode. Ensemble hook-dependent features (`agent-progress-pane`, `task-progress-pane`) are unavailable.

2. **No runtime agent switching.** There is no built-in mechanism to switch between Claude Code and OpenCode at runtime. Choose one host agent per session.

3. **Detection is informational only.** `detectOpenCode()` reports whether OpenCode signals are present. It does not reconfigure Ensemble's behavior based on the result — that is left to the user.

4. **OpenCode version tested: v0.3.x.** Newer OpenCode versions may have different CLI flags, config formats, or hook APIs. Always verify against the version you deploy.

5. **No GUI configuration.** There is no graphical interface for switching coding agents. Configuration is CLI and file-based only.

6. **Permitter config is documentation-only.** The sample `opencode-permitter.json` does not auto-apply. Users must manually add allowlist entries to their Claude Code settings.
