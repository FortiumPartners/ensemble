# Ensemble Pane Viewer

Real-time subagent monitoring in terminal panes for Claude Code.

[![Test](https://github.com/FortiumPartners/ensemble/actions/workflows/test.yml/badge.svg)](https://github.com/FortiumPartners/ensemble/actions/workflows/test.yml)
[![Coverage](https://img.shields.io/badge/coverage-80%25-green)](https://github.com/FortiumPartners/ensemble)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Overview

The Ensemble Pane Viewer is a Claude Code plugin that automatically spawns terminal panes to display real-time activity from subagents. When you delegate tasks to agents like `infrastructure-developer` or `frontend-developer`, their work appears in a split pane alongside your main session.

## Features

- **Automatic Pane Spawning**: Spawns viewer panes when subagents are invoked
- **Multi-Multiplexer Support**: Works with WezTerm, Zellij, and tmux
- **Real-Time Tool Display**: See tool invocations (Read, Write, Bash, etc.) with output preview
- **Configurable Layout**: Choose split direction, size, and auto-close behavior
- **Auto-Close Timeout**: Optional countdown timer to automatically close completed panes
- **Activity Logging**: Persistent logs in `~/.ensemble/agent-logs/` with 7-day retention
- **Session Persistence**: Reuses panes across multiple agent invocations

## Installation

### Prerequisites

- Node.js 18 or higher
- Claude Code installed
- One of: WezTerm, Zellij, or tmux

### Installation Methods

#### Method 1: Via AI-Mesh Installer (Recommended)

```bash
# Install ensemble which includes the pane viewer plugin
npx @fortium/ensemble install --global

# The plugin is automatically installed to ~/.claude/plugins/ensemble-pane-viewer/
# Hooks are configured in ~/.claude/settings.json
```

#### Method 2: Via Claude Code Plugin Command

```bash
# First, add the ensemble marketplace (one-time setup)
/plugin marketplace add FortiumPartners/ensemble

# Then install the plugin
/plugin install ensemble-pane-viewer@ensemble

# Or browse and install interactively
/plugin
```

#### Method 3: Manual Installation

```bash
# Clone to Claude plugins directory
cd ~/.claude/plugins/
git clone https://github.com/FortiumPartners/ensemble.git temp-clone
mv temp-clone/plugins/ensemble-pane-viewer .
rm -rf temp-clone

# Install dependencies
cd ensemble-pane-viewer
npm install

# Configure hooks in ~/.claude/settings.json (see Configuration section)
```

### Verify Installation

```bash
# Check plugin directory exists
ls ~/.claude/plugins/ensemble-pane-viewer/

# Check hooks are configured
cat ~/.claude/settings.json | grep pane-spawner

# Restart Claude Code to load the plugin
```

### Hook Configuration

If installed manually, add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/ensemble-pane-viewer/hooks/pane-spawner.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/ensemble-pane-viewer/hooks/pane-completion.js"
          }
        ]
      }
    ]
  }
}
```

## Configuration

### Quick Setup

```bash
# Show current configuration
/pane-config

# Use WezTerm with right split at 30%
/pane-config multiplexer wezterm
/pane-config direction right
/pane-config percent 30
```

### Configuration Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `enabled` | `true`, `false` | `true` | Enable/disable pane viewer |
| `multiplexer` | `auto`, `wezterm`, `zellij`, `tmux` | `auto` | Terminal multiplexer to use |
| `direction` | `right`, `bottom`, `left`, `top` | `right` | Pane split direction |
| `percent` | `10-90` | `40` | Size of viewer pane (%) |
| `autoCloseTimeout` | `0-300` | `0` | Auto-close after N seconds (0 = manual) |
| `reusePane` | `true`, `false` | `true` | Reuse existing panes |
| `colors` | `true`, `false` | `true` | Enable colored output |
| `maxAgentHistory` | `1-100` | `50` | Max agent entries to keep |

### Configuration File

Settings are saved to `~/.ensemble/plugins/pane-viewer/config.json`:

```json
{
  "enabled": true,
  "multiplexer": "auto",
  "direction": "right",
  "percent": 40,
  "autoCloseTimeout": 0,
  "reusePane": true,
  "colors": true,
  "maxAgentHistory": 50
}
```

### Auto-Close Behavior

The `autoCloseTimeout` option controls what happens after an agent completes:

- **`0` (default)**: Manual close - shows "Press any key to close..."
- **`5`**: Auto-closes after 5 seconds with countdown
- **`30`**: Auto-closes after 30 seconds with countdown

During countdown, pressing any key closes the pane immediately.

### Environment Variables

Override configuration via environment:

```bash
# Disable pane viewer
export AI_MESH_PANE_DISABLE=1

# Force specific multiplexer
export AI_MESH_PANE_MULTIPLEXER=wezterm

# Set split direction
export AI_MESH_PANE_DIRECTION=bottom

# Set pane size
export AI_MESH_PANE_PERCENT=40
```

## Usage

### Automatic Mode (Recommended)

The plugin automatically spawns panes when subagents are invoked:

```bash
# This will automatically spawn a viewer pane
/implement-trd @docs/TRD/my-feature.md
```

### Manual Control

Disable automatic spawning and control manually:

```bash
# Disable automatic spawning
export AI_MESH_PANE_DISABLE=1

# Use library API
node -e "
  const { createViewer } = require('@fortium/ensemble-pane-viewer');

  (async () => {
    const viewer = await createViewer();
    await viewer.spawn('infrastructure-developer', 'Deploy K8s manifests');
    // ... agent work happens ...
    await viewer.close();
  })();
"
```

## Supported Multiplexers

### WezTerm

**Auto-Detection**: Checks `TERM_PROGRAM=WezTerm` or `WEZTERM_PANE` variable

**Features**:
- Horizontal and vertical splits
- Pane IDs for tracking
- Send keys/text to panes

**Commands Used**:
```bash
wezterm cli split-pane --horizontal --percent 30 -- command
wezterm cli kill-pane --pane-id <id>
wezterm cli send-text --pane-id <id> "text"
```

### Zellij

**Auto-Detection**: Checks `ZELLIJ_SESSION_NAME` variable

**Features**:
- Directional splits (right, bottom, left, top)
- Floating panes support
- Named panes

**Commands Used**:
```bash
zellij action new-pane --direction right --size "30%"
zellij action new-pane --floating
zellij action close-pane
zellij action write-chars "text"
```

### tmux

**Auto-Detection**: Checks `TMUX` variable

**Features**:
- Horizontal and vertical splits
- Pane IDs (e.g., `%123`)
- Send keys/commands

**Commands Used**:
```bash
tmux split-window -h -p 30 "command"
tmux split-window -v -p 30 "command"
tmux kill-pane -t <pane-id>
tmux send-keys -t <pane-id> "text" Enter
```

## Viewer Display

The viewer pane shows real-time agent activity with tool invocations:

```
╔════════════════════════════════════════╗
║  AI-Mesh Subagent Monitor              ║
╚════════════════════════════════════════╝

▶ infrastructure-developer
  Task: Deploy Kubernetes manifests

  Status: Running...

  → Read: deployment.yaml
    apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: my-app
    ...
  → Bash: kubectl apply -f deployment.yaml
    deployment.apps/my-app created
  → Read: service.yaml
  → Bash: kubectl apply -f service.yaml
    service/my-app created

  Status: ✓ Completed (2m 15s)
  Log: ~/.ensemble/agent-logs/2025-01-15/infrastructure-developer_143245_abc123.log

Press any key to close...
```

### Tool Output Preview

The viewer shows up to 15 lines of output for each tool invocation, with line truncation at 100 characters. This gives you visibility into what the agent is doing without overwhelming the display.

## Troubleshooting

### Quick Diagnostics

```bash
# Check multiplexer session
echo "WEZTERM_PANE: $WEZTERM_PANE"
echo "ZELLIJ_SESSION_NAME: $ZELLIJ_SESSION_NAME"
echo "TMUX: $TMUX"

# Check configuration
cat ~/.ensemble/plugins/pane-viewer/config.json

# Check state
cat ~/.ensemble/plugins/pane-viewer/panes.json
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Panes not spawning | Check you're in a multiplexer session |
| Wrong multiplexer | Set `multiplexer` in config or env var |
| Panes not closing | Enable `autoCloseTimeout` or press any key |
| No tool output | Ensure Python 3 is available |

### Detailed Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for comprehensive troubleshooting guide.

### Configuration Reference

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for complete configuration options.

## Development

### Project Structure

```
ensemble-pane-viewer/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── .github/
│   └── workflows/
│       └── test.yml          # CI/CD pipeline
├── hooks/
│   ├── hooks.json            # Hook definitions
│   ├── pane-spawner.js       # PreToolUse hook
│   ├── pane-completion.js    # PostToolUse hook
│   ├── pane-manager.js       # Pane lifecycle
│   ├── agent-monitor.sh      # Terminal UI script
│   └── adapters/
│       ├── base-adapter.js   # Base class
│       ├── wezterm-adapter.js
│       ├── zellij-adapter.js
│       ├── tmux-adapter.js
│       ├── multiplexer-detector.js
│       └── index.js
├── commands/
│   └── pane-config.md        # Config command
├── lib/
│   ├── index.js              # Public API
│   └── config-loader.js      # Configuration management
└── tests/
    ├── adapters.test.js      # Adapter unit tests
    ├── config-loader.test.js # Config tests
    ├── pane-manager.test.js  # Manager tests
    ├── auto-close.test.js    # Auto-close feature tests
    ├── hook.test.js          # Hook integration tests
    ├── e2e/
    │   └── workflow.test.js  # E2E workflow tests
    ├── integration/
    │   ├── wezterm.test.js   # WezTerm integration
    │   ├── zellij.test.js    # Zellij integration
    │   └── tmux.test.js      # tmux integration
    └── performance/
        └── benchmark.test.js # Performance benchmarks
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- --testPathPattern=adapters

# Run E2E tests only
npm test -- --testPathPattern=e2e

# Run performance benchmarks
npm test -- --testPathPattern=performance

# Watch mode
npm run test:watch
```

### Test Coverage

Current coverage: **80.4%** (271 tests)

| Component | Coverage |
|-----------|----------|
| hooks/adapters | 97.9% |
| lib/ | 100% |
| hooks/pane-manager.js | 100% |

### Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Hook execution | ≤50ms | ~27ms |
| Module load | ≤100ms | ~2ms |
| Config operations | ≤20ms | <1ms |

### Adding a New Multiplexer

1. Create adapter in `hooks/adapters/`:
   ```javascript
   const { BaseMultiplexerAdapter } = require('./base-adapter');

   class NewAdapter extends BaseMultiplexerAdapter {
     // Implement required methods
   }
   ```

2. Register in `hooks/adapters/index.js`

3. Add detection logic to `multiplexer-detector.js`

4. Add tests in `tests/adapters.test.js`

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: https://github.com/FortiumPartners/ensemble-pane-viewer/issues
- **Email**: support@fortiumpartners.com
- **Documentation**: https://docs.fortiumpartners.com/ensemble-pane-viewer

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Credits

Developed by [Fortium Partners](https://fortiumpartners.com) as part of the Ensemble ecosystem.
