# Perplexity Sonar SDK Examples

Production-ready implementation examples demonstrating Perplexity API best practices for search-augmented AI applications.

## Available Examples

### 1. basic-chat.example.py
**Basic Search-Augmented Chat**

A straightforward example demonstrating:
- Client initialization with environment variables
- Single search query completion
- Multi-turn conversations with context
- System prompts for search focus
- Citation extraction and display
- Error handling

**Best For**: Getting started, simple Q&A applications, understanding API basics

**Run**:
```bash
export PERPLEXITY_API_KEY="pplx-..."
python basic-chat.example.py
```

---

### 2. streaming.example.py
**Streaming Responses**

Real-time streaming example demonstrating:
- Token-by-token console output with flush
- Content collection during streaming
- Async streaming with AsyncOpenAI
- SSE generator for web applications
- Progress indication
- Streaming conversation manager

**Best For**: Chat interfaces, real-time applications, long responses

**Run**:
```bash
python streaming.example.py
```

---

### 3. citations.example.py
**Citation Handling**

Comprehensive citation example demonstrating:
- Citation extraction from responses
- Inline citation parsing [1], [2] style
- Citation formatting for display
- Domain-based citation filtering
- Academic source prioritization
- Citation quality scoring

**Best For**: Research applications, fact-checking, source verification

**Run**:
```bash
python citations.example.py
```

---

### 4. research-assistant.example.py
**Research Assistant Pattern**

Full research assistant example demonstrating:
- Multi-step research workflow
- Domain-focused searching
- Citation aggregation across queries
- Report generation with sources
- Follow-up question handling
- Research session management

**Best For**: Research tools, report generation, comprehensive analysis

**Run**:
```bash
python research-assistant.example.py
```

---

## Running Examples

### Prerequisites

1. Install required packages:
```bash
pip install openai
```

2. Set your API key:
```bash
export PERPLEXITY_API_KEY="pplx-..."
# or
export PPLX_API_KEY="pplx-..."
```

### Execution

Each example is self-contained and can be run directly:

```bash
cd examples/
python <example-name>.example.py
```

### Expected Output

Each example prints structured output with section headers:
```
============================================================
Perplexity Basic Chat Examples
============================================================

=== Single Search Query ===

Question: What are the latest AI developments?
Answer: [Search-augmented response...]

Sources:
1. https://techcrunch.com/...
2. https://arxiv.org/...

...
```

---

## Code Quality Standards

All examples follow these production standards:

| Standard | Implementation |
|----------|----------------|
| Type hints | All function signatures typed |
| Docstrings | All public functions documented |
| Error handling | Try/except with specific exceptions |
| Security | No hardcoded credentials |
| Structure | Clear section organization |
| Output | Formatted console output |
| Citations | Properly extracted and displayed |

---

## Quick Reference

| Use Case | Example File |
|----------|--------------|
| Basic API usage | `basic-chat.example.py` |
| Real-time output | `streaming.example.py` |
| Source handling | `citations.example.py` |
| Research workflows | `research-assistant.example.py` |

---

## Integration Patterns

### Web Application (Flask)

```python
from flask import Flask, request, jsonify
from openai import OpenAI

app = Flask(__name__)
client = OpenAI(
    api_key="pplx-...",
    base_url="https://api.perplexity.ai"
)

@app.route('/search', methods=['POST'])
def search():
    query = request.json['query']
    response = client.chat.completions.create(
        model="sonar",
        messages=[{"role": "user", "content": query}]
    )
    return jsonify({
        'answer': response.choices[0].message.content,
        'citations': getattr(response, 'citations', [])
    })
```

### CLI Application

```python
import sys
from openai import OpenAI

client = OpenAI(api_key="pplx-...", base_url="https://api.perplexity.ai")
response = client.chat.completions.create(
    model="sonar",
    messages=[{"role": "user", "content": " ".join(sys.argv[1:])}]
)
print(response.choices[0].message.content)
```

### Async Web Application (FastAPI)

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI

app = FastAPI()
client = AsyncOpenAI(api_key="pplx-...", base_url="https://api.perplexity.ai")

@app.get('/stream')
async def stream(query: str):
    async def generate():
        stream = await client.chat.completions.create(
            model="sonar",
            messages=[{"role": "user", "content": query}],
            stream=True
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    return StreamingResponse(generate(), media_type="text/plain")
```

---

## Perplexity-Specific Considerations

### Search Is Always On
Unlike traditional LLMs, every Perplexity query searches the web:
- No need for RAG pipelines
- Always current information
- Automatic citation

### Optimize Queries for Search
```python
# BAD: Vague query
"Tell me about AI"

# GOOD: Specific, searchable query
"What are the top 3 AI research papers published in December 2024?"
```

### Handle Citations
```python
# Always check for and display citations
if hasattr(response, 'citations'):
    for url in response.citations:
        print(f"Source: {url}")
```

### Use Recency Filters for Time-Sensitive Queries
```python
response = client.chat.completions.create(
    model="sonar",
    messages=[{"role": "user", "content": "Stock market news"}],
    extra_body={"search_recency_filter": "day"}
)
```

---

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for Perplexity patterns
- [templates/](../templates/) - Code generation templates
- [VALIDATION.md](../VALIDATION.md) - Feature coverage matrix

---

**Status**: Complete (4 production-ready examples)
**Last Updated**: 2026-01-01
