# OpenAI SDK Templates

Code generation templates for rapid AI application development with production-ready patterns.

## Available Templates

### 1. chat-completion.template.py
**Python Chat Completions**

Demonstrates:
- OpenAI client initialization
- Message formatting with roles
- Response parsing
- Error handling
- Environment-based configuration

**Placeholders**:
- `{{model}}` -> Model ID (e.g., `gpt-5`)
- `{{system_prompt}}` -> System message content
- `{{max_tokens}}` -> Maximum response tokens

**Usage**:
```bash
cp chat-completion.template.py src/chat.py
# Replace placeholders with actual values
```

---

### 2. chat-completion.template.ts
**TypeScript Chat Completions**

Demonstrates:
- Type-safe OpenAI client usage
- Async/await patterns
- Response typing
- Error handling with types

**Placeholders**:
- `{{model}}` -> Model ID (e.g., `gpt-5`)
- `{{system_prompt}}` -> System message content

**Usage**:
```bash
cp chat-completion.template.ts src/chat.ts
# Replace placeholders with actual values
```

---

### 3. streaming.template.py
**Python Streaming Responses**

Demonstrates:
- Synchronous streaming
- Asynchronous streaming
- Partial content assembly
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

### 4. agent.template.py
**Python Agents SDK**

Demonstrates:
- Agent creation and configuration
- Thread management
- Message handling
- Run execution and polling
- Tool integration

**Placeholders**:
- `{{agent_name}}` -> Agent display name
- `{{agent_instructions}}` -> Agent behavior instructions
- `{{model}}` -> Model ID

**Usage**:
```bash
cp agent.template.py src/agent.py
# Replace placeholders with actual values
```

---

### 5. embeddings.template.py
**Python Embeddings API**

Demonstrates:
- Single text embedding
- Batch embeddings
- Cosine similarity calculation
- Semantic search pattern

**Placeholders**:
- `{{model}}` -> Embedding model (e.g., `text-embedding-3-small`)
- `{{dimensions}}` -> Optional dimension reduction

**Usage**:
```bash
cp embeddings.template.py src/embeddings.py
# Replace placeholders with actual values
```

---

### 6. tool-calling.template.py
**Python Tool Calling (Function Calling)**

Demonstrates:
- Tool definition with typed parameters
- Tool registry for managing multiple tools
- Complete tool execution loop
- Parallel tool call handling
- Error handling and result formatting

**Placeholders**:
- `{{model}}` -> Model ID (e.g., `gpt-5`)
- `{{system_prompt}}` -> System message content
- `{{max_iterations}}` -> Maximum tool iterations (default: 10)

**Usage**:
```bash
cp tool-calling.template.py src/tools.py
# Replace placeholders with actual values
# Register your own tools using register_tool()
```

**Key Classes**:
- `ToolParameter` - Define tool parameters with types and descriptions
- `ToolDefinition` - Define complete tool with handler function
- `ToolRegistry` - Manage and execute tools
- `ToolCallingClient` - OpenAI client with tool loop

---

### 7. responses-api.template.py
**Python Responses API (Next-Generation)**

The Responses API is OpenAI's next-generation API that supports chain-of-thought (CoT) passing between conversation turns, built-in tools, and improved caching.

Demonstrates:
- Basic response creation with instructions
- Chain-of-thought preservation via `previous_response_id`
- Built-in tools (web_search, code_interpreter, file_search)
- Configurable reasoning effort levels
- Streaming responses
- Multi-turn conversation management

**Placeholders**:
- `{{MODEL}}` -> Model ID (e.g., `gpt-4.1`, `o3`)
- `{{SYSTEM_PROMPT}}` -> System instructions
- `{{MAX_OUTPUT_TOKENS}}` -> Maximum output tokens

**Usage**:
```bash
cp responses-api.template.py src/responses.py
# Replace placeholders with actual values
```

**Key Features**:
- `create_response()` - Single response with optional CoT continuation
- `create_response_with_tools()` - Response with built-in tools
- `stream_response()` - Real-time streaming output
- `ResponsesConversation` - Multi-turn conversation manager with CoT
- `ResponsesWithToolsConversation` - Conversation with tools and CoT

**When to Use Responses API vs Chat Completions**:
- Use Responses API for: CoT continuity, built-in tools, agentic apps, better caching
- Use Chat Completions for: fine-grained message control, custom tools, vision

---

## Template Generation Script

For automated template generation with placeholder replacement:

```python
#!/usr/bin/env python3
"""Generate OpenAI code from templates."""
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
    "chat-completion",
    "src/chat.py",
    model="gpt-5",
    system_prompt="You are a helpful assistant.",
    max_tokens="1000"
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
import os
from openai import OpenAI

client = OpenAI()  # Uses OPENAI_API_KEY env var
```

### Error Handling
```python
from openai import OpenAI, APIError, RateLimitError

try:
    response = client.chat.completions.create(...)
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
from openai import RateLimitError

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
def cached_completion(prompt_hash: str, model: str):
    # Implementation
    pass
```

### Adding Metrics
```python
import time

start = time.time()
response = client.chat.completions.create(...)
duration = time.time() - start

# Log or send to metrics service
print(f"Request took {duration:.2f}s")
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for OpenAI patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive OpenAI guide
- [examples/](../examples/) - Real-world implementation examples

---

**Status**: Complete
**Target**: 5 production-ready templates
