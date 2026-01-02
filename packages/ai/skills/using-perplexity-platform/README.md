# Perplexity Sonar SDK Skill

**Version**: 1.0.0
**Provider**: Perplexity AI
**Languages**: Python, TypeScript
**Last Updated**: 2026-01-01

## Overview

Progressive disclosure documentation for Perplexity Sonar API development. This skill provides comprehensive patterns for search-augmented generation, real-time web search, citations, streaming, and OpenAI-compatible Chat Completions API.

## Architecture

```
perplexity/
├── README.md              # This file - overview and usage
├── SKILL.md               # Quick reference (<100KB) - Essential patterns
├── VALIDATION.md          # Feature coverage validation matrix
├── templates/             # Code generation templates
│   ├── chat.template.py             # Chat Completions (Python)
│   ├── chat.template.ts             # Chat Completions (TypeScript)
│   ├── streaming.template.py        # Streaming patterns
│   ├── search-config.template.py    # Search configuration
│   └── README.md                    # Template usage guide
└── examples/              # Real-world implementations
    ├── basic-chat.example.py        # Basic search-augmented chat
    ├── streaming.example.py         # Streaming responses
    ├── citations.example.py         # Citation handling
    ├── research-assistant.example.py # Research assistant pattern
    └── README.md                    # Examples index
```

## Progressive Disclosure Pattern

### SKILL.md (Quick Reference)
- **Size**: <100KB target
- **Use Case**: Fast lookups during active development
- **Content**: Essential patterns, model specs, common operations
- **Load Time**: <100ms

## When to Use

The backend-developer agent loads this skill when:
- `package.json` or Python dependencies include `openai` with Perplexity base URL
- `.env` contains `PERPLEXITY_API_KEY` or `PPLX_API_KEY`
- User explicitly mentions "Perplexity", "Sonar", or "search-augmented"
- Code uses `api.perplexity.ai` base URL

## Framework Detection

**Primary Signals** (Confidence: 0.5 each):
- Environment variable `PERPLEXITY_API_KEY` or `PPLX_API_KEY`
- Base URL `api.perplexity.ai` in code
- Model names containing `sonar`

**Secondary Signals** (Confidence: 0.3 each):
- Comments mentioning Perplexity
- Import patterns with perplexity configuration

**Boost Factors** (+0.1 each):
- Files matching `*perplexity*.py` pattern
- Files matching `*search*.py` with OpenAI imports

**Minimum Confidence**: 0.8 (80%) required for automatic detection

## Core Capabilities

### 1. Chat Completions API
- OpenAI-compatible interface
- Search-augmented responses
- System prompts and roles
- Multi-turn conversations
- Temperature and parameters

### 2. Real-Time Search
- Every query can search live web
- No training data cutoff
- Current information access
- Source quality filtering

### 3. Citations
- Automatic source attribution
- Inline citation references
- URL extraction
- Citation quality filtering

### 4. Streaming
- Server-sent events (SSE)
- Async generators
- Partial responses
- Real-time output

### 5. Search Configuration
- Domain filtering
- Recency filtering
- Academic focus options
- Related questions

### 6. Enterprise Data Source Partnerships (Enterprise Pro Only)
- **Crunchbase**: Private company firmographics, funding data, financials
- **FactSet**: M&A data, earnings transcripts, financial analysis
- **Coinbase**: Real-time cryptocurrency market data

**Note**: Enterprise data integrations are only available through the Perplexity Enterprise Pro web interface. They are NOT accessible via the Sonar API. See SKILL.md for details and workarounds for API users.

## Platform Differentiators

| Feature | Perplexity | Description |
|---------|------------|-------------|
| Real-time Search | Native | Every query searches live web |
| Citations | Built-in | Automatic source attribution |
| OpenAI Compatible | API | Use OpenAI SDK with different base URL |
| Search Grounding | Default | Responses grounded in sources |
| Recency Focus | Strong | Optimized for current information |
| No Data Cutoff | Yes | Always accesses current web |
| Academic Search | Supported | Focus on scholarly sources |

## Model Coverage

### Sonar Models (Search-Enabled)
| Model | Context | Speed | Use Case |
|-------|---------|-------|----------|
| sonar | 128K | Fast | General queries |
| sonar-pro | 200K | Medium | Deep research |
| sonar-reasoning | 128K | Slower | Multi-step reasoning |
| sonar-reasoning-pro | 200K | Slowest | Complex analysis |

## Quick Start

### Loading the Skill

```typescript
// Embedded in backend-developer.yaml
const skill = await skillLoader.loadSkill('perplexity', 'quick');
// Returns SKILL.md content for fast reference
```

### Using Templates

```bash
# Generate chat handler
cp templates/chat.template.py src/search.py
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

1. **Detection Phase**: Identifies Perplexity by API key or base URL
2. **Loading Phase**: Loads SKILL.md for quick patterns
3. **Code Generation**: Uses templates for boilerplate reduction
4. **Learning Phase**: References examples for best practices

## Key Differentiator: Search-Augmented Generation

Unlike traditional LLMs, Perplexity Sonar:
- **Always searches**: Every query triggers web search
- **Provides citations**: Sources are automatically included
- **Current information**: No knowledge cutoff date
- **Grounded responses**: Answers backed by sources

### When to Choose Perplexity

```
Use Perplexity when:
├── Need current/real-time information
├── Require source citations
├── Building research assistants
├── Fact-checking applications
└── News/market intelligence

Use other providers when:
├── Creative writing (no sources needed)
├── Code generation (better alternatives)
├── Offline/air-gapped environments
└── Cost-sensitive simple queries
```

## Maintenance

### Updating Content

When Perplexity releases new features:
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
- [ ] API endpoint is correct

## Support

For issues or improvements:
- Review existing examples for patterns
- Reference official Perplexity documentation: https://docs.perplexity.ai/

## Performance Metrics

**Target Metrics**:
- Skill load time: <100ms (SKILL.md)
- Template generation: <50ms per file
- Code generation success rate: >=95%
- User satisfaction: >=90%

---

_Part of Skills-Based Framework Architecture_
_Related: @fortium/ensemble-ai_
