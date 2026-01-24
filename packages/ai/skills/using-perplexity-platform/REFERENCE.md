# Perplexity Sonar API - Comprehensive Reference

**Version**: 1.0.0 | **Purpose**: Advanced patterns, enterprise features, and production-ready implementations

This reference document extends [SKILL.md](SKILL.md) with comprehensive documentation for advanced use cases.

---

## Table of Contents

1. [Context7 Integration](#context7-integration)
2. [Offline Models](#offline-models)
3. [Platform Differentiators](#platform-differentiators)
4. [Enterprise Data Source Partnerships](#enterprise-data-source-partnerships)
5. [Multi-Turn Conversation Management](#multi-turn-conversation-management)
6. [Advanced Citation Handling](#advanced-citation-handling)
7. [Server-Sent Events for Web](#server-sent-events-for-web)
8. [Streaming with Citation Collection](#streaming-with-citation-collection)
9. [Comprehensive Error Handling](#comprehensive-error-handling)
10. [Retry with Exponential Backoff](#retry-with-exponential-backoff)
11. [Production Best Practices](#production-best-practices)
12. [Installation and CLI Commands](#installation-and-cli-commands)

---

## Context7 Integration

For up-to-date documentation beyond this skill's scope, use Context7 MCP when available:

### When to Use Context7

| Scenario | Context7 Query |
|----------|----------------|
| API docs latest | `resolve-library-id: perplexity` then `query-docs` |
| Model updates | Query for "perplexity sonar models" |
| Rate limits | Query "perplexity rate limits" |

### Context7 Query Pattern

```python
# When you need current documentation:
# 1. Resolve the library ID
mcp__context7__resolve-library-id(libraryName="perplexity", query="sonar api")

# 2. Query the docs with the resolved ID
mcp__context7__query-docs(libraryId="/perplexity/docs", query="citations streaming")
```

**Use Context7 when**:
- SDK version-specific features needed
- Rate limit details required
- Model availability changes
- New features announced

**Use this skill when**:
- General Perplexity patterns and idioms
- Model selection decisions
- Common API usage patterns
- Citation handling patterns
- Error handling patterns

---

## Offline Models

### Available Offline Models (No Search)

| Model | Context | Use Case |
|-------|---------|----------|
| `llama-3.1-sonar-small-128k-online` | 128K | Cost-effective, simple queries |
| `llama-3.1-sonar-large-128k-online` | 128K | Balanced quality/cost |
| `llama-3.1-sonar-huge-128k-online` | 128K | Maximum quality |

Use offline models when:
- No web search is needed
- Working with static knowledge
- Cost optimization is priority
- Faster response times needed

---

## Platform Differentiators

| Feature | Perplexity | Description |
|---------|------------|-------------|
| Real-time Search | Native | Every query can search the live web |
| Citations | Built-in | Automatic source attribution in responses |
| OpenAI Compatible | API | Use OpenAI SDK with different base URL |
| Search Grounding | Default | Responses grounded in web sources |
| Recency Focus | Strong | Optimized for current information |
| Source Quality | Curated | Filters for authoritative sources |
| No Training Data Cutoff | Yes | Always accesses current web |
| Academic Search | Supported | Can focus on scholarly sources |

---

## Enterprise Data Source Partnerships

Perplexity has partnerships with premium data providers. Understanding what's available and how to access it is important.

### Enterprise Pro Data Integrations (Web Interface Only)

| Partner | Data Type | Access |
|---------|-----------|--------|
| Crunchbase | Private company firmographics, funding, financials | Enterprise Pro only |
| FactSet | M&A data, earnings transcripts, financial analysis | Enterprise Pro only |
| Coinbase | Real-time cryptocurrency market data | Enterprise Pro only |

**Important**: These data integrations are **only available through the Perplexity Enterprise Pro web interface** - they are NOT accessible via the Sonar API.

### How Enterprise Data Integrations Work

1. **Configuration**: Admin enables integration in Perplexity Settings - Organization tab
2. **Authentication**: Requires separate API key from the data provider
3. **Usage**: Select data source in the web UI search bar when querying
4. **Citations**: Proprietary data appears alongside web sources in responses

```
Enterprise Pro Web UI Flow:
+-------------------------------------------------------------+
| Perplexity Enterprise Pro (Web Interface)                   |
| +----------------------------------------------------------+|
| | Search: [Query                              ] [Sources v]||
| |                                              +---------+ ||
| |                                              |* Web    | ||
| |                                              |* Crunch.| ||
| |                                              |* FactSet| ||
| |                                              +---------+ ||
| +----------------------------------------------------------+|
+-------------------------------------------------------------+
```

### Sonar API: What IS Available

For developers using the Sonar API, you have access to:

| Feature | API Parameter | Description |
|---------|---------------|-------------|
| Domain filtering | `search_domain_filter` | Restrict to trusted domains |
| Recency filtering | `search_recency_filter` | day, week, month, year |
| Academic focus | System prompt + domain filter | Scholarly sources |
| Web search | Built-in | Always included |
| Citations | Response metadata | Automatic source attribution |

```python
# Sonar API: Domain filtering for specific sources
response = client.chat.completions.create(
    model="sonar-pro",
    messages=[{"role": "user", "content": "Startup funding trends"}],
    extra_body={
        # Filter to trusted business/financial domains
        "search_domain_filter": [
            "techcrunch.com",
            "bloomberg.com",
            "reuters.com",
            "wsj.com"
        ],
        "search_recency_filter": "month"
    }
)
```

### Sonar API: What is NOT Available

- Direct Crunchbase data access via API
- Direct FactSet financial data via API
- Direct Coinbase market data via API
- Any `data_source` or `integration` API parameter

### Workarounds for API Users

If you need premium data source content via the API:

1. **Domain filtering**: Use `search_domain_filter` to prioritize authoritative public sources
2. **System prompts**: Guide the model to focus on specific data types
3. **Separate APIs**: Call Crunchbase/FactSet APIs directly and combine with Perplexity results

```python
# Workaround: Combine Perplexity web search with direct API calls
import requests
from openai import OpenAI

# Get general context from Perplexity
pplx_client = OpenAI(api_key="pplx-...", base_url="https://api.perplexity.ai")
context = pplx_client.chat.completions.create(
    model="sonar",
    messages=[{"role": "user", "content": "Latest news about Anthropic AI company"}]
)

# Get structured data from Crunchbase API directly (separate subscription)
crunchbase_response = requests.get(
    "https://api.crunchbase.com/v4/entities/organizations/anthropic",
    headers={"X-cb-user-key": "your-crunchbase-key"}
)

# Combine insights as needed
```

---

## Multi-Turn Conversation Management

```python
class PerplexityConversation:
    """Manage multi-turn conversations with search context."""

    def __init__(self, system_prompt: str, model: str = "sonar"):
        self.messages = [{"role": "system", "content": system_prompt}]
        self.model = model
        self.client = OpenAI(
            api_key="pplx-...",
            base_url="https://api.perplexity.ai"
        )
        self.all_citations = []

    def chat(self, user_message: str) -> str:
        self.messages.append({"role": "user", "content": user_message})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=self.messages
        )

        assistant_message = response.choices[0].message.content
        self.messages.append({"role": "assistant", "content": assistant_message})

        # Collect citations if available
        if hasattr(response, 'citations'):
            self.all_citations.extend(response.citations)

        return assistant_message

    def get_citations(self) -> list:
        """Get all citations from the conversation."""
        return list(set(self.all_citations))

    def clear(self) -> None:
        """Clear conversation history, keep system prompt."""
        self.messages = self.messages[:1]
        self.all_citations = []


# Usage
conv = PerplexityConversation("You are a research assistant focused on technology.")
print(conv.chat("What are the latest AI breakthroughs?"))
print(conv.chat("Tell me more about the first one."))
print("\nAll sources:", conv.get_citations())
```

---

## Advanced Citation Handling

### Extracting Structured Citations

```python
from openai import OpenAI
from dataclasses import dataclass
from typing import Optional

@dataclass
class Citation:
    """Structured citation information."""
    url: str
    title: Optional[str] = None
    snippet: Optional[str] = None

def get_response_with_citations(
    client: OpenAI,
    query: str,
    model: str = "sonar"
) -> tuple[str, list[Citation]]:
    """Get response with structured citations."""
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": query}]
    )

    content = response.choices[0].message.content
    citations = []

    # Parse citations from response metadata
    if hasattr(response, 'citations'):
        for i, url in enumerate(response.citations):
            citations.append(Citation(url=url, title=f"Source {i+1}"))

    return content, citations
```

### Inline Citation Handling

```python
import re
from typing import NamedTuple

class InlineCitation(NamedTuple):
    """Citation reference in text."""
    index: int
    position: int
    url: str | None

def parse_inline_citations(
    content: str,
    citations: list[str]
) -> list[InlineCitation]:
    """Extract inline citation references like [1], [2], etc."""
    results = []
    pattern = r'\[(\d+)\]'

    for match in re.finditer(pattern, content):
        index = int(match.group(1)) - 1  # 0-indexed
        url = citations[index] if index < len(citations) else None
        results.append(InlineCitation(
            index=index + 1,
            position=match.start(),
            url=url
        ))

    return results


def format_response_with_footnotes(
    content: str,
    citations: list[str]
) -> str:
    """Format response with footnote-style citations."""
    result = content + "\n\n---\nSources:\n"

    for i, url in enumerate(citations, 1):
        result += f"[{i}] {url}\n"

    return result
```

### Citation Quality Filtering

```python
def filter_citations_by_domain(
    citations: list[str],
    trusted_domains: list[str] | None = None,
    blocked_domains: list[str] | None = None
) -> list[str]:
    """Filter citations by domain trustworthiness."""
    from urllib.parse import urlparse

    trusted = trusted_domains or []
    blocked = blocked_domains or []

    filtered = []
    for url in citations:
        try:
            domain = urlparse(url).netloc.lower()

            # Skip blocked domains
            if any(bd in domain for bd in blocked):
                continue

            # If trusted list provided, only include those
            if trusted:
                if any(td in domain for td in trusted):
                    filtered.append(url)
            else:
                filtered.append(url)

        except Exception:
            continue

    return filtered


# Usage
citations = get_response_citations(response)
academic_only = filter_citations_by_domain(
    citations,
    trusted_domains=[".edu", ".gov", "nature.com", "science.org"]
)
```

---

## Server-Sent Events for Web

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from openai import OpenAI

app = FastAPI()
client = OpenAI(
    api_key="pplx-...",
    base_url="https://api.perplexity.ai"
)

@app.get("/search")
async def search_endpoint(query: str):
    """SSE endpoint for streaming search responses."""

    def generate():
        stream = client.chat.completions.create(
            model="sonar",
            messages=[{"role": "user", "content": query}],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                yield f"data: {content}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

---

## Streaming with Citation Collection

```python
def stream_with_citations(
    client: OpenAI,
    query: str,
    model: str = "sonar"
) -> tuple[str, list[str]]:
    """Stream response and collect citations at the end."""
    collected = []
    citations = []

    # Note: Citations typically come in the final chunk or response metadata
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": query}],
        stream=True
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected.append(content)
            print(content, end="", flush=True)

        # Check for citations in chunk metadata
        if hasattr(chunk, 'citations'):
            citations.extend(chunk.citations)

    print()  # Newline after streaming
    return "".join(collected), citations
```

---

## Comprehensive Error Handling

### Exception Types

```python
from openai import (
    OpenAI,
    APIError,
    APIConnectionError,
    RateLimitError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    InternalServerError
)
```

### Full Error Handling Pattern

```python
from openai import (
    OpenAI,
    APIError,
    RateLimitError,
    AuthenticationError,
    APIConnectionError
)
import logging
import time

logger = logging.getLogger(__name__)

def create_perplexity_client() -> OpenAI:
    """Create configured Perplexity client."""
    return OpenAI(
        api_key="pplx-...",
        base_url="https://api.perplexity.ai"
    )

def safe_search(
    query: str,
    max_retries: int = 3,
    model: str = "sonar"
) -> str | None:
    """Make API call with comprehensive error handling."""
    client = create_perplexity_client()

    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": query}]
            )
            return response.choices[0].message.content

        except AuthenticationError as e:
            logger.error("Invalid API key - check PERPLEXITY_API_KEY")
            raise  # Don't retry auth errors

        except RateLimitError as e:
            if attempt == max_retries - 1:
                raise
            wait_time = (2 ** attempt) + 1  # Exponential backoff
            logger.warning(f"Rate limited, retrying in {wait_time}s")
            time.sleep(wait_time)

        except APIConnectionError as e:
            if attempt == max_retries - 1:
                raise
            logger.warning("Connection error, retrying...")
            time.sleep(1)

        except APIError as e:
            if e.status_code >= 500:  # Server errors
                if attempt == max_retries - 1:
                    raise
                wait_time = (2 ** attempt) + 1
                logger.warning(f"Server error {e.status_code}, retrying in {wait_time}s")
                time.sleep(wait_time)
            else:
                raise  # Client errors shouldn't be retried

    return None
```

---

## Retry with Exponential Backoff

```python
import time
from functools import wraps
from typing import TypeVar, Callable

T = TypeVar("T")

def retry_with_backoff(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0
) -> Callable:
    """Decorator for retrying with exponential backoff."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except RateLimitError:
                    if attempt == max_retries - 1:
                        raise
                    delay = min(base_delay * (2 ** attempt), max_delay)
                    time.sleep(delay)
            raise Exception("Max retries exceeded")
        return wrapper
    return decorator


@retry_with_backoff(max_retries=5)
def search_with_retry(query: str) -> str:
    client = create_perplexity_client()
    response = client.chat.completions.create(
        model="sonar",
        messages=[{"role": "user", "content": query}]
    )
    return response.choices[0].message.content
```

---

## Production Best Practices

### API Key Management

```python
# GOOD: Use environment variable
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("PERPLEXITY_API_KEY"),
    base_url="https://api.perplexity.ai"
)

# GOOD: Use secret manager
from your_secret_manager import get_secret

client = OpenAI(
    api_key=get_secret("perplexity-api-key"),
    base_url="https://api.perplexity.ai"
)

# BAD: Never hardcode keys
# client = OpenAI(api_key="pplx-...")  # NEVER DO THIS
```

### Response Formatting

```python
def format_response_for_display(content: str, citations: list[str]) -> str:
    """Format response with proper citation attribution."""
    output = content

    # Add sources section if citations exist
    if citations:
        output += "\n\n---\n**Sources:**\n"
        for i, url in enumerate(citations, 1):
            output += f"{i}. {url}\n"

    return output
```

### Production Checklist

**Pre-Flight Checklist**:
- [ ] `PERPLEXITY_API_KEY` environment variable set
- [ ] API key has sufficient permissions
- [ ] Rate limits understood for your tier
- [ ] Error handling implemented
- [ ] Retry logic with exponential backoff
- [ ] Appropriate model selected for task
- [ ] Cost estimates reviewed
- [ ] Citation handling implemented
- [ ] Streaming implemented for long responses

**Production Readiness**:
- [ ] Secrets in secret manager (not env files)
- [ ] Monitoring/alerting for API errors
- [ ] Usage tracking and cost alerts
- [ ] Fallback behavior for API failures
- [ ] Rate limiting at application level
- [ ] Input validation before API calls
- [ ] Citation verification workflow
- [ ] Logging for debugging (without PII)

---

## Installation and CLI Commands

### Installation

```bash
# Python (uses OpenAI SDK)
pip install openai

# Node.js
npm install openai
yarn add openai
pnpm add openai
```

### Environment Setup

```bash
# Set API key
export PERPLEXITY_API_KEY="pplx-..."

# Alternative name
export PPLX_API_KEY="pplx-..."
```

### Quick Testing

```bash
# Test API access (Python)
python -c "
from openai import OpenAI
client = OpenAI(api_key='pplx-...', base_url='https://api.perplexity.ai')
r = client.chat.completions.create(model='sonar', messages=[{'role':'user','content':'Hello'}])
print(r.choices[0].message.content)
"

# Using curl
curl -X POST https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer pplx-..." \
  -H "Content-Type: application/json" \
  -d '{"model": "sonar", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## See Also

- [SKILL.md](SKILL.md) - Quick reference for common patterns
- [templates/](templates/) - Production-ready code templates
- [examples/](examples/) - Working examples
- [Perplexity API Docs](https://docs.perplexity.ai/)
- [Perplexity Playground](https://labs.perplexity.ai/)

---

**Last Updated**: 2026-01-01
