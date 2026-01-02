# OpenAI SDK Examples

Production-ready implementation examples demonstrating OpenAI API best practices for Python applications.

## Available Examples

### 1. basic-chat.example.py
**Basic Chat Completion**

A straightforward example demonstrating:
- Client initialization with environment variables
- Single message completion
- Multi-turn conversations
- System prompts and persona configuration
- JSON mode for structured responses
- Temperature and parameter tuning
- Comprehensive error handling

**Best For**: Getting started, simple Q&A applications, understanding API basics

**Run**:
```bash
python basic-chat.example.py
```

---

### 2. tool-calling.example.py
**Tool Calling (Function Calling)**

Comprehensive tool calling example demonstrating:
- Tool/function definition with JSON schema
- Multiple tool implementations (weather, time, calculator, search)
- Tool execution loop with automatic handling
- Parallel tool calls processing
- Result handling and conversation continuation
- Agent-style architecture patterns

**Best For**: Building agents, automated workflows, API integrations

**Run**:
```bash
python tool-calling.example.py
```

---

### 3. streaming.example.py
**Streaming Responses**

Real-time streaming example demonstrating:
- Token-by-token console output with flush
- Content collection during streaming
- Generator patterns for reusable streams
- Progress indication and token counting
- Multi-message streaming conversations
- Async streaming with AsyncOpenAI
- Concurrent async streams
- Timeout handling for streams

**Best For**: Chat interfaces, real-time applications, long responses

**Run**:
```bash
python streaming.example.py
# Or async mode:
python streaming.example.py --async
```

---

### 4. embeddings.example.py
**Embeddings and Semantic Search**

Embeddings example demonstrating:
- Single and batch text embedding generation
- Dimension reduction with v3 models
- Cosine similarity calculation
- Euclidean distance measurement
- Semantic search implementation
- Simple text clustering
- Model comparison (small vs large)

**Best For**: Search applications, recommendations, document clustering, RAG systems

**Run**:
```bash
python embeddings.example.py
```

---

### 5. structured-output.example.py
**Structured Output with JSON Schema**

Structured extraction example demonstrating:
- JSON mode for guaranteed JSON responses
- JSON Schema for complex data structures
- Person/product data extraction
- Sentiment analysis with structured output
- Nested schema definitions
- Strict mode validation
- Error handling for structured outputs

**Best For**: Data extraction, form parsing, structured API responses

**Run**:
```bash
python structured-output.example.py
```

---

### 6. async-client.example.py
**Asynchronous Client Patterns**

Async example demonstrating:
- AsyncOpenAI client setup and usage
- Sequential vs concurrent async calls
- Performance comparison (concurrent wins!)
- Timeout handling with asyncio.wait_for
- Rate limiting with semaphores
- Batch processing patterns
- Error handling with retries
- Async streaming
- Context manager usage
- Parallel analysis patterns
- Multi-user conversation handling

**Best For**: High-throughput applications, web servers, batch processing

**Run**:
```bash
python async-client.example.py
```

---

### 7. multi-turn.example.py
**Multi-Turn Conversation Management**

Context management example demonstrating:
- Conversation history tracking
- Context window management with sliding window
- Message summarization for long conversations
- System prompt strategies and personas
- Context injection mid-conversation
- Conversation branching/forking
- ConversationManager class pattern
- Multiple concurrent conversations
- Conversation persistence (save/load)

**Best For**: Chatbots, virtual assistants, support systems

**Run**:
```bash
python multi-turn.example.py
```

---

### 8. agent.example.py
**Agents (Assistants API)**

Comprehensive Assistants API example demonstrating:
- Basic assistant creation and configuration
- Persistent threads for conversation history
- Built-in tools: code_interpreter, file_search
- Custom function tools with JSON schema
- Tool call handling and execution loop
- Streaming run responses in real-time
- File search with vector stores (RAG)
- Mega agent pattern (many tools in one agent)
- Reusable AgentManager class with context manager
- Proper cleanup and resource management

**Best For**: Building AI agents, automated workflows, customer support, RAG systems

**Run**:
```bash
python agent.example.py
```

---

### 9. responses-api.example.py
**Responses API (Next-Generation)**

The Responses API is OpenAI's next-generation API with chain-of-thought preservation:

Demonstrates:
- Basic response creation with instructions
- Configurable reasoning effort (low, medium, high)
- Chain-of-thought (CoT) preservation via `previous_response_id`
- Built-in tools: web_search, code_interpreter, file_search
- Multi-step problem solving with CoT continuity
- Streaming responses with real-time output
- ResponsesConversation class for multi-turn management
- Comparison with Chat Completions API

**Best For**: Agentic applications, multi-step reasoning, built-in tool usage, improved caching

**Key Advantages over Chat Completions**:
- CoT passing: Model retains reasoning context between turns
- Built-in tools: web_search, code_interpreter, file_search out of the box
- Simpler API: input/output instead of messages array
- Better caching: Higher cache hit rates with previous_response_id

**Run**:
```bash
python responses-api.example.py
```

---

## Running Examples

### Prerequisites

1. Install required packages:
```bash
pip install openai numpy
```

2. Set your API key:
```bash
export OPENAI_API_KEY="sk-..."
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
OpenAI Basic Chat Examples
============================================================

=== Simple Completion ===

Question: What is the capital of France?
Answer: Paris

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
| Logging | Python logging module configured |
| Security | No hardcoded credentials |
| Structure | Clear section organization |
| Output | Formatted console output |

---

## Quick Reference

| Use Case | Example File |
|----------|--------------|
| Basic API usage | `basic-chat.example.py` |
| Building agents (Chat API) | `tool-calling.example.py` |
| Real-time output | `streaming.example.py` |
| Semantic search | `embeddings.example.py` |
| Data extraction | `structured-output.example.py` |
| High throughput | `async-client.example.py` |
| Chatbots | `multi-turn.example.py` |
| Assistants API agents | `agent.example.py` |
| CoT preservation & built-in tools | `responses-api.example.py` |

---

## Integration Patterns

### Web Application (Flask)

```python
from flask import Flask, request, jsonify
from openai import OpenAI

app = Flask(__name__)
client = OpenAI()

@app.route('/chat', methods=['POST'])
def chat():
    message = request.json['message']
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": message}]
    )
    return jsonify({'response': response.choices[0].message.content})
```

### CLI Application

```python
import sys
from openai import OpenAI

client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4o-mini",
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
client = AsyncOpenAI()

@app.get('/stream')
async def stream(query: str):
    async def generate():
        stream = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": query}],
            stream=True
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    return StreamingResponse(generate(), media_type="text/plain")
```

### Background Job (Celery)

```python
from celery import Celery
from openai import OpenAI

app = Celery('tasks')
client = OpenAI()

@app.task
def process_batch(prompts: list) -> list:
    results = []
    for prompt in prompts:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        results.append(response.choices[0].message.content)
    return results
```

---

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for OpenAI patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive OpenAI guide
- [templates/](../templates/) - Code generation templates
- [VALIDATION.md](../VALIDATION.md) - Validation checklists

---

**Status**: Complete (9 production-ready examples)
**Last Updated**: 2026-01-01
