# Anthropic SDK Skill

**Provider**: Anthropic
**Languages**: Python, TypeScript
**Last Updated**: 2026-01-01

## Overview

Progressive disclosure documentation for Anthropic Claude API development. This skill provides comprehensive patterns for Messages API, Tool Use, Extended Thinking, Agent SDK, Batches API, Computer Use, MCP, Citations, Streaming, Vision, and more.

## Architecture

```
anthropic/
├── README.md              # This file - overview and usage
├── SKILL.md               # Quick reference (<500 lines) - Essential patterns
├── REFERENCE.md           # Comprehensive reference - Advanced patterns
├── VALIDATION.md          # Feature coverage validation matrix
├── templates/             # Code generation templates
│   ├── messages.template.py          # Messages API (Python)
│   ├── messages.template.ts          # Messages API (TypeScript)
│   ├── streaming.template.py         # Streaming patterns
│   ├── tool-use.template.py          # Tool use patterns
│   ├── extended-thinking.template.py # Extended thinking
│   └── README.md                     # Template usage guide
└── examples/              # Real-world implementations
    ├── basic-chat.example.py         # Basic message completion
    ├── tool-use.example.py           # Tool use patterns
    ├── streaming.example.py          # Streaming responses
    ├── vision.example.py             # Image analysis
    └── README.md                     # Examples index
```

## Progressive Disclosure Pattern

### SKILL.md (Quick Reference)
- **Size**: <500 lines target
- **Use Case**: Fast lookups during active development
- **Content**: Essential patterns, model specs, common operations
- **Load Time**: <100ms

### REFERENCE.md (Full Reference)
- **Size**: ~1000 lines
- **Use Case**: Advanced patterns and detailed implementations
- **Content**: Agent SDK, Batches API, Computer Use, MCP, Citations, etc.

## When to Use

The backend-developer agent loads this skill when:
- `package.json` contains `"@anthropic-ai/sdk"` dependency
- `requirements.txt` or `pyproject.toml` contains `anthropic`
- `.env` contains `ANTHROPIC_API_KEY`
- User explicitly mentions "Anthropic", "Claude", or specific Claude models

## Framework Detection

**Primary Signals** (Confidence: 0.5 each):
- `package.json` -> `dependencies.@anthropic-ai/sdk`
- `requirements.txt` contains `anthropic`
- `pyproject.toml` contains `anthropic`

**Secondary Signals** (Confidence: 0.3 each):
- `.env` contains `ANTHROPIC_API_KEY`
- Import statements: `from anthropic import` or `import anthropic`

**Boost Factors** (+0.1 each):
- Files matching `*claude*.py` pattern
- Files matching `*anthropic*.py` pattern

**Minimum Confidence**: 0.8 (80%) required for automatic detection

## Core Capabilities

### 1. Messages API
- Basic message patterns
- System prompts
- Multi-turn conversations
- Temperature and parameters

### 2. Agent SDK (NEW)
- Build custom agents powered by Claude
- Tool access (Task, Read, Write, Edit, Bash, WebSearch)
- Permission modes (default, plan, acceptEdits)
- Session management and conversation continuation
- Context management and automatic compaction

### 3. Message Batches API (NEW)
- 50% cost savings for async processing
- Bulk document processing
- Up to 10,000 requests per batch
- 24-hour processing window

### 4. Streaming
- Server-sent events (SSE)
- Async generators
- Partial responses
- Content block deltas

### 5. Tool Use
- Tool definitions
- Tool execution loops
- Parallel tool calls
- Result handling

### 6. Extended Thinking
- Budget tokens configuration
- Thinking block handling
- Streaming with thinking
- Cost optimization

### 7. Vision/Multimodal
- Image inputs (base64, URL)
- PDF document analysis
- Multiple images
- Detail analysis

### 8. Computer Use (Beta) (NEW)
- Browser/desktop automation
- Screenshot capture and analysis
- Mouse and keyboard actions
- Sandboxed execution patterns

### 9. MCP Integration (NEW)
- Model Context Protocol overview
- Tool exposure patterns
- Server implementation
- Client libraries

### 10. Citations (NEW)
- Grounded responses from documents
- Multi-document citations
- Quote extraction
- Source verification

### 11. Prompt Caching
- Cache control headers
- Ephemeral caching
- Cost optimization
- Cache hit tracking

## Platform Differentiators

| Feature | Anthropic | Description |
|---------|-----------|-------------|
| Extended Thinking | Native | Budget-controlled deep reasoning |
| Agent SDK | Full SDK | Build agents with multiple tools |
| Claude Code | Built-in | Terminal-based coding assistant |
| Constitutional AI | Core | Safety-focused training |
| 200K Context | Standard | All models support 200K tokens |
| MCP | Open Protocol | Extensible tool protocol |
| Prompt Caching | Native | 90% cost savings |
| Computer Use | Beta | Browser/desktop automation |
| Message Batches | Native | 50% cost savings |
| Citations | Native | Grounded responses |

## Model Coverage

### Claude 4 Family (Latest)
| Model | Context | Max Output | Extended Thinking | Computer Use |
|-------|---------|------------|-------------------|--------------|
| claude-opus-4-5-20251101 | 200K | 32K | Yes | Yes |
| claude-sonnet-4-20250514 | 200K | 64K | Yes | Yes |

### Claude 3.5 Family
| Model | Context | Max Output | Extended Thinking | Computer Use |
|-------|---------|------------|-------------------|--------------|
| claude-3-5-sonnet-20241022 | 200K | 8K | No | Yes |
| claude-3-5-haiku-20241022 | 200K | 8K | No | No |

### Claude 3 Family
| Model | Context | Max Output | Extended Thinking | Computer Use |
|-------|---------|------------|-------------------|--------------|
| claude-3-opus-20240229 | 200K | 4K | No | Yes |
| claude-3-sonnet-20240229 | 200K | 4K | No | No |
| claude-3-haiku-20240307 | 200K | 4K | No | No |

## Quick Start

### Loading the Skill

```typescript
// Embedded in backend-developer.yaml
const skill = await skillLoader.loadSkill('anthropic', 'quick');
// Returns SKILL.md content for fast reference
```

### Using Templates

```bash
# Generate messages handler
cp templates/messages.template.py src/chat.py
# Replace placeholders

# Generate streaming handler
cp templates/streaming.template.py src/stream.py
# Replace placeholders
```

## File Size Guidelines

- **SKILL.md**: Target <=100KB (Quick reference should be fast)
- **Templates**: 50-200 lines each (Focused, single responsibility)
- **Examples**: 100-300 lines each (Real-world, production-ready)

## Integration with Backend-Developer

The backend-developer agent uses this skill by:

1. **Detection Phase**: Runs framework-detector to identify Anthropic
2. **Loading Phase**: Loads SKILL.md for quick patterns
3. **Code Generation**: Uses templates for boilerplate reduction
4. **Learning Phase**: References examples for best practices

## Maintenance

### Updating Content

When Anthropic releases new features:
1. Update SKILL.md with new APIs
2. Add templates for new patterns if commonly used
3. Update model coverage tables
4. Increment skill version (semantic versioning)

### Validation

Before releasing updates:
- [ ] SKILL.md file size <=100KB
- [ ] All templates pass linting
- [ ] Examples demonstrate production-ready code
- [ ] Model information is current

## Support

For issues or improvements:
- Review existing examples for patterns
- Reference official Anthropic documentation: https://docs.anthropic.com/

## Performance Metrics

**Target Metrics**:
- Skill load time: <100ms (SKILL.md)
- Template generation: <50ms per file
- Code generation success rate: >=95%
- User satisfaction: >=90%

---

_Part of Skills-Based Framework Architecture_
_Related: @fortium/ensemble-ai_
