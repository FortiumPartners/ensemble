# Anthropic SDK Examples

Real-world implementation examples demonstrating production-ready patterns for the Anthropic Claude API.

## Available Examples

### 1. basic-chat.example.py
**Basic Chat Completion**

A simple but complete example showing:
- Client initialization
- Single message exchange
- Multi-turn conversation
- Response parsing
- Usage tracking

**Run**:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
python basic-chat.example.py
```

---

### 2. tool-use.example.py
**Tool Use / Function Calling**

Complete tool use implementation with:
- Multiple tool definitions
- Execution loop
- Parallel tool handling
- Error handling
- Result formatting

**Run**:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
python tool-use.example.py "What's the weather in London and Paris?"
```

---

### 3. streaming.example.py
**Streaming Responses**

Real-time streaming examples:
- Synchronous streaming
- Asynchronous streaming
- Event-based streaming
- Progress indicators

**Run**:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
python streaming.example.py "Write a poem about coding"
```

---

### 4. vision.example.py
**Image Analysis**

Vision/multimodal capabilities:
- Base64 image encoding
- URL-based images
- Multiple image comparison
- Detailed analysis prompts

**Run**:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
python vision.example.py path/to/image.jpg "Describe this image"
```

---

## Common Setup

All examples require:

1. **API Key**: Set the `ANTHROPIC_API_KEY` environment variable
2. **Python**: Version 3.9 or higher
3. **Package**: Install with `pip install anthropic`

```bash
# Install
pip install anthropic

# Set API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Run any example
python <example-name>.py
```

## Best Practices Demonstrated

### Error Handling
All examples include proper error handling for:
- Authentication errors
- Rate limiting
- Connection issues
- API errors

### Logging
Examples use structured logging for debugging:
```python
import logging
logging.basicConfig(level=logging.INFO)
```

### Type Hints
Full type annotations for better IDE support and maintainability.

### Cost Tracking
Token usage is logged for cost monitoring:
```python
logger.info(f"Tokens: Input={usage.input_tokens}, Output={usage.output_tokens}")
```

## Customization Tips

### Change Model
```python
# Replace model in any example
MODEL = "claude-3-5-haiku-20241022"  # Faster, cheaper
MODEL = "claude-opus-4-5-20251101"   # Maximum capability
```

### Add Retry Logic
```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
def call_api():
    return client.messages.create(...)
```

### Add Caching
```python
from functools import lru_cache

@lru_cache(maxsize=100)
def cached_response(prompt_hash: str) -> str:
    # Lookup cached response
    pass
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference patterns
- [templates/](../templates/) - Code generation templates
- [Anthropic Docs](https://docs.anthropic.com/)

---

**Status**: Complete
**Models Tested**: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022
