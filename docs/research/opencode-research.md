# OpenCode Research Document

**Date**: 2026-02-26
**Source**: https://github.com/anomalyco/opencode (111k+ stars, MIT License)
**Version**: 1.2.15 (current `@opencode-ai/plugin` package)
**Homepage**: https://opencode.ai
**Language**: TypeScript (Bun runtime) -- was originally Go, rewritten in TypeScript
**Organization**: anomalyco (formerly opencode-ai, originally sst)

> **Note**: Context7 MCP was not available in this environment. All data was gathered
> directly from the GitHub API and raw source files on the `dev` branch.

---

## 1. What OpenCode Is

OpenCode is an open-source AI coding agent built for the terminal. It provides a TUI
(Terminal User Interface), desktop app, and web interface for interacting with LLMs to
assist with coding tasks. It was created by the SST team (now Anomaly Co), the same
people behind [terminal.shop](https://terminal.shop) and the SST framework.

### Architecture

OpenCode uses a **client/server architecture**:

- **Server**: A Hono-based HTTP server that manages sessions, LLM communication, tool
  execution, and plugin lifecycle. Runs locally.
- **Clients**: The TUI (built with Solid.js + OpenTUI), a desktop app (Electron-based),
  and a web interface are all frontends that connect to the server.
- **Database**: SQLite (via Drizzle ORM) for persistent session and conversation storage.
- **Runtime**: Bun (not Node.js). The project uses Bun-specific APIs extensively
  (Bun.file, Bun.$, bun-pty).

### Internal Module Structure (`packages/opencode/src/`)

| Module | Purpose |
|--------|---------|
| `agent/` | Agent definitions, prompt templates, agent configuration |
| `cli/` | CLI entry point using yargs |
| `config/` | Configuration loading, merging, validation (JSONC support) |
| `command/` | Custom command system (slash commands) |
| `lsp/` | Language Server Protocol client integration |
| `mcp/` | Model Context Protocol client for external tools |
| `permission/` | Permission system with granular allow/ask/deny rules |
| `plugin/` | Plugin loader and hook dispatch |
| `provider/` | LLM provider integrations (via Vercel AI SDK) |
| `server/` | Hono HTTP server, SSE event streaming |
| `session/` | Conversation session management |
| `skill/` | Skill discovery and loading |
| `tool/` | Built-in tool definitions (bash, edit, glob, grep, etc.) |
| `snapshot/` | File snapshot/undo system |
| `worktree/` | Git worktree detection |

### Key Technical Choices

- **LLM Integration**: Uses the Vercel AI SDK (`ai` package) with provider-specific
  adapters (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc.)
- **TUI Framework**: OpenTUI + Solid.js (reactive terminal UI)
- **Config Format**: JSONC (JSON with comments) via `jsonc-parser`
- **Package Manager**: Bun workspaces (monorepo with `packages/` directory)

### Monorepo Packages

| Package | Description |
|---------|-------------|
| `packages/opencode` | Core CLI and server |
| `packages/plugin` | Plugin SDK (`@opencode-ai/plugin`) |
| `packages/sdk` | Client SDK (`@opencode-ai/sdk`) |
| `packages/app` | Desktop application |
| `packages/console` | Web console |
| `packages/docs` | Documentation site |
| `packages/extensions` | IDE extensions (Zed) |
| `packages/web` | Marketing website |
| `packages/enterprise` | Enterprise features |
| `packages/ui` | Shared UI components |

---

## 2. Plugin/Extension System

OpenCode has a TypeScript-based plugin system that allows extending the agent with
custom tools, hooks, authentication providers, and event handlers.

### Installing Plugins

Plugins are specified in the configuration file as npm package references:

```json
{
  "plugin": [
    "my-opencode-plugin@1.0.0",
    "file:///path/to/local/plugin"
  ]
}
```

Plugins are installed automatically via `Bun.install()` at startup. Built-in plugins
(like `opencode-anthropic-auth`) are loaded by default and can be disabled with the
`OPENCODE_DISABLE_DEFAULT_PLUGINS` flag.

Plugins can also be placed in `.opencode/plugins/` directories (project or global level).

### Plugin API (`@opencode-ai/plugin`)

A plugin is an async function that receives a `PluginInput` context and returns a
`Hooks` object:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  // ctx.client    - OpenCode SDK client
  // ctx.project   - Current project info
  // ctx.directory  - Current working directory
  // ctx.worktree   - Git worktree root
  // ctx.serverUrl  - Local server URL
  // ctx.$          - Bun shell instance

  return {
    // Custom tools available to the AI
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string().describe("foo"),
        },
        async execute(args, context) {
          // context.sessionID, context.agent, context.directory, etc.
          return `Hello ${args.foo}!`
        },
      }),
    },

    // Lifecycle hooks (see full list below)
    "tool.execute.before": async (input, output) => { /* ... */ },
    "tool.execute.after": async (input, output) => { /* ... */ },
  }
}
```

### Available Plugin Hooks

| Hook | Description |
|------|-------------|
| `event` | Called on any bus event |
| `config` | Called with loaded configuration |
| `tool` | Register custom tools (object map of tool definitions) |
| `auth` | Authentication provider (OAuth or API key flows) |
| `chat.message` | Called when a new message is received |
| `chat.params` | Modify LLM parameters (temperature, topP, etc.) |
| `chat.headers` | Modify HTTP headers sent to LLM providers |
| `permission.ask` | Intercept permission prompts |
| `command.execute.before` | Before a slash command executes |
| `tool.execute.before` | Before a tool executes (modify args) |
| `tool.execute.after` | After a tool executes (modify output) |
| `tool.definition` | Modify tool descriptions/parameters sent to LLM |
| `shell.env` | Inject environment variables into shell commands |
| `experimental.chat.messages.transform` | Transform message history |
| `experimental.chat.system.transform` | Transform system prompt |
| `experimental.session.compacting` | Customize session compaction |
| `experimental.text.complete` | Modify completed text |

### Custom Commands

Commands are Markdown files stored in specific directories:

- **User commands** (`user:` prefix): `~/.config/opencode/commands/*.md`
- **Project commands** (`project:` prefix): `<PROJECT>/.opencode/commands/*.md`
- **Subdirectory organization**: `commands/git/commit.md` becomes `user:git:commit`

Commands support named arguments with `$PLACEHOLDER` syntax:

```markdown
# Fix Issue $ISSUE_NUMBER

RUN gh issue view $ISSUE_NUMBER --json title,body,comments
READ README.md
```

Commands can also be defined in configuration:

```json
{
  "command": {
    "my-command": {
      "description": "My custom command",
      "template": "Do something with $1",
      "agent": "build",
      "subtask": false
    }
  }
}
```

### Skills (Agent Knowledge)

Skills are Markdown files with frontmatter that provide domain knowledge to agents.
They follow the `SKILL.md` convention:

```markdown
---
name: my-skill
description: Knowledge about X
---

# Skill Content

Detailed instructions and knowledge the agent can reference...
```

**Skill Discovery Locations** (in order of precedence):

1. `.claude/skills/**/SKILL.md` (Claude Code compatibility)
2. `.agents/skills/**/SKILL.md` (generic agent directory)
3. `.opencode/skill/**/SKILL.md` or `.opencode/skills/**/SKILL.md`
4. Additional paths from `config.skills.paths`
5. Remote URLs from `config.skills.urls` (fetches index.json + files)
6. Global: `~/.claude/skills/` and `~/.agents/skills/`

Skills are automatically exposed as invocable commands (if no command with the same
name exists).

### Agents (Custom Agent Definitions)

OpenCode ships with built-in agents and allows custom agent configuration:

**Built-in Agents:**

| Agent | Mode | Description |
|-------|------|-------------|
| `build` | primary | Default full-access agent for development |
| `plan` | primary | Read-only agent for analysis and code exploration |
| `general` | subagent | General-purpose for complex searches and multistep tasks |
| `explore` | subagent | Fast agent specialized for codebase exploration |
| `compaction` | primary (hidden) | Session compaction/summarization |
| `title` | primary (hidden) | Session title generation |
| `summary` | primary (hidden) | Session summary generation |

**Custom Agent Configuration** (in `opencode.json`):

```json
{
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.7,
      "steps": 50,
      "prompt": "You are a specialized backend developer..."
    },
    "my-custom-agent": {
      "name": "my-custom-agent",
      "description": "Specialized agent for database work",
      "mode": "primary",
      "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
      "permission": {
        "bash": "ask",
        "edit": "allow"
      }
    }
  }
}
```

Custom agents can also be defined as Markdown files in `.opencode/agents/` directories.

---

## 3. Configuration Format and File Structure

### Configuration File Locations

OpenCode uses JSONC format and searches these locations (low to high precedence):

1. Remote `.well-known/opencode` (organization defaults)
2. Global config: `~/.config/opencode/opencode.json` or `opencode.jsonc`
3. Custom config: `$OPENCODE_CONFIG` environment variable
4. Project config: `./opencode.json` or `./opencode.jsonc`
5. `.opencode/` directories: `.opencode/opencode.json`
6. Inline config: `$OPENCODE_CONFIG_CONTENT`
7. Enterprise managed: `/Library/Application Support/opencode/` (highest priority)

### Full Configuration Schema

```json
{
  "$schema": "https://opencode.ai/config.json",
  "logLevel": "info",
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "anthropic/claude-3-5-haiku-20241022",
  "default_agent": "build",
  "username": "custom-name",
  "snapshot": true,
  "share": "manual",
  "autoupdate": true,

  "server": { },

  "agent": {
    "build": {
      "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
      "temperature": 0.7,
      "topP": 0.9,
      "steps": 50,
      "prompt": "Custom system prompt addition"
    },
    "plan": { },
    "general": { },
    "explore": { }
  },

  "command": {
    "deploy": {
      "description": "Deploy the application",
      "template": "Deploy to $1 environment",
      "agent": "build",
      "subtask": false
    }
  },

  "skills": {
    "paths": ["./custom-skills", "~/shared-skills"],
    "urls": ["https://skills.example.com/"]
  },

  "plugin": [
    "my-plugin@1.0.0",
    "file:///local/plugin"
  ],

  "instructions": [
    "path/to/instructions.md",
    "another/instructions.md"
  ],

  "permission": {
    "bash": "ask",
    "edit": "allow",
    "read": {
      "*": "allow",
      "*.env": "ask"
    }
  },

  "disabled_providers": ["groq"],
  "enabled_providers": ["anthropic", "openai"],

  "mcpServers": {
    "example-stdio": {
      "type": "stdio",
      "command": "path/to/mcp-server",
      "args": ["--flag"],
      "env": { "KEY": "value" }
    },
    "example-sse": {
      "type": "sse",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  },

  "lsp": {
    "typescript": {
      "disabled": false,
      "command": "typescript-language-server",
      "args": ["--stdio"]
    },
    "go": {
      "disabled": false,
      "command": "gopls"
    }
  },

  "shell": {
    "path": "/bin/zsh",
    "args": ["-l"]
  },

  "watcher": {
    "ignore": ["node_modules", ".git"]
  },

  "autoCompact": true
}
```

### Project Directory Structure

```
project/
|-- opencode.json              # Project-level config
|-- .opencode/
|   |-- opencode.json          # Additional config (merged)
|   |-- commands/
|   |   |-- deploy.md          # project:deploy command
|   |   |-- git/
|   |   |   +-- commit.md      # project:git:commit command
|   |-- agents/
|   |   +-- db-expert.md       # Custom agent definition
|   |-- plugins/
|   |   +-- my-plugin/         # Local plugin directory
|   |-- skill/
|   |   +-- react/
|   |       +-- SKILL.md       # React skill
|   +-- plans/                 # Plan mode output
+-- AGENTS.md                  # Project context file (like CLAUDE.md)
```

### Global Configuration

```
~/.config/opencode/
|-- opencode.json              # Global config
|-- commands/
|   +-- prime-context.md       # user:prime-context command
+-- skills/
    +-- general/
        +-- SKILL.md
```

---

## 4. Comparison with Claude Code Extensibility

| Feature | OpenCode | Claude Code (Ensemble) |
|---------|----------|----------------------|
| **Open Source** | Yes (MIT) | Proprietary CLI, open source plugin ecosystem |
| **Provider Lock-in** | None - supports 15+ providers | Anthropic only |
| **Plugin Format** | TypeScript/npm packages | JSON manifests + YAML agents + Markdown commands |
| **Plugin SDK** | `@opencode-ai/plugin` (typed, async) | No formal SDK; file-based conventions |
| **Custom Tools** | TypeScript functions via plugin API | Not directly supported (MCP servers instead) |
| **Hook System** | 15+ typed hook points (before/after) | PreToolUse / PostToolUse hooks (shell commands) |
| **Agent Definition** | JSON config or Markdown files | YAML files with frontmatter |
| **Skill System** | SKILL.md with frontmatter + remote URLs | SKILL.md and REFERENCE.md files |
| **Custom Commands** | Markdown files with `$ARG` placeholders | YAML/Markdown command definitions |
| **MCP Support** | Yes (stdio + SSE) | Yes (via MCP servers in config) |
| **LSP Integration** | Built-in (diagnostics exposed to AI) | Not built-in |
| **Permission System** | Granular per-tool with glob patterns | Allowlist-based (.claude/settings.json) |
| **Configuration** | JSONC with 7-level precedence | JSON settings + YAML manifests |
| **Agent Delegation** | `@general` inline + agent tool | Task tool with subagent_type |
| **Session Management** | SQLite-backed, auto-compact | Conversation-based |
| **Desktop App** | Yes (beta) | No |
| **Web Interface** | Yes (console) | No |
| **TUI Framework** | Solid.js + OpenTUI (custom) | Ink (React-based) |
| **Runtime** | Bun | Node.js |
| **Architecture** | Client/server (separable) | Monolithic CLI |
| **Skill Discovery** | Cross-compatible (.claude/, .agents/) | Own directories only |

### Key Differences in Extensibility

1. **Plugin Power**: OpenCode plugins are full TypeScript programs that can intercept
   and modify virtually every aspect of the agent lifecycle. Ensemble plugins are
   declarative (YAML/JSON manifests) with shell-based hooks.

2. **Tool Creation**: OpenCode allows defining custom tools directly in plugins with
   Zod schemas. Claude Code relies on MCP servers for custom tool creation.

3. **Agent Customization**: OpenCode allows deep agent customization (model, temperature,
   permissions, prompts) via config. Ensemble defines agents as YAML files with
   mission/behavior documentation.

4. **Hook Granularity**: OpenCode has 15+ specific hook points (chat.params, shell.env,
   permission.ask, etc.). Ensemble has 2 hook points (PreToolUse, PostToolUse).

5. **Cross-Compatibility**: OpenCode explicitly supports `.claude/skills/` directories,
   making it compatible with Claude Code skill definitions.

---

## 5. SDK and API for Building Plugins/Extensions

### Plugin SDK (`@opencode-ai/plugin`)

Published as `@opencode-ai/plugin` on npm. Provides:

- **`Plugin` type**: The main plugin function signature
- **`tool()` helper**: Creates typed tool definitions with Zod schemas
- **`PluginInput`**: Context object with client, project info, shell access
- **`Hooks` interface**: All available hook points with typed signatures
- **`ToolContext`**: Runtime context for tool execution (sessionID, abort signal, etc.)
- **`AuthHook`**: OAuth and API key authentication provider interface

### Client SDK (`@opencode-ai/sdk`)

Published as `@opencode-ai/sdk`. Provides a typed client for the OpenCode server API:

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",
})
```

The SDK is auto-generated from an OpenAPI spec (`packages/sdk/openapi.json`).

### Server API

OpenCode runs a local HTTP server (default port 4096) with:
- REST API endpoints for sessions, messages, tools
- SSE (Server-Sent Events) for real-time streaming
- OpenAPI specification available at `https://opencode.ai/openapi.json`

### Building a Plugin (Step-by-Step)

1. Create a new npm package:
```bash
mkdir my-opencode-plugin && cd my-opencode-plugin
bun init
bun add @opencode-ai/plugin
```

2. Define the plugin (`src/index.ts`):
```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      "my-tool": tool({
        description: "Does something useful",
        args: {
          input: tool.schema.string().describe("Input text"),
        },
        async execute(args, context) {
          // context.sessionID - current session
          // context.directory - project directory
          // context.abort - AbortSignal for cancellation
          // context.metadata() - set tool call metadata
          // context.ask() - request permission
          return `Processed: ${args.input}`
        },
      }),
    },
    "tool.execute.before": async (input, output) => {
      // Intercept any tool call before execution
      console.log(`Tool ${input.tool} called`)
    },
    "shell.env": async (input, output) => {
      // Inject environment variables into shell commands
      output.env["MY_CUSTOM_VAR"] = "value"
    },
  }
}
```

3. Register in project config (`opencode.json`):
```json
{
  "plugin": ["file:///path/to/my-opencode-plugin"]
}
```

Or publish to npm and reference by package name:
```json
{
  "plugin": ["my-opencode-plugin@1.0.0"]
}
```

### Tool Definition API

```typescript
import { tool } from "@opencode-ai/plugin"

const myTool = tool({
  description: "Human-readable description for the LLM",
  args: {
    // Uses Zod schemas
    filePath: tool.schema.string().describe("Path to the file"),
    lines: tool.schema.number().optional().describe("Number of lines"),
    options: tool.schema.object({
      recursive: tool.schema.boolean(),
    }).optional(),
  },
  async execute(args, context) {
    // args is fully typed from the schema
    // Must return a string (the tool output shown to the LLM)
    return "result"
  },
})
```

### Authentication Plugin API

Plugins can provide authentication for custom LLM providers:

```typescript
export const MyAuthPlugin: Plugin = async (ctx) => {
  return {
    auth: {
      provider: "my-provider",
      methods: [
        {
          type: "api",
          label: "API Key",
          prompts: [
            {
              type: "text",
              key: "apiKey",
              message: "Enter your API key",
              placeholder: "sk-...",
            },
          ],
          async authorize(inputs) {
            return {
              type: "success",
              key: inputs.apiKey,
              provider: "my-provider",
            }
          },
        },
        {
          type: "oauth",
          label: "Login with MyProvider",
          async authorize() {
            return {
              url: "https://my-provider.com/oauth",
              instructions: "Complete login in your browser",
              method: "auto",
              async callback() {
                // Exchange code for tokens
                return {
                  type: "success",
                  refresh: "refresh-token",
                  access: "access-token",
                  expires: Date.now() + 3600000,
                }
              },
            }
          },
        },
      ],
    },
  }
}
```

---

## 6. Relevance to Ensemble

### Opportunities

1. **Cross-Compatibility**: OpenCode already scans `.claude/skills/` directories.
   Ensemble skills defined as `SKILL.md` files would be automatically discovered
   by OpenCode users.

2. **Plugin Inspiration**: OpenCode's typed hook system with 15+ hook points is
   more granular than Ensemble's PreToolUse/PostToolUse. Consider expanding
   Ensemble's hook points.

3. **Client/Server Pattern**: OpenCode's separable client/server architecture
   enables remote driving (mobile app, web). This could inspire Ensemble features.

4. **Skill URLs**: OpenCode supports remote skill repositories via URL + index.json.
   Ensemble could adopt a similar pattern for distributing skills.

5. **Permission Granularity**: OpenCode's glob-pattern permissions per tool
   (e.g., `read: { "*.env": "ask" }`) are more granular than Ensemble's allowlist.

### Competitive Positioning

- OpenCode is provider-agnostic; Ensemble is Claude-native (strength for Anthropic users)
- OpenCode has richer programmatic extensibility; Ensemble has richer declarative agent mesh
- OpenCode's 28-agent mesh equivalent would require custom agent configs in JSON
- Ensemble's multi-tier plugin architecture (core/workflow/framework/testing) has no
  direct parallel in OpenCode

---

## Sources

- GitHub Repository: https://github.com/anomalyco/opencode (dev branch, accessed 2026-02-26)
- Plugin SDK source: `packages/plugin/src/index.ts`, `tool.ts`, `example.ts`
- Core config: `packages/opencode/src/config/config.ts`
- Agent system: `packages/opencode/src/agent/agent.ts`
- Skill system: `packages/opencode/src/skill/skill.ts`, `discovery.ts`
- Command system: `packages/opencode/src/command/index.ts`
- Plugin loader: `packages/opencode/src/plugin/index.ts`
- Documentation site: https://opencode.ai/docs
- npm package: `opencode-ai` (CLI), `@opencode-ai/plugin` (SDK), `@opencode-ai/sdk` (client)
