# @fortium/ensemble-multiplexer-adapters

Shared terminal multiplexer adapters for Ensemble plugins. Provides a unified interface for managing panes across WezTerm, Zellij, and tmux.

## Installation

```bash
npm install @fortium/ensemble-multiplexer-adapters
```

## Usage

```javascript
const { MultiplexerDetector } = require('@fortium/ensemble-multiplexer-adapters');

// Auto-detect and get the appropriate adapter
const detector = new MultiplexerDetector();
const adapter = await detector.autoSelect();

if (adapter) {
  // Split a new pane
  const paneId = await adapter.splitPane({
    direction: 'right',
    percent: 40,
    command: ['bash', '-c', 'echo "Hello from new pane"']
  });

  // Send keys to the pane
  await adapter.sendKeys(paneId, 'echo "message"\n');

  // Close the pane
  await adapter.closePane(paneId);
}
```

## Supported Multiplexers

| Multiplexer | Detection | Split Pane | Send Keys | Close Pane | Get Info |
|-------------|-----------|------------|-----------|------------|----------|
| WezTerm     | ✅        | ✅         | ✅        | ✅         | ✅       |
| Zellij      | ✅        | ✅         | ✅        | ⚠️*        | ❌       |
| tmux        | ✅        | ✅         | ✅        | ✅         | ✅       |

*Zellij can only close the currently focused pane

## API

### MultiplexerDetector

```javascript
const detector = new MultiplexerDetector();

// Auto-select best available multiplexer
const adapter = await detector.autoSelect();

// Get specific adapter by name
const weztermAdapter = detector.getAdapter('wezterm');

// Get all available multiplexers
const available = await detector.getAvailable();

// Detect current session info
const session = await detector.detectSession();
```

### BaseMultiplexerAdapter

All adapters implement this interface:

```javascript
class BaseMultiplexerAdapter {
  // Check if multiplexer is available
  async isAvailable(): Promise<boolean>;

  // Split a new pane
  async splitPane(options: SplitOptions): Promise<string>;

  // Close a pane
  async closePane(paneId: string): Promise<void>;

  // Send keys/text to a pane
  async sendKeys(paneId: string, keys: string): Promise<void>;

  // Get pane information
  async getPaneInfo(paneId: string): Promise<Object|null>;
}
```

### SplitOptions

```javascript
{
  direction: 'right' | 'bottom' | 'left' | 'top',
  percent: number,        // 10-90
  command: string | string[],
  cwd: string,           // Working directory
  name: string           // Pane name (Zellij only)
}
```

## License

MIT
