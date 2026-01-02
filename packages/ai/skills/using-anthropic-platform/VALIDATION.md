# Anthropic SDK Skill - Validation Matrix

**Version**: 2.0.0
**Last Validated**: 2026-01-01

## Feature Coverage Matrix

### Messages API

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Basic message | Yes | Yes | Yes | Complete |
| Multi-turn conversation | Yes | Yes | Yes | Complete |
| System prompts | Yes | Yes | Yes | Complete |
| Temperature control | Yes | Yes | No | Complete |
| Max tokens | Yes | Yes | Yes | Complete |
| Stop sequences | Yes | No | No | Complete |
| Metadata | Yes | No | No | Complete |

### Streaming

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Sync streaming | Yes | Yes | Yes | Complete |
| Async streaming | Yes | Yes | Yes | Complete |
| Text stream helper | Yes | Yes | Yes | Complete |
| Raw event streaming | Yes | Yes | No | Complete |
| SSE for web | Yes | No | No | Complete |

### Tool Use

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Tool definition | Yes | Yes | Yes | Complete |
| Tool execution loop | Yes | Yes | Yes | Complete |
| Parallel tool calls | Yes | Yes | Yes | Complete |
| Tool choice options | Yes | Yes | No | Complete |
| Streaming with tools | Yes | No | No | Complete |

### Extended Thinking

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Basic usage | Yes | Yes | No | Complete |
| Budget tokens | Yes | Yes | No | Complete |
| Streaming with thinking | Yes | Yes | No | Complete |
| Thinking block handling | Yes | Yes | No | Complete |

### Vision/Multimodal

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Image from base64 | Yes | No | Yes | Complete |
| Image from URL | Yes | No | Yes | Complete |
| Multiple images | Yes | No | Yes | Complete |
| PDF documents | Yes | No | No | Complete |

### Prompt Caching

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Cache control | Yes | No | No | Complete |
| System prompt caching | Yes | No | No | Complete |
| Conversation caching | Yes | No | No | Complete |
| Cache usage tracking | Yes | No | No | Complete |

### Error Handling

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Exception types | Yes | Yes | No | Complete |
| Retry with backoff | Yes | Yes | No | Complete |
| Rate limit handling | Yes | Yes | No | Complete |
| Authentication errors | Yes | Yes | No | Complete |

### Agent SDK (NEW)

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| ClaudeOptions configuration | Yes | No | No | Complete |
| Permission modes | Yes | No | No | Complete |
| Tool access (Task, Read, Write, Edit, Bash) | Yes | No | No | Complete |
| Session management | Yes | No | No | Complete |
| Streaming responses | Yes | No | No | Complete |
| Python SDK | Yes | No | No | Complete |
| TypeScript SDK | Yes | No | No | Complete |

### Message Batches API (NEW)

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Create batch | Yes | No | No | Complete |
| Check batch status | Yes | No | No | Complete |
| Retrieve batch results | Yes | No | No | Complete |
| Cancel batch | Yes | No | No | Complete |
| List batches | Yes | No | No | Complete |
| Batch processing limits | Yes | No | No | Complete |

### Computer Use (Beta) (NEW)

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Computer tool definition | Yes | No | No | Complete |
| Text editor tool | Yes | No | No | Complete |
| Bash tool | Yes | No | No | Complete |
| Screenshot capture | Yes | No | No | Complete |
| Mouse actions | Yes | No | No | Complete |
| Keyboard actions | Yes | No | No | Complete |
| Computer use loop | Yes | No | No | Complete |
| Safety considerations | Yes | No | No | Complete |

### MCP Integration (NEW)

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| MCP architecture overview | Yes | No | No | Complete |
| MCP tools in Messages API | Yes | No | No | Complete |
| MCP server example | Yes | No | No | Complete |
| Integration points | Yes | No | No | Complete |

### Citations (NEW)

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Enable citations | Yes | No | No | Complete |
| Citation response structure | Yes | No | No | Complete |
| Multiple document citations | Yes | No | No | Complete |
| Citation best practices | Yes | No | No | Complete |

### Platform Differentiators (NEW)

| Feature | SKILL.md | Templates | Examples | Status |
|---------|----------|-----------|----------|--------|
| Feature comparison table | Yes | No | No | Complete |
| Extended thinking support | Yes | No | No | Complete |
| Computer use support | Yes | No | No | Complete |
| Batch processing support | Yes | No | No | Complete |
| Citations support | Yes | No | No | Complete |

## Model Coverage

| Model | Documented | Context | Max Output | Extended Thinking | Computer Use | Batches |
|-------|------------|---------|------------|-------------------|--------------|---------|
| claude-opus-4-5-20251101 | Yes | 200K | 32K | Yes | Yes | Yes |
| claude-sonnet-4-20250514 | Yes | 200K | 64K | Yes | Yes | Yes |
| claude-3-5-sonnet-20241022 | Yes | 200K | 8K | No | Yes | Yes |
| claude-3-5-haiku-20241022 | Yes | 200K | 8K | No | No | Yes |
| claude-3-opus-20240229 | Yes | 200K | 4K | No | Yes | Yes |
| claude-3-sonnet-20240229 | Yes | 200K | 4K | No | No | Yes |
| claude-3-haiku-20240307 | Yes | 200K | 4K | No | No | Yes |

## Template Coverage

| Template | Language | API | Features | Status |
|----------|----------|-----|----------|--------|
| messages.template.py | Python | Messages | Basic, error handling | Complete |
| messages.template.ts | TypeScript | Messages | Basic, typing | Complete |
| streaming.template.py | Python | Messages | Sync/async streaming | Complete |
| tool-use.template.py | Python | Messages | Tool loop, registry, execution | Complete |
| extended-thinking.template.py | Python | Messages | Thinking blocks, streaming | Complete |

## Example Coverage

| Example | Use Case | Complexity | Tested | Status |
|---------|----------|------------|--------|--------|
| basic-chat.example.py | Simple chat | Low | Yes | Complete |
| tool-use.example.py | Tool execution | Medium | Yes | Complete |
| streaming.example.py | Real-time output | Medium | Yes | Complete |
| vision.example.py | Image analysis | Medium | Yes | Complete |

## Quality Gates

### Documentation Quality

- [x] SKILL.md file size <= 100KB
- [x] All code examples are syntactically correct
- [x] All code examples follow best practices
- [x] No hardcoded API keys in examples
- [x] Error handling demonstrated

### Template Quality

- [x] All templates have proper placeholders
- [x] Templates include error handling
- [x] Templates follow language conventions
- [x] Templates are well-commented
- [x] Templates include usage instructions

### Example Quality

- [x] Examples are production-ready
- [x] Examples include proper imports
- [x] Examples demonstrate best practices
- [x] Examples have proper documentation
- [x] Examples handle errors gracefully

## Validation Checklist

Before each release:

- [ ] All model information is current
- [ ] API endpoints match current Anthropic documentation
- [ ] Code examples compile/run without errors
- [ ] Templates generate valid code
- [ ] Examples execute successfully
- [ ] Feature coverage >= 95%
- [ ] No deprecated API usage

## Known Limitations

1. **Agent SDK Templates**: No templates yet for Agent SDK patterns
2. **Batches API Templates**: No templates yet for batch processing
3. **Computer Use Examples**: No production examples (beta feature, safety concerns)
4. **MCP Server Examples**: Basic server example only, advanced patterns in separate MCP skill
5. **Bedrock/Vertex**: Provider-specific configurations mentioned but not detailed
6. **Citations Examples**: No production examples yet

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-01-01 | Added Agent SDK, Batches API, Computer Use, MCP, Citations, Platform Differentiators |
| 1.0.0 | 2026-01-01 | Initial release with Claude 4 coverage |

---

**Next Review**: 2026-04-01
**Maintainer**: Fortium Software Configuration Team
