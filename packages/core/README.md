# @fortium/ensemble-core

Core orchestration and utilities for the ensemble ecosystem.

## Installation

```bash
claude plugin install @fortium/ensemble-core
```

## Features

### Framework Detection
Multi-signal framework detection with confidence scoring for major frameworks including React, Vue, Angular, Svelte, NestJS, Rails, Phoenix, Blazor, and more.

### Configuration Path Management
XDG-compliant configuration path management with support for legacy paths and automatic migration.

### History Generator
Generates `ENSEMBLE-HISTORY.md` from PRD and TRD documents, providing a chronological change log of project decisions.

## Commands

### /ensemble:fold-prompt
Advanced Claude environment optimization through intelligent project analysis and context management. Includes:
- Deep project analysis and context mapping
- CLAUDE.md enhancement with agent orchestration patterns
- Multi-document consistency alignment
- **History Consolidation** - Auto-generates ENSEMBLE-HISTORY.md

## Library Modules

### document-parser.js
Parse PRD and TRD markdown files to extract metadata and content summaries.

```javascript
const { scanAndParseDocuments } = require('@fortium/ensemble-core');

const { prds, trds } = await scanAndParseDocuments('./docs');
// Returns parsed documents with title, date, status, problem, solution, decisions
```

### history-generator.js
Generate ENSEMBLE-HISTORY.md from parsed PRD/TRD documents.

```javascript
const { generateHistory, printSummary } = require('@fortium/ensemble-core');

const result = await generateHistory({
  docsDir: './docs',
  outputPath: './.claude/ENSEMBLE-HISTORY.md',  // Default location
  autoCommit: true,  // Auto-commit with conventional message
  verbose: false     // Enable debug output
});

printSummary(result);
```

### config-path.js
XDG-compliant configuration path utilities.

```javascript
const { getEnsembleConfigRoot, getPluginConfigPath } = require('@fortium/ensemble-core');

const configRoot = getEnsembleConfigRoot();  // ~/.config/ensemble or $XDG_CONFIG_HOME/ensemble
const pluginPath = getPluginConfigPath('my-plugin');
```

### detect-framework.js
Multi-signal framework detection.

```javascript
const { detect } = require('@fortium/ensemble-core');

const result = await detect('./my-project');
// Returns: { frameworks: [...], confidence: 0.95, signals: [...] }
```

## Testing

```bash
npm test --workspace=packages/core
```

## Documentation

See the [main ensemble repository](https://github.com/FortiumPartners/ensemble) for complete documentation.

## License

MIT
