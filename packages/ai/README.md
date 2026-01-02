# @fortium/ensemble-ai

**Version**: 5.1.0
**Category**: AI Development
**License**: MIT

AI SDK skills for OpenAI and other AI providers for Claude Code. Provides comprehensive expertise for building applications with modern AI APIs including Chat Completions, Responses API, Agents SDK, Embeddings, and more.

## Overview

This plugin provides AI development skills extracted into a modular, reusable package. It offers progressive disclosure documentation, code generation templates, and real-world examples for building production-ready AI applications.

### Key Features

- **Progressive Disclosure Documentation**: Quick reference (SKILL.md) and comprehensive guide (REFERENCE.md)
- **Code Generation Templates**: Python and TypeScript templates for common patterns
- **Real-World Examples**: Production-ready patterns for chat, streaming, tool calling, and embeddings
- **Automatic Detection**: Intelligent detection based on project dependencies and configuration
- **Multi-Language Support**: Python and TypeScript patterns
- **Latest Model Coverage**: GPT-5 family (GPT-5, GPT-5.1, GPT-5.2) documentation

## Installation

### Via Claude Code Marketplace

```bash
claude plugin install @fortium/ensemble-ai
```

### Manual Installation

```bash
# Clone the ensemble repository
git clone https://github.com/FortiumPartners/ensemble.git
cd ensemble

# Install dependencies
npm install

# Link for local development
cd packages/ai
npm link
```

## Usage

After installation, the AI skills will be automatically available when:

1. Your project has `openai` as a dependency in `package.json` or `requirements.txt`
2. `OPENAI_API_KEY` is detected in `.env` file
3. OpenAI import statements are found in source files
4. You explicitly mention "OpenAI" or "GPT" in your task description

### Backend Developer Integration

The `backend-developer` agent automatically loads this skill when OpenAI is detected:

```yaml
# In backend-developer.yaml
skills:
  - name: openai-sdk
    auto-detect: true
    minimum-confidence: 0.8
```

### Direct Skill Loading

You can also explicitly load AI skills:

```javascript
// In your agent or command
const aiSkill = require('@fortium/ensemble-ai');

// Load quick reference for fast lookups
const quickRef = await aiSkill.loadSkill('quick');

// Load comprehensive guide for deep dives
const comprehensive = await aiSkill.loadSkill('comprehensive');

// Get a code template
const chatTemplate = await aiSkill.getTemplate('chat-completion-python');

// Get an example
const streamingExample = await aiSkill.getExample('streaming');
```

## Directory Structure

```
packages/ai/
├── .claude-plugin/
│   └── plugin.json         # Plugin configuration and metadata
├── agents/                  # Agent configurations (if any)
├── commands/                # Custom commands (if any)
├── lib/
│   └── index.js            # Main plugin entry point and API
├── skills/
│   └── openai/
│       ├── SKILL.md        # Quick reference (<100KB) - Essential patterns
│       ├── REFERENCE.md    # Comprehensive guide - Deep dive
│       ├── README.md       # Skill overview and usage
│       ├── VALIDATION.md   # Validation checklist and quality gates
│       ├── templates/      # Code generation templates
│       │   ├── chat-completion.template.py    # Chat Completions (Python)
│       │   ├── chat-completion.template.ts    # Chat Completions (TypeScript)
│       │   ├── streaming.template.py          # Streaming patterns
│       │   ├── agent.template.py              # Agents SDK
│       │   ├── embeddings.template.py         # Embeddings API
│       │   └── README.md                      # Template usage guide
│       └── examples/       # Real-world implementations
│           ├── basic-chat.example.py          # Basic chat completion
│           ├── tool-calling.example.py        # Tool calling patterns
│           ├── streaming.example.py           # Streaming responses
│           ├── embeddings.example.py          # Embeddings usage
│           └── README.md                      # Examples index
├── tests/                  # Plugin tests
├── CHANGELOG.md           # Version history
├── package.json           # Package configuration
└── README.md              # This file
```

## Core Capabilities

### 1. Chat Completions API
- Basic chat completion patterns
- System prompts and message history
- Temperature and parameter tuning
- Multi-turn conversations

### 2. Responses API
- Next-generation API patterns
- Structured output with JSON Schema
- Built-in tool calling support
- Conversation state management

### 3. Streaming
- Server-Sent Events (SSE) streaming
- Async streaming with generators
- Partial response handling
- Stream error recovery

### 4. Tool Calling
- Function definition patterns
- Tool execution flows
- Parallel tool calls
- Tool result handling

### 5. Agents SDK
- Agent creation and configuration
- Multi-agent orchestration
- Tool integration
- Context management

### 6. Embeddings
- Text embedding generation
- Batch processing
- Similarity search patterns
- Vector database integration

### 7. Vision/Multimodal
- Image input handling
- Base64 and URL image formats
- Image analysis patterns

## Framework Detection

The plugin uses a multi-signal detection system:

### Primary Signals (0.5 confidence each)
- `package.json` contains `"openai"` in dependencies
- `requirements.txt` contains `openai`
- `pyproject.toml` contains `openai`

### Secondary Signals (0.3 confidence each)
- `.env` file contains `OPENAI_API_KEY`
- Import statements: `from openai import` or `import openai`

### Boost Factors (+0.1 each)
- Files matching `*agent*.py` pattern
- Files matching `*embedding*.py` pattern

**Minimum Confidence Required**: 0.8 (80%)

## Available Templates

### chat-completion.template.py
**Python Chat Completions**
- OpenAI client setup
- Message formatting
- Response handling
- Error handling patterns

### chat-completion.template.ts
**TypeScript Chat Completions**
- Type-safe client usage
- Async/await patterns
- Response typing

### streaming.template.py
**Streaming Responses**
- SSE stream handling
- Async generator patterns
- Partial content assembly

### agent.template.py
**Agents SDK**
- Agent class structure
- Tool integration
- Multi-agent patterns

### embeddings.template.py
**Embeddings API**
- Embedding generation
- Batch processing
- Similarity calculation

## Examples

### basic-chat.example.py
Basic chat completion with:
- Client initialization
- Single message completion
- Response parsing

### tool-calling.example.py
Tool calling patterns with:
- Tool definition
- Execution loop
- Result handling

### streaming.example.py
Streaming with:
- Real-time output
- Token-by-token display
- Stream completion

### embeddings.example.py
Embeddings with:
- Text embedding
- Cosine similarity
- Semantic search

## Progressive Disclosure

### SKILL.md (Quick Reference)
- **Size**: Target <100KB
- **Load Time**: <100ms
- **Content**: Essential patterns, common operations, model specifications
- **Use Case**: Fast lookups during active development

### REFERENCE.md (Comprehensive Guide)
- **Size**: Target <1MB
- **Load Time**: <500ms
- **Content**: Full API documentation, edge cases, advanced patterns
- **Use Case**: Deep dives, learning new patterns

## Performance Targets

- **Skill Load Time**: <100ms (quick), <500ms (comprehensive)
- **Template Generation**: <50ms per file
- **Code Generation Success Rate**: >=95%
- **User Satisfaction**: >=90%
- **Framework Detection Accuracy**: >=80%

## Model Coverage

### GPT-5 Family (Latest)
- **gpt-5**: Flagship multimodal model
- **gpt-5.1**: Improved reasoning and tool use
- **gpt-5.2**: Enhanced structured output

### GPT-4 Family
- **gpt-4.1**: Latest GPT-4 variant
- **gpt-4o**: Optimized for speed
- **gpt-4-turbo**: Previous generation

### Embedding Models
- **text-embedding-3-small**: Cost-effective embeddings
- **text-embedding-3-large**: High-fidelity embeddings

## Dependencies

This plugin has no required peer dependencies.

## Related Plugins

- `@fortium/ensemble-development` - Core development agent functionality
- `@fortium/ensemble-python` - Python-specific patterns (if available)

## Contributing

Contributions are welcome! Please see the [main repository](https://github.com/FortiumPartners/ensemble) for contribution guidelines.

### Updating Content

When OpenAI releases new features or models:
1. Update `REFERENCE.md` with new APIs
2. Update `SKILL.md` if pattern becomes essential
3. Add templates for new patterns if commonly used
4. Update model coverage documentation
5. Increment skill version (semantic versioning)

### Quality Gates

Before releasing updates:
- [ ] SKILL.md file size <=100KB
- [ ] REFERENCE.md file size <=1MB
- [ ] All templates pass linting
- [ ] Examples demonstrate production-ready code
- [ ] All tests passing
- [ ] Documentation updated

## Support

- **Issues**: [GitHub Issues](https://github.com/FortiumPartners/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FortiumPartners/ensemble/discussions)
- **Documentation**: [OpenAI API Documentation](https://platform.openai.com/docs)

## License

MIT (c) 2025 Fortium Partners

---

**Plugin Version**: 5.1.0
**Last Updated**: 2025-12-31
**Maintainer**: Fortium Software Configuration Team
