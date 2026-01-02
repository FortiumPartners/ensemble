# Perplexity Sonar SDK Templates

Code generation templates for rapid search-augmented AI application development with production-ready patterns.

## Available Templates

### 1. chat.template.py
**Python Chat Completions with Search**

Demonstrates:
- Perplexity client initialization using OpenAI SDK
- Message formatting with roles
- Search-augmented response parsing
- Citation extraction
- Error handling
- Environment-based configuration

**Placeholders**:
- `{{MODEL}}` -> Model ID (e.g., `sonar`, `sonar-pro`)
- `{{SYSTEM_PROMPT}}` -> System message content
- `{{MAX_TOKENS}}` -> Maximum response tokens

**Usage**:
```bash
cp chat.template.py src/search_chat.py
# Replace placeholders with actual values
```

---

### 2. chat.template.ts
**TypeScript Chat Completions with Search**

Demonstrates:
- Type-safe Perplexity client setup
- Async/await patterns
- Response typing
- Citation handling
- Error handling with types

**Placeholders**:
- `{{MODEL}}` -> Model ID (e.g., `sonar`)
- `{{SYSTEM_PROMPT}}` -> System message content

**Usage**:
```bash
cp chat.template.ts src/search_chat.ts
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
- Citation collection during streaming

**Placeholders**:
- `{{MODEL}}` -> Model ID
- `{{SYSTEM_PROMPT}}` -> System message

**Usage**:
```bash
cp streaming.template.py src/stream.py
# Replace placeholders with actual values
```

---

### 4. search-config.template.py
**Python Search Configuration**

Demonstrates:
- Domain filtering for targeted search
- Recency filtering for current information
- Academic source focus
- Related questions retrieval
- Image retrieval configuration

**Placeholders**:
- `{{MODEL}}` -> Model ID
- `{{ALLOWED_DOMAINS}}` -> List of allowed domains
- `{{RECENCY_FILTER}}` -> day, week, month, or year

**Usage**:
```bash
cp search-config.template.py src/search_config.py
# Replace placeholders with actual values
```

---

## Template Generation Script

For automated template generation with placeholder replacement:

```python
#!/usr/bin/env python3
"""Generate Perplexity code from templates."""
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
    "chat",
    "src/search_chat.py",
    MODEL="sonar-pro",
    SYSTEM_PROMPT="You are a helpful research assistant.",
    MAX_TOKENS="2000"
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
- [ ] Citation handling verified

## Best Practices

### Environment Configuration
```python
# Always use environment variables for API keys
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("PERPLEXITY_API_KEY"),
    base_url="https://api.perplexity.ai"
)
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

### Citation Handling
```python
# Always preserve citations for transparency
response = client.chat.completions.create(...)
content = response.choices[0].message.content

if hasattr(response, 'citations'):
    for i, url in enumerate(response.citations, 1):
        print(f"[{i}] {url}")
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
def cached_search(query_hash: str, model: str):
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
print(f"Search request took {duration:.2f}s")
```

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for Perplexity patterns
- [examples/](../examples/) - Real-world implementation examples

---

**Status**: Complete
**Target**: 4 production-ready templates
