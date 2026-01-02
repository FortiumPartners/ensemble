# OpenAI SDK Skill

**Version**: 2.0.0
**Provider**: OpenAI
**Languages**: Python, TypeScript
**Last Updated**: 2026-01-01

## Overview

Progressive disclosure documentation for OpenAI API development. This skill provides comprehensive patterns for Chat Completions, Responses API, Agents SDK, Embeddings, and more.

## Architecture

```
openai/
├── README.md              # This file - overview and usage
├── SKILL.md               # Quick reference (<100KB) - Essential patterns
├── REFERENCE.md           # Comprehensive guide (<1MB) - Deep dive
├── VALIDATION.md          # Feature coverage validation matrix
├── templates/             # Code generation templates
│   ├── chat-completion.template.py    # Chat Completions (Python)
│   ├── chat-completion.template.ts    # Chat Completions (TypeScript)
│   ├── streaming.template.py          # Streaming patterns
│   ├── agent.template.py              # Agents SDK
│   ├── embeddings.template.py         # Embeddings API
│   └── README.md                      # Template usage guide
└── examples/              # Real-world implementations
    ├── basic-chat.example.py          # Basic chat completion
    ├── tool-calling.example.py        # Tool calling patterns
    ├── streaming.example.py           # Streaming responses
    ├── embeddings.example.py          # Embeddings usage
    └── README.md                      # Examples index
```

## Progressive Disclosure Pattern

### SKILL.md (Quick Reference)
- **Size**: <100KB target
- **Use Case**: Fast lookups during active development
- **Content**: Essential patterns, model specs, common operations
- **Load Time**: <100ms

### REFERENCE.md (Comprehensive Guide)
- **Size**: <1MB target
- **Use Case**: Deep dives, learning new patterns
- **Content**: Full API documentation, edge cases, advanced patterns
- **Load Time**: <500ms

## When to Use

The backend-developer agent loads this skill when:
- `package.json` contains `"openai"` dependency
- `requirements.txt` or `pyproject.toml` contains `openai`
- `.env` contains `OPENAI_API_KEY`
- User explicitly mentions "OpenAI", "GPT", or "ChatGPT"

## Framework Detection

**Primary Signals** (Confidence: 0.5 each):
- `package.json` -> `dependencies.openai`
- `requirements.txt` contains `openai`
- `pyproject.toml` contains `openai`

**Secondary Signals** (Confidence: 0.3 each):
- `.env` contains `OPENAI_API_KEY`
- Import statements: `from openai import` or `import openai`

**Boost Factors** (+0.1 each):
- Files matching `*agent*.py` pattern
- Files matching `*embedding*.py` pattern

**Minimum Confidence**: 0.8 (80%) required for automatic detection

## Core Capabilities

### 1. Chat Completions API
- Basic completion patterns
- System prompts and roles
- Multi-turn conversations
- Temperature and parameters

### 2. Responses API
- Next-generation API
- Structured output
- Built-in tools
- Conversation state

### 3. Streaming
- SSE streaming
- Async generators
- Partial responses
- Error recovery

### 4. Tool Calling
- Function definitions
- Tool execution
- Parallel calls
- Result handling

### 5. Agents SDK
- Agent creation
- Multi-agent systems
- Tool integration
- Context management

### 6. Batch API
- Async processing (50% cost savings)
- JSONL request formatting
- Status monitoring
- Result retrieval

### 7. Realtime API
- WebSocket connections
- Audio/video streaming
- Voice selection
- Real-time transcription

### 8. Embeddings
- Text embeddings
- Batch processing
- Similarity search
- Vector databases

### 9. Vision/Multimodal
- Image inputs
- Base64 encoding
- URL references
- Image analysis

### 10. Other APIs (Reference)
- Audio API (Whisper & TTS)
- Image Generation (DALL-E)
- Moderation API
- Fine-tuning

## Model Coverage

### GPT-5 Family (Latest)
| Model | Context | Output | Use Case |
|-------|---------|--------|----------|
| gpt-5 | 128K | 32K | Flagship multimodal |
| gpt-5.1 | 128K | 32K | Enhanced reasoning |
| gpt-5.2 | 128K | 32K | Structured output |

### GPT-4 Family
| Model | Context | Output | Use Case |
|-------|---------|--------|----------|
| gpt-4.1 | 128K | 16K | Latest GPT-4 |
| gpt-4o | 128K | 16K | Optimized speed |
| gpt-4-turbo | 128K | 4K | Previous gen |

### Embedding Models
| Model | Dimensions | Use Case |
|-------|------------|----------|
| text-embedding-3-small | 1536 | Cost-effective |
| text-embedding-3-large | 3072 | High-fidelity |

## Quick Start

### Loading the Skill

```typescript
// Embedded in backend-developer.yaml
const skill = await skillLoader.loadSkill('openai', 'quick');
// Returns SKILL.md content for fast reference

const comprehensiveGuide = await skillLoader.loadSkill('openai', 'comprehensive');
// Returns REFERENCE.md content for deep dives
```

### Using Templates

```bash
# Generate chat completion handler
cp templates/chat-completion.template.py src/chat.py
# Replace placeholders

# Generate streaming handler
cp templates/streaming.template.py src/stream.py
# Replace placeholders
```

## File Size Guidelines

- **SKILL.md**: Target <=50KB (Quick reference should be fast)
- **REFERENCE.md**: Target <=500KB (Comprehensive but reasonable)
- **Templates**: 50-200 lines each (Focused, single responsibility)
- **Examples**: 100-300 lines each (Real-world, production-ready)

## Integration with Backend-Developer

The backend-developer agent uses this skill by:

1. **Detection Phase**: Runs framework-detector to identify OpenAI
2. **Loading Phase**: Loads SKILL.md for quick patterns
3. **Deep Dive Phase**: Loads REFERENCE.md for complex scenarios
4. **Code Generation**: Uses templates for boilerplate reduction
5. **Learning Phase**: References examples for best practices

## Maintenance

### Updating Content

When OpenAI releases new features:
1. Update REFERENCE.md with new APIs
2. Update SKILL.md if pattern becomes essential
3. Add templates for new patterns if commonly used
4. Update model coverage tables
5. Increment skill version (semantic versioning)

### Validation

Before releasing updates:
- [ ] SKILL.md file size <=100KB
- [ ] REFERENCE.md file size <=1MB
- [ ] All templates pass linting
- [ ] Examples demonstrate production-ready code
- [ ] Model information is current

## Support

For issues or improvements:
- Review existing examples for patterns
- Check REFERENCE.md for comprehensive coverage
- Reference official OpenAI documentation: https://platform.openai.com/docs/

## Performance Metrics

**Target Metrics**:
- Skill load time: <100ms (SKILL.md), <500ms (REFERENCE.md)
- Template generation: <50ms per file
- Code generation success rate: >=95%
- User satisfaction: >=90%

---

_Part of Skills-Based Framework Architecture_
_Related: @fortium/ensemble-ai_
