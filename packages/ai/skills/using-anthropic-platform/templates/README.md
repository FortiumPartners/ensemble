# Anthropic SDK Templates

Code generation templates for rapid AI application development with production-ready patterns.

## Available Templates

### 1. messages.template.py
**Python Messages API**

Demonstrates:
- Anthropic client initialization
- Message formatting with roles
- Response parsing
- Error handling
- Environment-based configuration

**Placeholders**:
- `{{model}}` -> Model ID (e.g., `claude-sonnet-4-20250514`)
- `{{system_prompt}}` -> System message content
- `{{max_tokens}}` -> Maximum response tokens

**Usage**:
```bash
cp messages.template.py src/chat.py
# Replace placeholders with actual values
```

---

### 2. messages.template.ts
**TypeScript Messages API**

Demonstrates:
- Type-safe Anthropic client usage
- Async/await patterns
- Response typing
- Error handling with types

**Placeholders**:
- `{{model}}` -> Model ID (e.g., `claude-sonnet-4-20250514`)
- `{{system_prompt}}` -> System message content

**Usage**:
```bash
cp messages.template.ts src/chat.ts
# Replace placeholders with actual values
```

---

### 3. streaming.template.py
**Python Streaming Responses**

Demonstrates:
- Synchronous streaming with text_stream
- Asynchronous streaming
- Raw event handling
- Real-time output handling

**Placeholders**:
- `{{model}}` -> Model ID
- `{{system_prompt}}` -> System message

**Usage**:
```bash
cp streaming.template.py src/stream.py
# Replace placeholders with actual values
```

---

### 4. tool-use.template.py
**Python Tool Use (Function Calling)**

Demonstrates:
- Tool definition with input schemas
- Tool registry for managing multiple tools
- Complete tool execution loop
- Parallel tool call handling
- Error handling and result formatting

**Placeholders**:
- `{{model}}` -> Model ID (e.g., `claude-sonnet-4-20250514`)
- `{{system_prompt}}` -> System message content
- `{{max_iterations}}` -> Maximum tool iterations (default: 10)

**Usage**:
```bash
cp tool-use.template.py src/tools.py
# Replace placeholders with actual values
# Register your own tools using register_tool()
```

**Key Classes**:
- `ToolParameter` - Define tool parameters with types and descriptions
- `ToolDefinition` - Define complete tool with handler function
- `ToolRegistry` - Manage and execute tools
- `ToolUseClient` - Anthropic client with tool loop

---

### 5. extended-thinking.template.py
**Python Extended Thinking**

Demonstrates:
- Extended thinking configuration
- Budget tokens management
- Thinking block extraction
- Streaming with thinking blocks

**Placeholders**:
- `{{model}}` -> Model ID (must support thinking, e.g., `claude-sonnet-4-20250514`)
- `{{budget_tokens}}` -> Maximum thinking tokens

**Usage**:
```bash
cp extended-thinking.template.py src/thinking.py
# Replace placeholders with actual values
```

---

## Template Generation Script

For automated template generation with placeholder replacement:

```python
#!/usr/bin/env python3
"""Generate Anthropic code from templates."""
import re
from pathlib import Path

def generate_from_template(
    template_name: str,
    output_path: str,
    **replacements
) -> None:
    """Generate code from template with placeholder replacement."""
    template_dir = Path(__file__).parent
    template_path = template_dir / f"{template_name}.template.py"

    content = template_path.read_text()

    for placeholder, value in replacements.items():
        pattern = r'\{\{' + placeholder + r'\}\}'
        content = re.sub(pattern, value, content)

    Path(output_path).write_text(content)
    print(f"Generated: {output_path}")

# Usage:
generate_from_template(
    "messages",
    "src/chat.py",
    model="claude-sonnet-4-20250514",
    system_prompt="You are a helpful assistant.",
    max_tokens="1024"
)
```

## Validation Checklist

Before using templates in production:

- [ ] All placeholders replaced
- [ ] API key configured via environment
- [ ] Error handling appropriate for use case
- [ ] Rate limiting considered
- [ ] Logging added if needed
- [ ] Tests written for critical paths

## Best Practices

### Environment Configuration
```python
# Always use environment variables for API keys
from anthropic import Anthropic

client = Anthropic()  # Uses ANTHROPIC_API_KEY env var
```

### Error Handling
```python
from anthropic import Anthropic, APIError, RateLimitError

try:
    response = client.messages.create(...)
except RateLimitError:
    # Implement backoff
    pass
except APIError as e:
    # Log and handle
    pass
```

### Logging
```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info(f"Sending request to {model}")
```

## Common Customizations

### Adding Retry Logic
```python
import time
from anthropic import RateLimitError

def call_with_retry(func, max_retries=3):
    for attempt in range(max_retries):
        try:
            return func()
        except RateLimitError:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

### Adding Caching
```python
from functools import lru_cache
import hashlib

@lru_cache(maxsize=100)
def cached_message(prompt_hash: str, model: str):
    # Implementation
    pass
```

### Adding Metrics
```python
import time

start = time.time()
response = client.messages.create(...)
duration = time.time() - start

# Log or send to metrics service
print(f"Request took {duration:.2f}s")
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for Anthropic patterns
- [examples/](../examples/) - Real-world implementation examples

---

**Status**: Complete
**Target**: 5 production-ready templates
