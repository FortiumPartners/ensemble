# OpenAI SDK - Comprehensive Reference

**Version**: 1.1.0
**Provider**: OpenAI
**Use Case**: Deep dives, learning new patterns, comprehensive API coverage

---

## Table of Contents

1. [Installation & Setup](#1-installation--setup)
2. [Authentication & Configuration](#2-authentication--configuration)
3. [Chat Completions API](#3-chat-completions-api)
4. [Responses API](#4-responses-api)
5. [Streaming](#5-streaming)
6. [Tool Calling (Function Calling)](#6-tool-calling-function-calling)
7. [Structured Outputs](#7-structured-outputs)
8. [Embeddings API](#8-embeddings-api)
9. [Vision & Multimodal](#9-vision--multimodal)
10. [Audio API](#10-audio-api)
11. [Image Generation (DALL-E)](#11-image-generation-dall-e)
12. [Agents SDK](#12-agents-sdk)
13. [ChatKit UI Components](#13-chatkit-ui-components)
14. [Models API](#14-models-api)
15. [Error Handling](#15-error-handling)
16. [Rate Limits & Quotas](#16-rate-limits--quotas)
17. [Security Best Practices](#17-security-best-practices)
18. [Performance Optimization](#18-performance-optimization)
19. [Migration Guides](#19-migration-guides)
20. [TypeScript SDK Reference](#20-typescript-sdk-reference)
21. [Python SDK Type Reference](#21-python-sdk-type-reference)

---

## 1. Installation & Setup

### 1.1 Python Installation

```bash
# Basic installation
pip install openai

# With async support (httpx included)
pip install openai httpx

# With all extras
pip install "openai[all]"

# Specific version
pip install openai==1.59.0

# Development installation
pip install openai[dev]

# From source
git clone https://github.com/openai/openai-python.git
cd openai-python
pip install -e .
```

### 1.2 Node.js/TypeScript Installation

```bash
# npm
npm install openai

# yarn
yarn add openai

# pnpm
pnpm add openai

# bun
bun add openai

# With TypeScript types (included automatically)
npm install openai typescript @types/node
```

### 1.3 Requirements

| Language | Minimum Version | Recommended |
|----------|-----------------|-------------|
| Python | 3.8+ | 3.11+ |
| Node.js | 18+ | 20+ (LTS) |
| TypeScript | 4.5+ | 5.0+ |

### 1.4 Dependency Overview

**Python SDK Dependencies**:
- `httpx` - HTTP client (async support)
- `pydantic` - Data validation
- `typing-extensions` - Type hints
- `distro` - Linux distribution detection
- `anyio` - Async compatibility

**Node.js SDK Dependencies**:
- `node-fetch` - Fetch API polyfill (Node 18+)
- `form-data` - Multipart form data
- `agentkeepalive` - HTTP connection pooling

---

## 2. Authentication & Configuration

### 2.1 API Key Types

| Key Type | Prefix | Scope | Use Case |
|----------|--------|-------|----------|
| Secret Key | `sk-` | Full API access | Server-side applications |
| Project Key | `sk-proj-` | Project-scoped | CI/CD, specific projects |
| Service Account | `sk-svcacct-` | Automated systems | Background jobs |

### 2.2 Environment Variable Configuration

```bash
# Required
export OPENAI_API_KEY="sk-..."

# Optional
export OPENAI_ORG_ID="org-..."           # Organization ID
export OPENAI_PROJECT_ID="proj_..."       # Project ID
export OPENAI_BASE_URL="https://api.openai.com/v1"  # Custom endpoint
export OPENAI_API_VERSION="2024-02-01"    # API version (Azure)
export OPENAI_MAX_RETRIES="2"             # Max retry attempts
export OPENAI_TIMEOUT="60"                # Request timeout (seconds)
export OPENAI_LOG="debug"                 # Logging level
```

### 2.3 Python Client Initialization

```python
from openai import OpenAI, AsyncOpenAI

# Auto-detect from environment (recommended)
client = OpenAI()

# Explicit configuration
client = OpenAI(
    api_key="sk-...",
    organization="org-...",
    project="proj_...",
    base_url="https://api.openai.com/v1",
    timeout=60.0,
    max_retries=2,
    default_headers={"X-Custom-Header": "value"},
    default_query={"api-version": "2024-02-01"}
)

# Async client
async_client = AsyncOpenAI()

# With httpx client customization
import httpx

http_client = httpx.Client(
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    timeout=httpx.Timeout(60.0, connect=5.0)
)
client = OpenAI(http_client=http_client)
```

### 2.4 TypeScript Client Initialization

```typescript
import OpenAI from 'openai';

// Auto-detect from environment
const openai = new OpenAI();

// Explicit configuration
const openai = new OpenAI({
  apiKey: 'sk-...',
  organization: 'org-...',
  project: 'proj_...',
  baseURL: 'https://api.openai.com/v1',
  timeout: 60000,
  maxRetries: 2,
  defaultHeaders: { 'X-Custom-Header': 'value' },
  defaultQuery: { 'api-version': '2024-02-01' }
});

// With fetch customization
const openai = new OpenAI({
  fetch: async (url, init) => {
    console.log(`Request: ${url}`);
    return fetch(url, init);
  }
});
```

### 2.5 Azure OpenAI Configuration

```python
from openai import AzureOpenAI

# Using API key
client = AzureOpenAI(
    api_key="...",
    api_version="2024-02-01",
    azure_endpoint="https://your-resource.openai.azure.com"
)

# Using Azure AD/Entra ID
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(),
    "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    azure_ad_token_provider=token_provider,
    api_version="2024-02-01",
    azure_endpoint="https://your-resource.openai.azure.com"
)

# API calls use deployment name instead of model name
response = client.chat.completions.create(
    model="my-gpt-4-deployment",  # Deployment name
    messages=[{"role": "user", "content": "Hello"}]
)
```

```typescript
import { AzureOpenAI } from 'openai';

const client = new AzureOpenAI({
  apiKey: '...',
  apiVersion: '2024-02-01',
  endpoint: 'https://your-resource.openai.azure.com'
});
```

### 2.6 Proxy Configuration

```python
import httpx

# HTTP proxy
http_client = httpx.Client(
    proxy="http://proxy.example.com:8080"
)
client = OpenAI(http_client=http_client)

# SOCKS proxy
http_client = httpx.Client(
    proxy="socks5://proxy.example.com:1080"
)
client = OpenAI(http_client=http_client)

# Environment variable proxy
# export HTTP_PROXY="http://proxy:8080"
# export HTTPS_PROXY="http://proxy:8080"
```

---

## 3. Chat Completions API

### 3.1 Endpoint Reference

**Endpoint**: `POST /v1/chat/completions`

### 3.2 Request Parameters (Complete)

```python
response = client.chat.completions.create(
    # ========== Required ==========
    model="gpt-5",                          # Model ID
    messages=[                               # Conversation messages
        {"role": "system", "content": "..."},
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."},
        {"role": "tool", "tool_call_id": "...", "content": "..."}
    ],

    # ========== Sampling Parameters ==========
    temperature=0.7,                         # 0-2, creativity/randomness
    top_p=1.0,                               # 0-1, nucleus sampling
    n=1,                                     # Number of completions to generate

    # ========== Length Control ==========
    max_tokens=1000,                         # Max tokens in response
    max_completion_tokens=1000,              # Alias for max_tokens
    stop=["END", "\n\n"],                    # Stop sequences (up to 4)

    # ========== Penalty Parameters ==========
    frequency_penalty=0.0,                   # -2 to 2, reduce word repetition
    presence_penalty=0.0,                    # -2 to 2, encourage new topics
    logit_bias={15043: -100, 15044: 100},   # Modify token probabilities

    # ========== Output Control ==========
    stream=False,                            # Enable streaming
    stream_options={"include_usage": True},  # Include usage in stream
    response_format={"type": "json_object"}, # Response format

    # ========== Tool/Function Calling ==========
    tools=[...],                             # Tool definitions
    tool_choice="auto",                      # Tool selection strategy
    parallel_tool_calls=True,                # Allow parallel tool calls

    # ========== Reproducibility ==========
    seed=42,                                 # For deterministic outputs

    # ========== Metadata ==========
    user="user-123",                         # End-user identifier
    metadata={"request_id": "abc123"},       # Custom metadata

    # ========== Log Probabilities ==========
    logprobs=True,                           # Return log probabilities
    top_logprobs=5,                          # Number of top tokens (0-20)

    # ========== Modalities ==========
    modalities=["text"],                     # Output types
    audio={                                  # Audio output settings
        "voice": "alloy",
        "format": "mp3"
    },

    # ========== Prediction (Beta) ==========
    prediction={                             # Predicted output (beta)
        "type": "content",
        "content": "Expected output..."
    },

    # ========== Service Tier ==========
    service_tier="default",                  # "auto" or "default"

    # ========== Store (Beta) ==========
    store=False                              # Store completion (beta)
)
```

### 3.3 Message Formats

#### System Message
```python
{"role": "system", "content": "You are a helpful assistant."}

# With name
{"role": "system", "content": "...", "name": "system_prompt"}
```

#### User Message (Text)
```python
{"role": "user", "content": "What is machine learning?"}

# With name
{"role": "user", "content": "...", "name": "Alice"}
```

#### User Message (Multimodal)
```python
{
    "role": "user",
    "content": [
        {"type": "text", "text": "What's in this image?"},
        {
            "type": "image_url",
            "image_url": {
                "url": "https://example.com/image.jpg",
                "detail": "high"  # "auto", "low", or "high"
            }
        }
    ]
}
```

#### Assistant Message
```python
{"role": "assistant", "content": "Machine learning is..."}

# With tool calls
{
    "role": "assistant",
    "content": None,
    "tool_calls": [
        {
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "get_weather",
                "arguments": '{"location": "London"}'
            }
        }
    ]
}
```

#### Tool Message
```python
{
    "role": "tool",
    "tool_call_id": "call_abc123",
    "content": '{"temperature": 22, "conditions": "sunny"}'
}
```

### 3.4 Response Structure

```python
class ChatCompletion:
    id: str                                  # "chatcmpl-abc123"
    object: str                              # "chat.completion"
    created: int                             # Unix timestamp
    model: str                               # Actual model used
    choices: List[Choice]                    # Response choices
    usage: CompletionUsage                   # Token usage
    system_fingerprint: Optional[str]        # System configuration ID
    service_tier: Optional[str]              # Service tier used

class Choice:
    index: int                               # Choice index
    message: ChatCompletionMessage           # Response message
    finish_reason: str                       # "stop", "length", "tool_calls", "content_filter"
    logprobs: Optional[ChoiceLogprobs]       # Log probabilities

class ChatCompletionMessage:
    role: str                                # "assistant"
    content: Optional[str]                   # Response text
    tool_calls: Optional[List[ToolCall]]     # Tool calls
    refusal: Optional[str]                   # Refusal message

class CompletionUsage:
    prompt_tokens: int                       # Input tokens
    completion_tokens: int                   # Output tokens
    total_tokens: int                        # Total tokens
    completion_tokens_details: Optional[dict] # Token breakdown
```

### 3.5 Response Format Options

```python
# Plain text (default)
response_format={"type": "text"}

# JSON object mode
response_format={"type": "json_object"}

# JSON schema mode (strict)
response_format={
    "type": "json_schema",
    "json_schema": {
        "name": "response_schema",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"}
            },
            "required": ["name", "age"],
            "additionalProperties": False
        }
    }
}
```

### 3.6 Multi-Turn Conversation Pattern

```python
from typing import List, Dict, Any

class ConversationManager:
    def __init__(self, client: OpenAI, system_prompt: str, model: str = "gpt-5"):
        self.client = client
        self.model = model
        self.messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt}
        ]
        self.max_context_tokens = 100000

    def add_user_message(self, content: str) -> None:
        self.messages.append({"role": "user", "content": content})

    def add_assistant_message(self, content: str) -> None:
        self.messages.append({"role": "assistant", "content": content})

    def chat(self, user_message: str, **kwargs) -> str:
        self.add_user_message(user_message)
        self._trim_context()

        response = self.client.chat.completions.create(
            model=self.model,
            messages=self.messages,
            **kwargs
        )

        assistant_message = response.choices[0].message.content
        self.add_assistant_message(assistant_message)

        return assistant_message

    def _trim_context(self) -> None:
        """Trim oldest messages to stay within token limit."""
        total_chars = sum(len(m.get("content", "")) for m in self.messages)
        estimated_tokens = total_chars // 4

        while estimated_tokens > self.max_context_tokens and len(self.messages) > 2:
            removed = self.messages.pop(1)
            estimated_tokens -= len(removed.get("content", "")) // 4

    def clear(self) -> None:
        """Clear conversation history, keeping system prompt."""
        self.messages = self.messages[:1]

    def get_history(self) -> List[Dict[str, Any]]:
        return self.messages.copy()
```

---

## 4. Responses API

The Responses API is OpenAI's next-generation API with built-in tools, conversation state management, and enhanced capabilities.

### 4.1 Endpoint Reference

**Endpoint**: `POST /v1/responses`

### 4.2 Basic Usage

```python
# Simple text response
response = client.responses.create(
    model="gpt-5",
    input="What is the capital of France?"
)
print(response.output_text)

# With instructions
response = client.responses.create(
    model="gpt-5",
    instructions="You are a helpful travel guide.",
    input="Tell me about Paris."
)
```

### 4.3 Request Parameters

```python
response = client.responses.create(
    # ========== Required ==========
    model="gpt-5",
    input="User query here",  # or input=[...] for multimodal

    # ========== System Instructions ==========
    instructions="You are a helpful assistant.",

    # ========== Conversation State ==========
    previous_response_id="resp_abc123",  # Continue conversation

    # ========== Sampling ==========
    temperature=0.7,
    top_p=1.0,
    max_output_tokens=1000,

    # ========== Tools ==========
    tools=[
        {"type": "web_search"},
        {"type": "code_interpreter"},
        {"type": "file_search"},
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get weather for a location",
                "parameters": {...}
            }
        }
    ],
    tool_choice="auto",

    # ========== Structured Output ==========
    text={
        "format": {
            "type": "json_schema",
            "json_schema": {...}
        }
    },

    # ========== Streaming ==========
    stream=False,

    # ========== Metadata ==========
    metadata={"session_id": "abc123"}
)
```

### 4.4 Built-in Tools

#### Web Search
```python
response = client.responses.create(
    model="gpt-5",
    input="What are the latest AI news?",
    tools=[{"type": "web_search"}]
)
# Response includes search results and citations
```

#### Code Interpreter
```python
response = client.responses.create(
    model="gpt-5",
    input="Calculate the first 20 fibonacci numbers and plot them",
    tools=[{"type": "code_interpreter"}]
)
# Response includes executed code and outputs
```

#### File Search
```python
response = client.responses.create(
    model="gpt-5",
    input="Find information about machine learning in the documents",
    tools=[{"type": "file_search"}],
    tool_resources={
        "file_search": {
            "vector_store_ids": ["vs_abc123"]
        }
    }
)
```

### 4.5 Conversation Continuity

```python
# First turn
response1 = client.responses.create(
    model="gpt-5",
    input="My name is Alice and I work as a software engineer."
)
print(response1.id)  # "resp_abc123"

# Continue conversation (model remembers context)
response2 = client.responses.create(
    model="gpt-5",
    input="What's my occupation?",
    previous_response_id=response1.id
)
print(response2.output_text)  # "You mentioned you're a software engineer."

# Branch conversation
response3 = client.responses.create(
    model="gpt-5",
    input="Actually, I'm a data scientist.",
    previous_response_id=response1.id  # Branch from first response
)
```

### 4.6 Response Structure

```python
class Response:
    id: str                          # "resp_abc123"
    object: str                      # "response"
    created_at: int                  # Unix timestamp
    model: str                       # Model used
    output: List[OutputItem]         # Output items
    output_text: str                 # Convenience: text content
    usage: ResponseUsage             # Token usage
    status: str                      # "completed", "failed"
    error: Optional[ResponseError]   # Error details if failed

class OutputItem:
    type: str                        # "message", "function_call", etc.
    content: Any                     # Item-specific content
```

### 4.7 Differences from Chat Completions

| Feature | Chat Completions | Responses API |
|---------|------------------|---------------|
| Conversation State | Manual message management | Built-in with `previous_response_id` |
| Built-in Tools | None | web_search, code_interpreter, file_search |
| Tool Execution | External | Some executed server-side |
| Input Format | `messages` array | Simple `input` field |
| System Prompt | First message | `instructions` parameter |
| Response Format | `choices[0].message.content` | `output_text` property |

### 4.8 Migration from Chat Completions

```python
# Chat Completions API
response = client.chat.completions.create(
    model="gpt-5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    temperature=0.7,
    max_tokens=1000
)
answer = response.choices[0].message.content

# Responses API (equivalent)
response = client.responses.create(
    model="gpt-5",
    instructions="You are a helpful assistant.",
    input="Hello!",
    temperature=0.7,
    max_output_tokens=1000
)
answer = response.output_text
```

---

## 5. Streaming

### 5.1 Synchronous Streaming (Python)

```python
stream = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Tell me a story."}],
    stream=True
)

collected_content = []
for chunk in stream:
    if chunk.choices[0].delta.content:
        content = chunk.choices[0].delta.content
        collected_content.append(content)
        print(content, end="", flush=True)

full_response = "".join(collected_content)
```

### 5.2 Asynchronous Streaming (Python)

```python
import asyncio
from openai import AsyncOpenAI

async def stream_response():
    client = AsyncOpenAI()

    stream = await client.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "user", "content": "Tell me a joke."}],
        stream=True
    )

    collected = []
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected.append(content)
            print(content, end="", flush=True)

    return "".join(collected)

asyncio.run(stream_response())
```

### 5.3 Streaming with Usage Information

```python
stream = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
    stream_options={"include_usage": True}
)

for chunk in stream:
    if chunk.choices:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")
    if chunk.usage:
        print(f"\n\nUsage: {chunk.usage}")
```

### 5.4 Streaming Chunk Structure

```python
class ChatCompletionChunk:
    id: str
    object: str                              # "chat.completion.chunk"
    created: int
    model: str
    choices: List[ChunkChoice]
    usage: Optional[CompletionUsage]         # Only with include_usage

class ChunkChoice:
    index: int
    delta: ChoiceDelta
    finish_reason: Optional[str]             # "stop", "length", etc.

class ChoiceDelta:
    role: Optional[str]                      # "assistant" (first chunk)
    content: Optional[str]                   # Text content
    tool_calls: Optional[List[ToolCallDelta]] # Streaming tool calls
```

### 5.5 Streaming Tool Calls

```python
def stream_with_tools(messages, tools):
    stream = client.chat.completions.create(
        model="gpt-5",
        messages=messages,
        tools=tools,
        stream=True
    )

    tool_calls = {}
    content_parts = []

    for chunk in stream:
        delta = chunk.choices[0].delta

        # Handle content
        if delta.content:
            content_parts.append(delta.content)
            print(delta.content, end="", flush=True)

        # Handle tool calls
        if delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index

                if idx not in tool_calls:
                    tool_calls[idx] = {
                        "id": tc_delta.id,
                        "type": "function",
                        "function": {"name": "", "arguments": ""}
                    }

                if tc_delta.function.name:
                    tool_calls[idx]["function"]["name"] = tc_delta.function.name

                if tc_delta.function.arguments:
                    tool_calls[idx]["function"]["arguments"] += tc_delta.function.arguments

    return {
        "content": "".join(content_parts),
        "tool_calls": list(tool_calls.values())
    }
```

### 5.6 TypeScript Streaming

```typescript
const stream = await openai.chat.completions.create({
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);
  }
}
```

### 5.7 Server-Sent Events (Web)

```python
from flask import Flask, Response, stream_with_context

app = Flask(__name__)

@app.route('/stream')
def stream():
    def generate():
        stream = client.chat.completions.create(
            model="gpt-5",
            messages=[{"role": "user", "content": "Hello"}],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                yield f"data: {json.dumps({'content': content})}\n\n"

        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )
```

### 5.8 Responses API Streaming

```python
stream = client.responses.create(
    model="gpt-5",
    input="Write a poem about coding.",
    stream=True
)

for event in stream:
    match event.type:
        case "response.created":
            print(f"Response ID: {event.response.id}")
        case "response.output_text.delta":
            print(event.delta, end="", flush=True)
        case "response.output_text.done":
            print("\n\nComplete!")
        case "response.done":
            print(f"Usage: {event.response.usage}")
        case "error":
            print(f"Error: {event.error}")
```

---

## 6. Tool Calling (Function Calling)

### 6.1 Tool Definition Schema

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",                    # Required: function name
            "description": "Get weather for a city", # Required: what it does
            "parameters": {                          # Required: JSON Schema
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City and country, e.g., 'London, UK'"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit",
                        "default": "celsius"
                    }
                },
                "required": ["location"],
                "additionalProperties": False
            },
            "strict": True                           # Enable strict mode
        }
    }
]
```

### 6.2 Strict Mode Requirements

When `strict: True`:
- All properties must be in `required`
- `additionalProperties: false` must be set
- All nested objects must follow same rules
- Only these types allowed: `string`, `number`, `integer`, `boolean`, `array`, `object`, `null`
- No `$ref`, `oneOf`, `anyOf`, `allOf` at top level

```python
# Valid strict schema
{
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer"},
        "tags": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["name", "age", "tags"],
    "additionalProperties": False
}
```

### 6.3 Tool Choice Options

```python
# Let model decide
tool_choice="auto"

# Never use tools
tool_choice="none"

# Must use at least one tool
tool_choice="required"

# Force specific tool
tool_choice={"type": "function", "function": {"name": "get_weather"}}
```

### 6.4 Complete Tool Calling Loop

```python
import json
from typing import Callable, Dict, Any

# Define your functions
def get_weather(location: str, unit: str = "celsius") -> dict:
    # Your implementation
    return {"temperature": 22, "conditions": "sunny", "unit": unit}

def search_database(query: str, limit: int = 10) -> list:
    # Your implementation
    return [{"id": 1, "title": "Result 1"}, {"id": 2, "title": "Result 2"}]

# Map names to functions
available_functions: Dict[str, Callable] = {
    "get_weather": get_weather,
    "search_database": search_database
}

# Define tools
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City, country"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["location"],
                "additionalProperties": False
            },
            "strict": True
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_database",
            "description": "Search items in database",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "default": 10}
                },
                "required": ["query"],
                "additionalProperties": False
            },
            "strict": True
        }
    }
]

def process_with_tools(client: OpenAI, messages: list) -> str:
    """Process a conversation with tool calling support."""

    while True:
        response = client.chat.completions.create(
            model="gpt-5",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        message = response.choices[0].message
        finish_reason = response.choices[0].finish_reason

        # If no tool calls, return the content
        if finish_reason == "stop" or not message.tool_calls:
            return message.content

        # Process tool calls
        messages.append(message)

        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)

            # Execute the function
            if function_name in available_functions:
                function = available_functions[function_name]
                result = function(**function_args)
            else:
                result = {"error": f"Unknown function: {function_name}"}

            # Add result to messages
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result)
            })

# Usage
messages = [{"role": "user", "content": "What's the weather in London and Paris?"}]
result = process_with_tools(client, messages)
print(result)
```

### 6.5 Parallel Tool Calls

The model can request multiple tool calls simultaneously:

```python
response = client.chat.completions.create(
    model="gpt-5",
    messages=[{
        "role": "user",
        "content": "What's the weather in London, Paris, and Tokyo?"
    }],
    tools=tools,
    parallel_tool_calls=True  # Default is True
)

# Handle multiple tool calls
for tool_call in response.choices[0].message.tool_calls:
    print(f"Tool: {tool_call.function.name}")
    print(f"Args: {tool_call.function.arguments}")
    # Process each in parallel...
```

### 6.6 Pydantic Function Tool Helper

```python
from pydantic import BaseModel, Field
from openai import pydantic_function_tool

class GetWeatherParams(BaseModel):
    """Get weather for a location."""
    location: str = Field(description="City and country, e.g., 'London, UK'")
    unit: str = Field(default="celsius", description="Temperature unit")

class SearchParams(BaseModel):
    """Search the database."""
    query: str = Field(description="Search query")
    limit: int = Field(default=10, description="Max results")

# Convert Pydantic models to tool definitions
tools = [
    pydantic_function_tool(GetWeatherParams, name="get_weather"),
    pydantic_function_tool(SearchParams, name="search_database")
]

response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Weather in NYC?"}],
    tools=tools
)
```

### 6.7 Custom Tool Types

Beyond functions, you can define custom tools:

```python
# Built-in tools (Responses API)
tools = [
    {"type": "web_search"},
    {"type": "code_interpreter"},
    {"type": "file_search"}
]

# Computer use (Beta)
tools = [
    {
        "type": "computer_20241022",
        "display_width_px": 1024,
        "display_height_px": 768,
        "display_number": 1
    }
]

# Shell tool (Agents)
tools = [
    {
        "type": "shell",
        "shell": {
            "working_directory": "/workspace",
            "allowed_commands": ["ls", "cat", "grep"]
        }
    }
]

# Apply patch tool (Agents)
tools = [
    {
        "type": "apply_patch",
        "apply_patch": {
            "allowed_directories": ["/workspace"]
        }
    }
]
```

---

## 7. Structured Outputs

### 7.1 JSON Mode

```python
response = client.chat.completions.create(
    model="gpt-5",
    messages=[
        {"role": "system", "content": "Always respond with valid JSON."},
        {"role": "user", "content": "List 3 programming languages."}
    ],
    response_format={"type": "json_object"}
)

import json
data = json.loads(response.choices[0].message.content)
```

### 7.2 JSON Schema Mode (Strict)

```python
response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Describe a person."}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "person_schema",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "age": {"type": "integer"},
                    "email": {"type": "string"},
                    "hobbies": {
                        "type": "array",
                        "items": {"type": "string"}
                    }
                },
                "required": ["name", "age", "email", "hobbies"],
                "additionalProperties": False
            }
        }
    }
)
```

### 7.3 Pydantic Integration

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class Address(BaseModel):
    street: str
    city: str
    country: str
    postal_code: str

class Person(BaseModel):
    name: str = Field(description="Full name")
    age: int = Field(ge=0, le=150, description="Age in years")
    email: str = Field(description="Email address")
    addresses: List[Address] = Field(default_factory=list)
    occupation: Optional[str] = None

# Generate JSON schema from Pydantic model
schema = Person.model_json_schema()

response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Create a profile for John Doe."}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "person",
            "strict": True,
            "schema": schema
        }
    }
)

# Parse response into Pydantic model
person = Person.model_validate_json(response.choices[0].message.content)
print(person.name)
print(person.addresses[0].city)
```

### 7.4 Complex Nested Schemas

```python
from pydantic import BaseModel
from typing import List, Literal
from enum import Enum

class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class Step(BaseModel):
    number: int
    description: str
    estimated_minutes: int

class Task(BaseModel):
    title: str
    priority: Literal["low", "medium", "high"]
    steps: List[Step]
    tags: List[str]

class Project(BaseModel):
    name: str
    tasks: List[Task]
    total_estimated_hours: float

response = client.chat.completions.create(
    model="gpt-5",
    messages=[{
        "role": "user",
        "content": "Create a project plan for building a mobile app."
    }],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "project",
            "strict": True,
            "schema": Project.model_json_schema()
        }
    }
)

project = Project.model_validate_json(response.choices[0].message.content)
```

### 7.5 Handling Optional Fields

For strict mode, use union with null:

```python
{
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "nickname": {
            "anyOf": [
                {"type": "string"},
                {"type": "null"}
            ]
        }
    },
    "required": ["name", "nickname"],  # Still required, but can be null
    "additionalProperties": False
}
```

With Pydantic:

```python
from typing import Optional

class Person(BaseModel):
    name: str
    nickname: Optional[str] = None

# Pydantic handles Optional correctly in schema generation
```

---

## 8. Embeddings API

### 8.1 Endpoint Reference

**Endpoint**: `POST /v1/embeddings`

### 8.2 Request Parameters

```python
response = client.embeddings.create(
    model="text-embedding-3-small",      # Model ID
    input="Text to embed",               # String or list of strings
    dimensions=512,                       # Optional: reduce dimensions
    encoding_format="float",              # "float" or "base64"
    user="user-123"                       # Optional: end-user ID
)
```

### 8.3 Embedding Models

| Model | Dimensions | Max Tokens | Cost/1M | Best For |
|-------|------------|------------|---------|----------|
| `text-embedding-3-small` | 1536 (default) | 8191 | $0.02 | Cost-effective |
| `text-embedding-3-large` | 3072 (default) | 8191 | $0.13 | High-fidelity |
| `text-embedding-ada-002` | 1536 | 8191 | $0.10 | Legacy |

### 8.4 Dimension Options

`text-embedding-3` models support dimension reduction:

```python
# Full dimensions
response = client.embeddings.create(
    model="text-embedding-3-large",
    input="Hello world"
)
# Returns 3072-dimensional vector

# Reduced dimensions (for faster similarity search)
response = client.embeddings.create(
    model="text-embedding-3-large",
    input="Hello world",
    dimensions=256
)
# Returns 256-dimensional vector with minimal quality loss
```

Recommended dimension options:
- `text-embedding-3-small`: 512, 1024, 1536
- `text-embedding-3-large`: 256, 512, 1024, 3072

### 8.5 Batch Processing

```python
texts = [
    "First document about machine learning",
    "Second document about deep learning",
    "Third document about neural networks",
    "Fourth document about data science",
    "Fifth document about AI"
]

# Single API call for multiple texts
response = client.embeddings.create(
    model="text-embedding-3-small",
    input=texts
)

embeddings = [item.embedding for item in response.data]

# Access by index (matches input order)
for i, embedding in enumerate(embeddings):
    print(f"Text {i}: {len(embedding)} dimensions")
```

### 8.6 Response Structure

```python
class CreateEmbeddingResponse:
    object: str                          # "list"
    data: List[Embedding]                # Embedding objects
    model: str                           # Model used
    usage: EmbeddingUsage                # Token usage

class Embedding:
    object: str                          # "embedding"
    index: int                           # Position in input
    embedding: List[float]               # Vector values

class EmbeddingUsage:
    prompt_tokens: int
    total_tokens: int
```

### 8.7 Similarity Functions

```python
import numpy as np
from typing import List

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    return np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np))

def euclidean_distance(a: List[float], b: List[float]) -> float:
    """Compute Euclidean distance between two vectors."""
    return np.linalg.norm(np.array(a) - np.array(b))

def dot_product(a: List[float], b: List[float]) -> float:
    """Compute dot product of two vectors."""
    return np.dot(a, b)

# For normalized vectors (OpenAI embeddings are normalized):
# cosine_similarity == dot_product
```

### 8.8 Semantic Search Implementation

```python
from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class Document:
    id: str
    content: str
    embedding: List[float] = None

class SemanticSearch:
    def __init__(self, client: OpenAI, model: str = "text-embedding-3-small"):
        self.client = client
        self.model = model
        self.documents: List[Document] = []

    def add_documents(self, documents: List[Document]) -> None:
        """Embed and store documents."""
        texts = [doc.content for doc in documents]

        response = self.client.embeddings.create(
            model=self.model,
            input=texts
        )

        for doc, emb_data in zip(documents, response.data):
            doc.embedding = emb_data.embedding
            self.documents.append(doc)

    def search(self, query: str, top_k: int = 5) -> List[Tuple[Document, float]]:
        """Search for most similar documents."""
        # Embed query
        response = self.client.embeddings.create(
            model=self.model,
            input=query
        )
        query_embedding = response.data[0].embedding

        # Calculate similarities
        results = []
        for doc in self.documents:
            similarity = cosine_similarity(query_embedding, doc.embedding)
            results.append((doc, similarity))

        # Sort by similarity
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]

# Usage
search = SemanticSearch(client)
search.add_documents([
    Document("1", "Machine learning is a subset of AI"),
    Document("2", "Deep learning uses neural networks"),
    Document("3", "Python is a programming language")
])

results = search.search("What is ML?", top_k=2)
for doc, score in results:
    print(f"{score:.4f}: {doc.content}")
```

### 8.9 Vector Database Integration

#### ChromaDB Example
```python
import chromadb

# Initialize ChromaDB
chroma_client = chromadb.Client()
collection = chroma_client.create_collection(
    name="documents",
    metadata={"hnsw:space": "cosine"}
)

# Add documents with embeddings
for doc in documents:
    collection.add(
        embeddings=[doc.embedding],
        documents=[doc.content],
        metadatas=[{"source": doc.id}],
        ids=[doc.id]
    )

# Query
results = collection.query(
    query_embeddings=[query_embedding],
    n_results=5
)
```

#### Pinecone Example
```python
from pinecone import Pinecone

pc = Pinecone(api_key="...")
index = pc.Index("documents")

# Upsert vectors
vectors = [
    {
        "id": doc.id,
        "values": doc.embedding,
        "metadata": {"content": doc.content}
    }
    for doc in documents
]
index.upsert(vectors=vectors)

# Query
results = index.query(
    vector=query_embedding,
    top_k=5,
    include_metadata=True
)
```

---

## 9. Vision & Multimodal

### 9.1 Supported Models

| Model | Vision Support | Max Images | Notes |
|-------|---------------|------------|-------|
| `gpt-5` | Yes | 10+ | Best quality |
| `gpt-4o` | Yes | 10+ | Fast, cost-effective |
| `gpt-4o-mini` | Yes | 10+ | Fastest, cheapest |
| `gpt-4-turbo` | Yes | Limited | Legacy |

### 9.2 Image Input Formats

#### URL Format
```python
{
    "type": "image_url",
    "image_url": {
        "url": "https://example.com/image.jpg",
        "detail": "high"  # "auto", "low", or "high"
    }
}
```

#### Base64 Format
```python
import base64

def encode_image(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")

{
    "type": "image_url",
    "image_url": {
        "url": f"data:image/jpeg;base64,{encode_image('photo.jpg')}"
    }
}
```

### 9.3 Detail Levels

| Level | Resolution | Tokens | Use Case |
|-------|------------|--------|----------|
| `low` | 512x512 | 85 | Fast, simple images |
| `high` | Up to 2048x4096 | 85-1105+ | Detailed analysis |
| `auto` | Varies | Varies | Let model decide |

### 9.4 Complete Vision Example

```python
import base64
from pathlib import Path

def encode_image(image_path: str) -> str:
    """Encode image to base64."""
    with open(image_path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")

def analyze_image(client: OpenAI, image_source: str, question: str = "What's in this image?") -> str:
    """Analyze an image from URL or file path."""

    # Determine if URL or file path
    if image_source.startswith(("http://", "https://")):
        image_content = {
            "type": "image_url",
            "image_url": {"url": image_source, "detail": "high"}
        }
    else:
        # Local file
        path = Path(image_source)
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_source}")

        # Determine MIME type
        suffix = path.suffix.lower()
        mime_types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
            ".webp": "image/webp"
        }
        mime_type = mime_types.get(suffix, "image/jpeg")

        base64_image = encode_image(image_source)
        image_content = {
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{base64_image}",
                "detail": "high"
            }
        }

    response = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    image_content
                ]
            }
        ],
        max_tokens=1000
    )

    return response.choices[0].message.content
```

### 9.5 Multiple Images

```python
response = client.chat.completions.create(
    model="gpt-5",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Compare these two images:"},
                {
                    "type": "image_url",
                    "image_url": {"url": "https://example.com/image1.jpg"}
                },
                {
                    "type": "image_url",
                    "image_url": {"url": "https://example.com/image2.jpg"}
                }
            ]
        }
    ]
)
```

### 9.6 Image Token Calculation

```python
def calculate_image_tokens(width: int, height: int, detail: str) -> int:
    """Estimate tokens for an image."""
    if detail == "low":
        return 85

    # Scale to fit within 2048x2048
    max_dim = 2048
    if width > max_dim or height > max_dim:
        ratio = max_dim / max(width, height)
        width = int(width * ratio)
        height = int(height * ratio)

    # Scale shortest side to 768
    min_side = 768
    if min(width, height) > min_side:
        ratio = min_side / min(width, height)
        width = int(width * ratio)
        height = int(height * ratio)

    # Calculate 512x512 tiles
    tiles_x = (width + 511) // 512
    tiles_y = (height + 511) // 512

    # 170 tokens per tile + 85 base
    return 170 * tiles_x * tiles_y + 85
```

---

## 10. Audio API

### 10.1 Speech-to-Text (Whisper)

**Endpoint**: `POST /v1/audio/transcriptions`

```python
# Transcribe audio file
with open("audio.mp3", "rb") as audio_file:
    transcript = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        response_format="text"  # "json", "text", "srt", "vtt", "verbose_json"
    )
print(transcript)

# With options
transcript = client.audio.transcriptions.create(
    model="whisper-1",
    file=audio_file,
    language="en",                    # ISO-639-1 code
    prompt="Technical discussion",     # Guide the model
    temperature=0.0,                   # 0-1, transcription creativity
    timestamp_granularities=["word", "segment"]  # For verbose_json
)
```

### 10.2 Translation (Whisper)

**Endpoint**: `POST /v1/audio/translations`

```python
# Translate any audio to English
with open("french_audio.mp3", "rb") as audio_file:
    translation = client.audio.translations.create(
        model="whisper-1",
        file=audio_file,
        response_format="text"
    )
print(translation)  # English text
```

### 10.3 Supported Audio Formats

| Format | Extension | Max Size |
|--------|-----------|----------|
| MP3 | .mp3 | 25 MB |
| MP4 | .mp4 | 25 MB |
| MPEG | .mpeg | 25 MB |
| MPGA | .mpga | 25 MB |
| M4A | .m4a | 25 MB |
| WAV | .wav | 25 MB |
| WEBM | .webm | 25 MB |

### 10.4 Text-to-Speech

**Endpoint**: `POST /v1/audio/speech`

```python
# Generate speech
response = client.audio.speech.create(
    model="tts-1",           # "tts-1" or "tts-1-hd"
    voice="alloy",           # Voice selection
    input="Hello, world!",   # Text to speak
    speed=1.0,               # 0.25 to 4.0
    response_format="mp3"    # "mp3", "opus", "aac", "flac", "wav", "pcm"
)

# Save to file
with open("speech.mp3", "wb") as f:
    f.write(response.content)

# Streaming
with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="alloy",
    input="Long text to speak..."
) as response:
    for chunk in response.iter_bytes():
        # Process audio chunk
        pass
```

### 10.5 Available Voices

| Voice | Description | Best For |
|-------|-------------|----------|
| `alloy` | Neutral, balanced | General use |
| `echo` | Warm, conversational | Podcasts |
| `fable` | Expressive, British | Storytelling |
| `onyx` | Deep, authoritative | Narration |
| `nova` | Friendly, upbeat | Customer service |
| `shimmer` | Soft, calm | Meditation, ASMR |

### 10.6 TTS Models

| Model | Quality | Latency | Cost |
|-------|---------|---------|------|
| `tts-1` | Standard | Low | Lower |
| `tts-1-hd` | High definition | Higher | Higher |

---

## 11. Image Generation (DALL-E)

### 11.1 Create Image

**Endpoint**: `POST /v1/images/generations`

```python
response = client.images.generate(
    model="dall-e-3",                    # "dall-e-2" or "dall-e-3"
    prompt="A sunset over mountains",
    n=1,                                 # Number of images (1 for DALL-E 3)
    size="1024x1024",                    # Size options vary by model
    quality="hd",                        # "standard" or "hd" (DALL-E 3)
    style="vivid",                       # "vivid" or "natural" (DALL-E 3)
    response_format="url",               # "url" or "b64_json"
    user="user-123"
)

image_url = response.data[0].url
revised_prompt = response.data[0].revised_prompt  # DALL-E 3 only
```

### 11.2 Size Options

| Model | Sizes | Notes |
|-------|-------|-------|
| DALL-E 3 | 1024x1024, 1792x1024, 1024x1792 | Only n=1 |
| DALL-E 2 | 256x256, 512x512, 1024x1024 | Up to n=10 |

### 11.3 Edit Image

**Endpoint**: `POST /v1/images/edits`

```python
# DALL-E 2 only
with open("image.png", "rb") as image, open("mask.png", "rb") as mask:
    response = client.images.edit(
        model="dall-e-2",
        image=image,
        mask=mask,                       # Transparent areas to edit
        prompt="Add a hat",
        n=1,
        size="1024x1024"
    )
```

### 11.4 Create Image Variation

**Endpoint**: `POST /v1/images/variations`

```python
# DALL-E 2 only
with open("image.png", "rb") as image:
    response = client.images.create_variation(
        model="dall-e-2",
        image=image,
        n=2,
        size="1024x1024"
    )
```

---

## 12. Agents SDK

### 12.1 Create Agent (Assistant)

```python
from openai import OpenAI

client = OpenAI()

# Create an assistant
assistant = client.beta.assistants.create(
    name="Data Analyst",
    description="Analyzes data and creates visualizations",
    instructions="""You are a data analysis assistant.
    - Help users analyze datasets
    - Create visualizations when helpful
    - Explain findings clearly""",
    model="gpt-5",
    tools=[
        {"type": "code_interpreter"},
        {"type": "file_search"}
    ],
    tool_resources={
        "file_search": {
            "vector_store_ids": ["vs_abc123"]
        }
    },
    temperature=0.7,
    top_p=1.0,
    metadata={"department": "analytics"}
)

print(assistant.id)  # "asst_abc123"
```

### 12.2 Thread Management

```python
# Create thread
thread = client.beta.threads.create(
    messages=[
        {
            "role": "user",
            "content": "Analyze the sales data."
        }
    ],
    metadata={"user_id": "user123"}
)

# Add message to existing thread
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="Create a chart of monthly trends."
)

# With file attachment
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="Analyze this CSV file.",
    attachments=[
        {
            "file_id": "file-abc123",
            "tools": [{"type": "code_interpreter"}]
        }
    ]
)

# List messages
messages = client.beta.threads.messages.list(
    thread_id=thread.id,
    order="asc",
    limit=20
)

# Get specific message
message = client.beta.threads.messages.retrieve(
    thread_id=thread.id,
    message_id=message.id
)
```

### 12.3 Run Assistant

```python
# Create and poll run
run = client.beta.threads.runs.create_and_poll(
    thread_id=thread.id,
    assistant_id=assistant.id,
    instructions="Focus on Q4 data.",  # Override instructions
    additional_instructions="Use bar charts.",
    max_prompt_tokens=10000,
    max_completion_tokens=5000
)

if run.status == "completed":
    messages = client.beta.threads.messages.list(thread_id=thread.id)
    for msg in messages.data:
        if msg.role == "assistant":
            print(msg.content[0].text.value)
elif run.status == "failed":
    print(f"Error: {run.last_error}")
```

### 12.4 Streaming Runs

```python
with client.beta.threads.runs.stream(
    thread_id=thread.id,
    assistant_id=assistant.id
) as stream:
    for event in stream:
        match event.event:
            case "thread.run.created":
                print(f"Run started: {event.data.id}")
            case "thread.message.delta":
                delta = event.data.delta.content[0]
                if hasattr(delta, 'text'):
                    print(delta.text.value, end="", flush=True)
            case "thread.run.completed":
                print("\n\nRun completed!")
            case "thread.run.failed":
                print(f"\nError: {event.data.last_error}")
```

### 12.5 Handle Required Actions

```python
run = client.beta.threads.runs.retrieve(
    thread_id=thread.id,
    run_id=run.id
)

if run.status == "requires_action":
    tool_outputs = []

    for tool_call in run.required_action.submit_tool_outputs.tool_calls:
        function_name = tool_call.function.name
        arguments = json.loads(tool_call.function.arguments)

        # Execute your function
        result = your_functions[function_name](**arguments)

        tool_outputs.append({
            "tool_call_id": tool_call.id,
            "output": json.dumps(result)
        })

    # Submit results
    run = client.beta.threads.runs.submit_tool_outputs_and_poll(
        thread_id=thread.id,
        run_id=run.id,
        tool_outputs=tool_outputs
    )
```

### 12.6 File Management

```python
# Upload file
file = client.files.create(
    file=open("data.csv", "rb"),
    purpose="assistants"
)

# List files
files = client.files.list(purpose="assistants")

# Delete file
client.files.delete(file.id)
```

### 12.7 Vector Stores

```python
# Create vector store
vector_store = client.beta.vector_stores.create(
    name="Knowledge Base",
    expires_after={"anchor": "last_active_at", "days": 7}
)

# Add files
file_batch = client.beta.vector_stores.file_batches.create(
    vector_store_id=vector_store.id,
    file_ids=["file-abc123", "file-def456"]
)

# Poll for completion
while file_batch.status == "in_progress":
    file_batch = client.beta.vector_stores.file_batches.retrieve(
        vector_store_id=vector_store.id,
        batch_id=file_batch.id
    )
    time.sleep(1)

# Search vector store
results = client.beta.vector_stores.files.list(
    vector_store_id=vector_store.id
)
```

### 12.8 Built-in Agentic Tools

#### Shell Tool
```python
# For code agents - execute shell commands
tools = [
    {
        "type": "shell",
        "shell": {
            "working_directory": "/workspace",
            "allowed_commands": ["ls", "cat", "grep", "python"],
            "environment": {"PATH": "/usr/bin"}
        }
    }
]
```

#### Apply Patch Tool
```python
# For code agents - apply file patches
tools = [
    {
        "type": "apply_patch",
        "apply_patch": {
            "allowed_directories": ["/workspace/src"]
        }
    }
]
```


## 13. ChatKit UI Components

ChatKit is OpenAI's official React component library for building chat interfaces. It provides pre-built, customizable components that integrate seamlessly with the OpenAI API.

### 13.1 Installation & Setup

```bash
# npm
npm install @openai/chatkit

# yarn
yarn add @openai/chatkit

# pnpm
pnpm add @openai/chatkit
```

**Requirements**:
- React 18+
- TypeScript 4.5+ (recommended)
- OpenAI SDK for API calls

### 13.2 Core Components

#### Chat Container

```tsx
import { Chat } from '@openai/chatkit';

function App() {
  return (
    <Chat
      className="h-screen"
      onMessagesChange={(messages) => console.log(messages)}
    >
      {/* Child components */}
    </Chat>
  );
}
```

**Props**:

| Prop | Type | Description |
|------|------|-------------|
| `className` | `string` | CSS class for container |
| `style` | `CSSProperties` | Inline styles |
| `onMessagesChange` | `(messages: Message[]) => void` | Callback when messages change |
| `initialMessages` | `Message[]` | Initial message history |

#### Message Component

```tsx
import { Message } from '@openai/chatkit';

// User message
<Message role="user">Hello, how can you help me?</Message>

// Assistant message
<Message role="assistant">
  I can help you with coding, writing, and more!
</Message>

// With avatar
<Message role="assistant" avatar="/bot-avatar.png">
  Response with custom avatar
</Message>

// With metadata
<Message
  role="assistant"
  timestamp={new Date()}
  status="delivered"
>
  Message with metadata
</Message>
```

**Props**:

| Prop | Type | Description |
|------|------|-------------|
| `role` | `'user' \| 'assistant' \| 'system'` | Message sender role |
| `children` | `ReactNode` | Message content |
| `avatar` | `string \| ReactNode` | Avatar URL or component |
| `timestamp` | `Date` | Message timestamp |
| `status` | `'sending' \| 'delivered' \| 'error'` | Message status |
| `className` | `string` | CSS class |

#### MessageInput Component

```tsx
import { MessageInput } from '@openai/chatkit';

function ChatInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  return (
    <MessageInput
      onSend={onSubmit}
      placeholder="Type a message..."
      disabled={false}
      autoFocus
    />
  );
}
```

**Props**:

| Prop | Type | Description |
|------|------|-------------|
| `onSend` | `(content: string) => void` | Send callback |
| `placeholder` | `string` | Input placeholder text |
| `disabled` | `boolean` | Disable input |
| `autoFocus` | `boolean` | Auto-focus on mount |
| `maxLength` | `number` | Max character limit |
| `showSendButton` | `boolean` | Show/hide send button |
| `sendOnEnter` | `boolean` | Send on Enter key |

#### MessageList Component

```tsx
import { MessageList } from '@openai/chatkit';

<MessageList
  messages={messages}
  loading={isLoading}
  autoScroll
  renderMessage={(msg) => (
    <Message key={msg.id} role={msg.role}>
      {msg.content}
    </Message>
  )}
/>
```

**Props**:

| Prop | Type | Description |
|------|------|-------------|
| `messages` | `Message[]` | Array of messages |
| `loading` | `boolean` | Show loading state |
| `autoScroll` | `boolean` | Auto-scroll to bottom |
| `renderMessage` | `(msg: Message) => ReactNode` | Custom message renderer |
| `emptyState` | `ReactNode` | Component when no messages |

### 13.3 Streaming Hook

```tsx
import { useStreamingMessage } from '@openai/chatkit';
import OpenAI from 'openai';

function StreamingChat() {
  const {
    streamingContent,    // Current streaming content
    isStreaming,         // Streaming state
    startStream,         // Update streaming content
    completeStream,      // Finalize stream
    cancelStream         // Cancel current stream
  } = useStreamingMessage();

  const [messages, setMessages] = useState<Message[]>([]);
  const client = new OpenAI({ dangerouslyAllowBrowser: true });

  const handleSend = async (content: string) => {
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content }]);

    const stream = await client.chat.completions.create({
      model: 'gpt-5.2',
      messages: [...messages, { role: 'user', content }],
      stream: true
    });

    let accumulated = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      accumulated += delta;
      startStream(accumulated);  // Update UI in real-time
    }

    // Finalize and add to messages
    completeStream();
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: accumulated
    }]);
  };

  return (
    <Chat>
      <MessageList messages={messages} />
      {isStreaming && (
        <Message role="assistant">{streamingContent}</Message>
      )}
      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </Chat>
  );
}
```

### 13.4 Theming System

#### Theme Provider

```tsx
import { ChatThemeProvider, defaultTheme } from '@openai/chatkit';

// Use default theme
function App() {
  return (
    <ChatThemeProvider>
      <ChatApp />
    </ChatThemeProvider>
  );
}

// Custom theme
const customTheme = {
  ...defaultTheme,
  colors: {
    ...defaultTheme.colors,
    primary: '#10a37f',
    primaryHover: '#0d8a6b',
    background: '#ffffff',
    surface: '#f7f7f8',
    userBubble: '#e3f2fd',
    userBubbleText: '#1a1a1a',
    assistantBubble: '#f5f5f5',
    assistantBubbleText: '#1a1a1a',
    border: '#e5e5e5',
    inputBackground: '#ffffff',
    inputText: '#1a1a1a',
    inputPlaceholder: '#6b6b6b',
  },
  typography: {
    ...defaultTheme.typography,
    fontFamily: '"Inter", -apple-system, sans-serif',
    fontSize: {
      small: '0.875rem',
      medium: '1rem',
      large: '1.125rem',
    },
  },
  spacing: {
    ...defaultTheme.spacing,
    messagePadding: '12px 16px',
    messageGap: '8px',
    containerPadding: '16px',
  },
  borderRadius: {
    message: '16px',
    input: '24px',
    button: '8px',
  },
  shadows: {
    ...defaultTheme.shadows,
    message: '0 1px 2px rgba(0,0,0,0.05)',
    input: '0 2px 4px rgba(0,0,0,0.1)',
  }
};

function ThemedApp() {
  return (
    <ChatThemeProvider theme={customTheme}>
      <ChatApp />
    </ChatThemeProvider>
  );
}
```

#### Dark Mode

```tsx
import { ChatThemeProvider, darkTheme, lightTheme } from '@openai/chatkit';

function App() {
  const [isDark, setIsDark] = useState(false);

  return (
    <ChatThemeProvider theme={isDark ? darkTheme : lightTheme}>
      <button onClick={() => setIsDark(!isDark)}>Toggle Theme</button>
      <ChatApp />
    </ChatThemeProvider>
  );
}
```

#### useTheme Hook

```tsx
import { useTheme } from '@openai/chatkit';

function CustomComponent() {
  const theme = useTheme();

  return (
    <div style={{
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily
    }}>
      Themed content
    </div>
  );
}
```

### 13.5 Complete Chat Application

```tsx
import {
  Chat,
  Message,
  MessageInput,
  MessageList,
  TypingIndicator,
  ChatThemeProvider,
  useStreamingMessage
} from '@openai/chatkit';
import OpenAI from 'openai';
import { useState, useCallback } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const client = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true  // Use backend proxy in production
});

function FullChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { streamingContent, isStreaming, startStream, completeStream } = useStreamingMessage();

  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const handleSend = useCallback(async (content: string) => {
    setError(null);

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const stream = await client.chat.completions.create({
        model: 'gpt-5.2',
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        })).concat({ role: 'user', content }),
        stream: true
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        fullContent += delta;
        startStream(fullContent);
      }

      completeStream();

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: fullContent,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      completeStream();
    }
  }, [messages, startStream, completeStream]);

  return (
    <ChatThemeProvider>
      <Chat className="h-screen max-w-3xl mx-auto p-4">
        <MessageList
          messages={messages}
          autoScroll
          emptyState={
            <div className="text-center text-gray-500 py-8">
              Start a conversation by typing a message below.
            </div>
          }
          renderMessage={(msg) => (
            <Message
              key={msg.id}
              role={msg.role}
              timestamp={msg.timestamp}
            >
              {msg.content}
            </Message>
          )}
        />

        {isStreaming && (
          <Message role="assistant">
            {streamingContent}
            <TypingIndicator />
          </Message>
        )}

        {error && (
          <div className="text-red-500 text-sm p-2">
            Error: {error}
          </div>
        )}

        <MessageInput
          onSend={handleSend}
          disabled={isStreaming}
          placeholder="Ask me anything..."
          autoFocus
        />
      </Chat>
    </ChatThemeProvider>
  );
}

export default FullChatApp;
```

### 13.6 Integration with Responses API

```tsx
import { Chat, Message, MessageInput, useStreamingMessage } from '@openai/chatkit';
import OpenAI from 'openai';

function ResponsesApiChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  const { streamingContent, isStreaming, startStream, completeStream } = useStreamingMessage();

  const client = new OpenAI({ dangerouslyAllowBrowser: true });

  const handleSend = async (content: string) => {
    setMessages(prev => [...prev, { role: 'user', content }]);

    const stream = await client.responses.create({
      model: 'gpt-5.2',
      input: content,
      previous_response_id: previousResponseId,  // Maintain conversation state
      stream: true,
      tools: [
        { type: 'web_search' }  // Enable built-in web search
      ]
    });

    let fullContent = '';
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        fullContent += event.delta;
        startStream(fullContent);
      } else if (event.type === 'response.done') {
        setPreviousResponseId(event.response.id);
      }
    }

    completeStream();
    setMessages(prev => [...prev, { role: 'assistant', content: fullContent }]);
  };

  return (
    <Chat>
      {messages.map((msg, i) => (
        <Message key={i} role={msg.role}>{msg.content}</Message>
      ))}
      {isStreaming && (
        <Message role="assistant">{streamingContent}</Message>
      )}
      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </Chat>
  );
}
```

### 13.7 Server-Side Integration (Next.js)

```tsx
// app/api/chat/route.ts
import OpenAI from 'openai';
import { NextRequest } from 'next/server';

const client = new OpenAI();

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const stream = await client.chat.completions.create({
    model: 'gpt-5.2',
    messages,
    stream: true
  });

  // Return as SSE stream
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

// components/ChatWithSSE.tsx
'use client';

import { Chat, Message, MessageInput, useStreamingMessage } from '@openai/chatkit';

function ChatWithSSE() {
  const [messages, setMessages] = useState<Message[]>([]);
  const { streamingContent, isStreaming, startStream, completeStream } = useStreamingMessage();

  const handleSend = async (content: string) => {
    setMessages(prev => [...prev, { role: 'user', content }]);

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...messages, { role: 'user', content }]
      })
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          const data = JSON.parse(line.slice(6));
          fullContent += data.content;
          startStream(fullContent);
        }
      }
    }

    completeStream();
    setMessages(prev => [...prev, { role: 'assistant', content: fullContent }]);
  };

  return (
    <Chat>
      {messages.map((msg, i) => (
        <Message key={i} role={msg.role}>{msg.content}</Message>
      ))}
      {isStreaming && (
        <Message role="assistant">{streamingContent}</Message>
      )}
      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </Chat>
  );
}
```

### 13.8 Accessibility Features

ChatKit includes built-in accessibility support:

```tsx
import { Chat, Message, MessageInput } from '@openai/chatkit';

// Accessibility is built-in:
// - ARIA labels for all interactive elements
// - Keyboard navigation (Tab, Enter, Escape)
// - Screen reader announcements for new messages
// - Focus management
// - High contrast mode support

function AccessibleChat() {
  return (
    <Chat
      aria-label="AI Assistant Chat"
      role="main"
    >
      <MessageList
        aria-label="Chat messages"
        aria-live="polite"
      />
      <MessageInput
        aria-label="Type your message"
        aria-describedby="input-hint"
      />
      <span id="input-hint" className="sr-only">
        Press Enter to send message
      </span>
    </Chat>
  );
}
```

### 13.9 TypeScript Types

```typescript
// Message types
interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  status?: 'sending' | 'delivered' | 'error';
}

// Theme types
interface ChatTheme {
  colors: {
    primary: string;
    primaryHover: string;
    background: string;
    surface: string;
    userBubble: string;
    userBubbleText: string;
    assistantBubble: string;
    assistantBubbleText: string;
    border: string;
    inputBackground: string;
    inputText: string;
    inputPlaceholder: string;
    error: string;
    success: string;
  };
  typography: {
    fontFamily: string;
    fontSize: {
      small: string;
      medium: string;
      large: string;
    };
    fontWeight: {
      normal: number;
      medium: number;
      bold: number;
    };
    lineHeight: number;
  };
  spacing: {
    messagePadding: string;
    messageGap: string;
    containerPadding: string;
  };
  borderRadius: {
    message: string;
    input: string;
    button: string;
  };
  shadows: {
    message: string;
    input: string;
    dropdown: string;
  };
}

// Component props
interface ChatProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onMessagesChange?: (messages: Message[]) => void;
  initialMessages?: Message[];
}

interface MessageProps {
  role: 'user' | 'assistant' | 'system';
  children: React.ReactNode;
  avatar?: string | React.ReactNode;
  timestamp?: Date;
  status?: 'sending' | 'delivered' | 'error';
  className?: string;
}

interface MessageInputProps {
  onSend: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  showSendButton?: boolean;
  sendOnEnter?: boolean;
  className?: string;
}

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
  autoScroll?: boolean;
  renderMessage?: (message: Message) => React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
}

// Hook return types
interface UseStreamingMessageReturn {
  streamingContent: string;
  isStreaming: boolean;
  startStream: (content: string) => void;
  completeStream: () => void;
  cancelStream: () => void;
}
```

---

---

## 14. Models API

### 14.1 List Models

**Endpoint**: `GET /v1/models`

```python
models = client.models.list()

for model in models.data:
    print(f"{model.id}: {model.owned_by}")
```

### 14.2 Retrieve Model

**Endpoint**: `GET /v1/models/{model}`

```python
model = client.models.retrieve("gpt-5")
print(f"Model: {model.id}")
print(f"Owner: {model.owned_by}")
print(f"Created: {model.created}")
```

### 14.3 Model Response Structure

```python
class Model:
    id: str              # "gpt-5"
    object: str          # "model"
    created: int         # Unix timestamp
    owned_by: str        # "openai" or "organization"
```

### 14.4 Model Capabilities Comparison

| Model | Context | Max Output | Vision | Tools | JSON Mode |
|-------|---------|------------|--------|-------|-----------|
| gpt-5 | 128K | 32K | Yes | Yes | Yes |
| gpt-5.1 | 128K | 32K | Yes | Yes | Yes |
| gpt-4o | 128K | 16K | Yes | Yes | Yes |
| gpt-4o-mini | 128K | 16K | Yes | Yes | Yes |
| gpt-4-turbo | 128K | 4K | Yes | Yes | Yes |
| o1 | 200K | 100K | Yes | No | Yes |
| o1-mini | 128K | 65K | No | No | Yes |

---

## 15. Error Handling

### 15.1 Exception Hierarchy

```python
from openai import (
    OpenAIError,           # Base exception
    APIError,              # API returned an error
    APIConnectionError,    # Network/connection error
    APITimeoutError,       # Request timed out
    AuthenticationError,   # Invalid API key
    PermissionDeniedError, # Insufficient permissions
    NotFoundError,         # Resource not found
    ConflictError,         # Resource conflict
    UnprocessableEntityError, # Invalid request
    RateLimitError,        # Rate limit exceeded
    InternalServerError,   # Server error
    BadRequestError        # Malformed request
)
```

### 15.2 Error Response Structure

```python
class APIError:
    message: str           # Error description
    type: str              # Error type
    param: Optional[str]   # Parameter that caused error
    code: Optional[str]    # Error code

    @property
    def status_code(self) -> int:
        """HTTP status code."""
        ...

    @property
    def request_id(self) -> Optional[str]:
        """Request ID for debugging."""
        ...
```

### 15.3 Error Codes Reference

| Status | Exception | Cause | Action |
|--------|-----------|-------|--------|
| 400 | BadRequestError | Malformed request | Fix request format |
| 401 | AuthenticationError | Invalid API key | Check/rotate key |
| 403 | PermissionDeniedError | No access to resource | Check permissions |
| 404 | NotFoundError | Resource not found | Verify resource exists |
| 409 | ConflictError | Resource conflict | Handle conflict |
| 422 | UnprocessableEntityError | Semantic error | Fix request content |
| 429 | RateLimitError | Rate limit hit | Implement backoff |
| 500 | InternalServerError | Server error | Retry with backoff |
| 502 | APIError | Bad gateway | Retry with backoff |
| 503 | APIError | Service unavailable | Retry with backoff |

### 15.4 Comprehensive Error Handler

```python
import time
import logging
from openai import (
    OpenAI,
    APIError,
    APIConnectionError,
    RateLimitError,
    AuthenticationError,
    InternalServerError
)
from typing import TypeVar, Callable
from functools import wraps

T = TypeVar('T')
logger = logging.getLogger(__name__)

def with_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0
) -> Callable:
    """Decorator for API calls with exponential backoff retry."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            last_exception = None

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)

                except AuthenticationError as e:
                    logger.error(f"Authentication failed: {e}")
                    raise  # Don't retry auth errors

                except RateLimitError as e:
                    last_exception = e
                    if attempt == max_retries:
                        raise

                    # Use retry-after header if available
                    retry_after = getattr(e, 'retry_after', None)
                    if retry_after:
                        delay = float(retry_after)
                    else:
                        delay = min(
                            base_delay * (exponential_base ** attempt),
                            max_delay
                        )

                    logger.warning(
                        f"Rate limited. Attempt {attempt + 1}/{max_retries + 1}. "
                        f"Retrying in {delay:.2f}s"
                    )
                    time.sleep(delay)

                except (InternalServerError, APIConnectionError) as e:
                    last_exception = e
                    if attempt == max_retries:
                        raise

                    delay = min(
                        base_delay * (exponential_base ** attempt),
                        max_delay
                    )
                    logger.warning(
                        f"Server error: {e}. Attempt {attempt + 1}/{max_retries + 1}. "
                        f"Retrying in {delay:.2f}s"
                    )
                    time.sleep(delay)

                except APIError as e:
                    if e.status_code >= 500:
                        last_exception = e
                        if attempt == max_retries:
                            raise
                        delay = min(
                            base_delay * (exponential_base ** attempt),
                            max_delay
                        )
                        time.sleep(delay)
                    else:
                        raise  # Don't retry client errors

            raise last_exception

        return wrapper
    return decorator

# Usage
client = OpenAI()

@with_retry(max_retries=3, base_delay=1.0)
def call_openai(prompt: str) -> str:
    response = client.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content
```

---

## 16. Rate Limits & Quotas

### 16.1 Rate Limit Types

| Limit Type | Description |
|------------|-------------|
| RPM | Requests per minute |
| RPD | Requests per day |
| TPM | Tokens per minute |
| TPD | Tokens per day |
| IPM | Images per minute (DALL-E) |

### 16.2 Tier System

| Tier | Spend Requirement | RPM | TPM (GPT-4) | TPM (GPT-3.5) |
|------|-------------------|-----|-------------|---------------|
| Free | $0 | 3 | 40K | 40K |
| Tier 1 | $5+ | 500 | 30K | 60K |
| Tier 2 | $50+ | 5000 | 450K | 80K |
| Tier 3 | $100+ | 5000 | 600K | 160K |
| Tier 4 | $250+ | 10000 | 800K | 1M |
| Tier 5 | $1000+ | 10000 | 10M | 2M |

### 16.3 Rate Limit Headers

```python
response = client.chat.completions.with_raw_response.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Hello"}]
)

# Access headers
headers = response.headers
print(f"Limit (requests): {headers.get('x-ratelimit-limit-requests')}")
print(f"Limit (tokens): {headers.get('x-ratelimit-limit-tokens')}")
print(f"Remaining (requests): {headers.get('x-ratelimit-remaining-requests')}")
print(f"Remaining (tokens): {headers.get('x-ratelimit-remaining-tokens')}")
print(f"Reset (requests): {headers.get('x-ratelimit-reset-requests')}")
print(f"Reset (tokens): {headers.get('x-ratelimit-reset-tokens')}")

# Access the actual response
completion = response.parse()
```

### 16.4 Rate Limit Tracking

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
import asyncio

@dataclass
class RateLimitState:
    requests_remaining: int = 0
    tokens_remaining: int = 0
    requests_reset: datetime = None
    tokens_reset: datetime = None

class RateLimitTracker:
    def __init__(self):
        self.state = RateLimitState()
        self._lock = asyncio.Lock()

    def update_from_headers(self, headers: dict) -> None:
        """Update state from response headers."""
        if 'x-ratelimit-remaining-requests' in headers:
            self.state.requests_remaining = int(headers['x-ratelimit-remaining-requests'])
        if 'x-ratelimit-remaining-tokens' in headers:
            self.state.tokens_remaining = int(headers['x-ratelimit-remaining-tokens'])

    async def wait_if_needed(self, estimated_tokens: int) -> None:
        """Wait if approaching rate limits."""
        async with self._lock:
            if self.state.tokens_remaining < estimated_tokens:
                wait_time = self._calculate_wait_time()
                if wait_time > 0:
                    await asyncio.sleep(wait_time)

    def _calculate_wait_time(self) -> float:
        if self.state.tokens_reset:
            delta = self.state.tokens_reset - datetime.now()
            return max(0, delta.total_seconds())
        return 0
```

### 16.5 Concurrent Request Management

```python
import asyncio
from openai import AsyncOpenAI

async def process_batch_with_limits(
    prompts: list[str],
    max_concurrent: int = 5,
    requests_per_minute: int = 60
) -> list[str]:
    """Process prompts with rate limiting."""
    client = AsyncOpenAI()
    semaphore = asyncio.Semaphore(max_concurrent)
    delay = 60.0 / requests_per_minute

    async def process_one(prompt: str, index: int) -> tuple[int, str]:
        async with semaphore:
            # Stagger requests
            await asyncio.sleep(index * delay)

            response = await client.chat.completions.create(
                model="gpt-5",
                messages=[{"role": "user", "content": prompt}]
            )
            return index, response.choices[0].message.content

    tasks = [process_one(prompt, i) for i, prompt in enumerate(prompts)]
    results = await asyncio.gather(*tasks)

    # Sort by original index
    return [r[1] for r in sorted(results, key=lambda x: x[0])]
```

---

## 17. Security Best Practices

### 17.1 API Key Management

```python
# GOOD: Environment variables
import os
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# GOOD: Secret manager
from azure.keyvault.secrets import SecretClient
secret_client = SecretClient(vault_url="https://...", credential=credential)
api_key = secret_client.get_secret("openai-api-key").value
client = OpenAI(api_key=api_key)

# BAD: Hardcoded keys
client = OpenAI(api_key="sk-...")  # NEVER do this

# BAD: Config files without encryption
# config.yaml: api_key: sk-...  # NEVER do this
```

### 17.2 Environment Variable Security

```bash
# .env file (development only, add to .gitignore)
OPENAI_API_KEY=sk-...

# .gitignore
.env
.env.*
!.env.example

# .env.example (commit this)
OPENAI_API_KEY=your-api-key-here
```

### 17.3 Production Secrets Management

```python
# AWS Secrets Manager
import boto3
import json

def get_api_key():
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId='openai/api-key')
    return json.loads(response['SecretString'])['api_key']

# Google Secret Manager
from google.cloud import secretmanager

def get_api_key():
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/my-project/secrets/openai-api-key/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("UTF-8")

# HashiCorp Vault
import hvac

def get_api_key():
    client = hvac.Client(url='https://vault.example.com')
    response = client.secrets.kv.v2.read_secret_version(
        path='openai/api-key'
    )
    return response['data']['data']['api_key']
```

### 17.4 Input Validation

```python
import re
from typing import Optional

def sanitize_user_input(input_text: str, max_length: int = 10000) -> str:
    """Sanitize user input before sending to API."""
    # Truncate long inputs
    if len(input_text) > max_length:
        input_text = input_text[:max_length] + "..."

    # Remove potential prompt injection patterns
    # Note: This is defense in depth, not foolproof
    suspicious_patterns = [
        r"ignore previous instructions",
        r"disregard all prior",
        r"new instructions:",
        r"system prompt:",
    ]

    for pattern in suspicious_patterns:
        if re.search(pattern, input_text, re.IGNORECASE):
            raise ValueError("Input contains suspicious content")

    return input_text.strip()

def validate_file_upload(file_path: str, max_size_mb: int = 25) -> bool:
    """Validate file before upload."""
    import os

    # Check file exists
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Check file size
    size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if size_mb > max_size_mb:
        raise ValueError(f"File too large: {size_mb:.2f}MB (max: {max_size_mb}MB)")

    # Check extension
    allowed_extensions = {'.txt', '.pdf', '.md', '.csv', '.json'}
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in allowed_extensions:
        raise ValueError(f"File type not allowed: {ext}")

    return True
```

### 17.5 Output Validation

```python
import json
from pydantic import BaseModel, ValidationError

def validate_json_response(content: str, schema: type[BaseModel]) -> BaseModel:
    """Validate and parse JSON response."""
    try:
        data = json.loads(content)
        return schema.model_validate(data)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")
    except ValidationError as e:
        raise ValueError(f"Schema validation failed: {e}")

def sanitize_output(content: str) -> str:
    """Sanitize model output before displaying to users."""
    # Remove potential XSS vectors if displaying in web
    import html
    return html.escape(content)
```

### 17.6 Logging Best Practices

```python
import logging
import re

class RedactingFormatter(logging.Formatter):
    """Formatter that redacts sensitive information."""

    PATTERNS = [
        (r'sk-[a-zA-Z0-9]{48}', 'sk-***REDACTED***'),
        (r'Bearer [a-zA-Z0-9\-._~+/]+=*', 'Bearer ***REDACTED***'),
        (r'"api_key":\s*"[^"]*"', '"api_key": "***REDACTED***"'),
    ]

    def format(self, record):
        msg = super().format(record)
        for pattern, replacement in self.PATTERNS:
            msg = re.sub(pattern, replacement, msg)
        return msg

# Configure logging
handler = logging.StreamHandler()
handler.setFormatter(RedactingFormatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
))
logger = logging.getLogger('openai')
logger.addHandler(handler)
```

---

## 18. Performance Optimization

### 18.1 Connection Pooling

```python
import httpx

# Custom HTTP client with connection pooling
http_client = httpx.Client(
    limits=httpx.Limits(
        max_connections=100,
        max_keepalive_connections=20,
        keepalive_expiry=30.0
    ),
    timeout=httpx.Timeout(60.0, connect=5.0),
    http2=True  # Enable HTTP/2
)

client = OpenAI(http_client=http_client)
```

### 18.2 Response Caching

```python
import hashlib
import json
from functools import lru_cache
from typing import Optional
import redis

class ResponseCache:
    """Cache for deterministic API responses."""

    def __init__(self, redis_client: redis.Redis, ttl: int = 3600):
        self.redis = redis_client
        self.ttl = ttl

    def _cache_key(self, model: str, messages: list, **kwargs) -> str:
        """Generate cache key from request parameters."""
        content = json.dumps({
            "model": model,
            "messages": messages,
            "temperature": kwargs.get("temperature", 1.0),
            "seed": kwargs.get("seed")
        }, sort_keys=True)
        return f"openai:{hashlib.sha256(content.encode()).hexdigest()}"

    def get(self, model: str, messages: list, **kwargs) -> Optional[str]:
        """Get cached response."""
        if kwargs.get("temperature", 1.0) > 0 and "seed" not in kwargs:
            return None  # Only cache deterministic requests

        key = self._cache_key(model, messages, **kwargs)
        cached = self.redis.get(key)
        return cached.decode() if cached else None

    def set(self, model: str, messages: list, response: str, **kwargs) -> None:
        """Cache response."""
        if kwargs.get("temperature", 1.0) > 0 and "seed" not in kwargs:
            return

        key = self._cache_key(model, messages, **kwargs)
        self.redis.setex(key, self.ttl, response)

# Usage
cache = ResponseCache(redis.Redis())

def cached_completion(client: OpenAI, messages: list, **kwargs) -> str:
    cached = cache.get("gpt-5", messages, **kwargs)
    if cached:
        return cached

    response = client.chat.completions.create(
        model="gpt-5",
        messages=messages,
        **kwargs
    )
    result = response.choices[0].message.content

    cache.set("gpt-5", messages, result, **kwargs)
    return result
```

### 18.3 Token Optimization

```python
import tiktoken

def count_tokens(text: str, model: str = "gpt-5") -> int:
    """Count tokens in text."""
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        encoding = tiktoken.get_encoding("cl100k_base")
    return len(encoding.encode(text))

def truncate_to_tokens(text: str, max_tokens: int, model: str = "gpt-5") -> str:
    """Truncate text to maximum tokens."""
    encoding = tiktoken.encoding_for_model(model)
    tokens = encoding.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return encoding.decode(tokens[:max_tokens])

def estimate_cost(prompt_tokens: int, completion_tokens: int, model: str) -> float:
    """Estimate cost based on token usage."""
    # Prices per 1K tokens (example, check current pricing)
    prices = {
        "gpt-5": {"prompt": 0.01, "completion": 0.03},
        "gpt-4o": {"prompt": 0.005, "completion": 0.015},
        "gpt-4o-mini": {"prompt": 0.00015, "completion": 0.0006},
    }
    model_prices = prices.get(model, prices["gpt-4o"])
    return (
        (prompt_tokens / 1000) * model_prices["prompt"] +
        (completion_tokens / 1000) * model_prices["completion"]
    )
```

### 18.4 Batch Processing

```python
import asyncio
from typing import List

async def batch_completions(
    client: AsyncOpenAI,
    prompts: List[str],
    batch_size: int = 10,
    model: str = "gpt-5"
) -> List[str]:
    """Process prompts in batches."""
    results = []

    for i in range(0, len(prompts), batch_size):
        batch = prompts[i:i + batch_size]

        tasks = [
            client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}]
            )
            for prompt in batch
        ]

        responses = await asyncio.gather(*tasks)
        results.extend([r.choices[0].message.content for r in responses])

        # Rate limit between batches
        if i + batch_size < len(prompts):
            await asyncio.sleep(1)

    return results
```

### 18.5 Streaming for Better UX

```python
import time

def stream_with_metrics(client: OpenAI, prompt: str) -> dict:
    """Stream response with timing metrics."""
    start_time = time.time()
    first_token_time = None
    content_parts = []

    stream = client.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            if first_token_time is None:
                first_token_time = time.time()
            content_parts.append(chunk.choices[0].delta.content)

    end_time = time.time()

    return {
        "content": "".join(content_parts),
        "time_to_first_token": first_token_time - start_time if first_token_time else None,
        "total_time": end_time - start_time,
        "tokens_per_second": len(content_parts) / (end_time - start_time)
    }
```

---

## 19. Migration Guides

### 19.1 From Chat Completions to Responses API

```python
# BEFORE: Chat Completions
messages = [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello!"}
]
response = client.chat.completions.create(
    model="gpt-5",
    messages=messages,
    temperature=0.7,
    max_tokens=1000
)
answer = response.choices[0].message.content

# AFTER: Responses API
response = client.responses.create(
    model="gpt-5",
    instructions="You are helpful.",
    input="Hello!",
    temperature=0.7,
    max_output_tokens=1000
)
answer = response.output_text
```

### 19.2 From Legacy Completions to Chat

```python
# BEFORE: Legacy Completions (deprecated)
response = client.completions.create(
    model="text-davinci-003",
    prompt="Hello, how are you?",
    max_tokens=100
)
answer = response.choices[0].text

# AFTER: Chat Completions
response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Hello, how are you?"}],
    max_tokens=100
)
answer = response.choices[0].message.content
```

### 19.3 From Functions to Tools

```python
# BEFORE: Functions (deprecated)
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Weather in NYC?"}],
    functions=[{
        "name": "get_weather",
        "parameters": {...}
    }],
    function_call="auto"
)

# AFTER: Tools
response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Weather in NYC?"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "parameters": {...}
        }
    }],
    tool_choice="auto"
)
```

### 19.4 From GPT-4 to GPT-5

```python
# Key differences:
# 1. Higher context window (128K standard)
# 2. More output tokens (32K)
# 3. Improved tool calling
# 4. Better structured outputs

# BEFORE
response = client.chat.completions.create(
    model="gpt-4-turbo",
    messages=[...],
    max_tokens=4096
)

# AFTER
response = client.chat.completions.create(
    model="gpt-5",
    messages=[...],
    max_tokens=32000  # Can use more tokens now
)
```

### 19.5 From Assistants v1 to v2

```python
# v2 changes:
# 1. New tool_resources parameter
# 2. Vector stores instead of file search
# 3. Improved streaming
# 4. Run step retrieval

# BEFORE (v1)
assistant = client.beta.assistants.create(
    model="gpt-4",
    tools=[{"type": "retrieval"}],
    file_ids=["file-abc123"]
)

# AFTER (v2)
assistant = client.beta.assistants.create(
    model="gpt-5",
    tools=[{"type": "file_search"}],
    tool_resources={
        "file_search": {
            "vector_store_ids": ["vs_abc123"]
        }
    }
)
```

---

## 20. TypeScript SDK Reference

### 20.1 Client Initialization

```typescript
import OpenAI from 'openai';

// Basic initialization
const openai = new OpenAI();

// With configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: 'org-...',
  project: 'proj_...',
  baseURL: 'https://api.openai.com/v1',
  timeout: 60000,
  maxRetries: 2,
  defaultHeaders: { 'X-Custom': 'value' },
  defaultQuery: { version: '2' }
});
```

### 20.2 Type Definitions

```typescript
import OpenAI from 'openai';
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  CreateEmbeddingResponse,
  Embedding
} from 'openai/resources';

// Message types
const systemMessage: ChatCompletionMessageParam = {
  role: 'system',
  content: 'You are helpful.'
};

const userMessage: ChatCompletionMessageParam = {
  role: 'user',
  content: 'Hello!'
};

// Tool definition
const tool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' }
      },
      required: ['location']
    }
  }
};
```

### 20.3 Streaming with Types

```typescript
import OpenAI from 'openai';
import { Stream } from 'openai/streaming';

async function streamCompletion(
  client: OpenAI,
  messages: OpenAI.ChatCompletionMessageParam[]
): Promise<string> {
  const stream: Stream<OpenAI.ChatCompletionChunk> =
    await client.chat.completions.create({
      model: 'gpt-5',
      messages,
      stream: true
    });

  const chunks: string[] = [];

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      chunks.push(content);
      process.stdout.write(content);
    }
  }

  return chunks.join('');
}
```

### 20.4 Error Handling (TypeScript)

```typescript
import OpenAI, {
  APIError,
  APIConnectionError,
  RateLimitError,
  AuthenticationError
} from 'openai';

async function safeApiCall<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error; // Don't retry auth errors
      }

      if (error instanceof RateLimitError) {
        lastError = error;
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (error instanceof APIError && error.status >= 500) {
        lastError = error;
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
```

### 20.5 Pydantic-like Validation with Zod

```typescript
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// Define schema
const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int().min(0).max(150),
  email: z.string().email(),
  hobbies: z.array(z.string())
});

type Person = z.infer<typeof PersonSchema>;

// Use with API
const response = await openai.chat.completions.create({
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'Create a person profile.' }],
  response_format: zodResponseFormat(PersonSchema, 'person')
});

const person: Person = JSON.parse(response.choices[0].message.content!);
```

---

## 21. Python SDK Type Reference

### 21.1 Pydantic Models

```python
from openai.types.chat import (
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionMessage,
    ChatCompletionMessageParam,
    ChatCompletionToolParam,
    ChatCompletionToolChoiceOptionParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam
)
from openai.types import (
    CreateEmbeddingResponse,
    Embedding,
    Model
)

# Type-safe message construction
system_msg: ChatCompletionSystemMessageParam = {
    "role": "system",
    "content": "You are helpful."
}

user_msg: ChatCompletionUserMessageParam = {
    "role": "user",
    "content": "Hello!"
}

messages: list[ChatCompletionMessageParam] = [system_msg, user_msg]
```

### 21.2 Response Types

```python
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion import Choice
from openai.types.chat.chat_completion_message import ChatCompletionMessage
from openai.types.completion_usage import CompletionUsage

def process_response(response: ChatCompletion) -> str:
    """Type-safe response processing."""
    choice: Choice = response.choices[0]
    message: ChatCompletionMessage = choice.message
    usage: CompletionUsage = response.usage

    print(f"Tokens used: {usage.total_tokens}")
    print(f"Finish reason: {choice.finish_reason}")

    return message.content or ""
```

### 21.3 Tool Types

```python
from openai.types.chat import ChatCompletionToolParam
from openai.types.chat.chat_completion_message_tool_call import (
    ChatCompletionMessageToolCall,
    Function
)

tool: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            },
            "required": ["location"],
            "additionalProperties": False
        },
        "strict": True
    }
}

def handle_tool_call(tool_call: ChatCompletionMessageToolCall) -> str:
    """Type-safe tool call handling."""
    function: Function = tool_call.function
    name: str = function.name
    args: str = function.arguments
    return f"Function: {name}, Args: {args}"
```

### 21.4 Streaming Types

```python
from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import (
    Choice as ChunkChoice,
    ChoiceDelta
)

def process_stream(stream) -> str:
    """Type-safe stream processing."""
    parts: list[str] = []

    for chunk in stream:
        chunk: ChatCompletionChunk
        choice: ChunkChoice = chunk.choices[0]
        delta: ChoiceDelta = choice.delta

        if delta.content:
            parts.append(delta.content)

        if choice.finish_reason:
            print(f"Stream finished: {choice.finish_reason}")

    return "".join(parts)
```

### 21.5 Generic Types

```python
from typing import TypeVar, Generic
from pydantic import BaseModel

T = TypeVar('T', bound=BaseModel)

class APIResponse(Generic[T]):
    """Generic wrapper for API responses."""

    def __init__(self, data: T, usage: CompletionUsage):
        self.data = data
        self.usage = usage
        self.cost = self._calculate_cost()

    def _calculate_cost(self) -> float:
        # Implementation
        pass

# Usage
class Person(BaseModel):
    name: str
    age: int

response: APIResponse[Person] = get_structured_response(Person, prompt)
print(response.data.name)
```

---

## Appendix A: Quick Reference Tables

### A.1 Model Quick Reference

| Model | Type | Context | Output | Best For |
|-------|------|---------|--------|----------|
| gpt-5 | Chat | 128K | 32K | Complex tasks |
| gpt-5.1 | Chat | 128K | 32K | Enhanced reasoning |
| gpt-4o | Chat | 128K | 16K | Balanced speed/quality |
| gpt-4o-mini | Chat | 128K | 16K | Fast, cheap |
| o1 | Reasoning | 200K | 100K | Complex reasoning |
| o1-mini | Reasoning | 128K | 65K | Fast reasoning |
| text-embedding-3-small | Embed | 8K | 1536d | Cost-effective |
| text-embedding-3-large | Embed | 8K | 3072d | High-fidelity |
| whisper-1 | Audio | 25MB | - | Transcription |
| tts-1 | Audio | 4096ch | - | Speech synthesis |
| dall-e-3 | Image | - | - | Image generation |

### A.2 HTTP Status Codes

| Code | Error Class | Retry? | Action |
|------|-------------|--------|--------|
| 400 | BadRequestError | No | Fix request |
| 401 | AuthenticationError | No | Check API key |
| 403 | PermissionDeniedError | No | Check permissions |
| 404 | NotFoundError | No | Check resource |
| 429 | RateLimitError | Yes | Exponential backoff |
| 500 | InternalServerError | Yes | Exponential backoff |
| 502 | APIError | Yes | Exponential backoff |
| 503 | APIError | Yes | Exponential backoff |

### A.3 Common Parameters

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| temperature | float | 0-2 | 1.0 | Randomness |
| top_p | float | 0-1 | 1.0 | Nucleus sampling |
| max_tokens | int | 1-32K+ | Model-specific | Max output |
| frequency_penalty | float | -2 to 2 | 0 | Reduce repetition |
| presence_penalty | float | -2 to 2 | 0 | Encourage novelty |
| n | int | 1-128 | 1 | Number of completions |
| seed | int | Any | None | Reproducibility |

---

## Appendix B: Code Templates

### B.1 Production-Ready Client

```python
import os
import logging
from openai import OpenAI, AsyncOpenAI
import httpx

logger = logging.getLogger(__name__)

def create_client(
    async_client: bool = False,
    timeout: float = 60.0,
    max_retries: int = 2,
    connection_pool_size: int = 100
) -> OpenAI | AsyncOpenAI:
    """Create a production-ready OpenAI client."""

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable not set")

    if async_client:
        http_client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=connection_pool_size,
                max_keepalive_connections=connection_pool_size // 5
            ),
            timeout=httpx.Timeout(timeout),
            http2=True
        )
        return AsyncOpenAI(
            api_key=api_key,
            http_client=http_client,
            max_retries=max_retries
        )
    else:
        http_client = httpx.Client(
            limits=httpx.Limits(
                max_connections=connection_pool_size,
                max_keepalive_connections=connection_pool_size // 5
            ),
            timeout=httpx.Timeout(timeout),
            http2=True
        )
        return OpenAI(
            api_key=api_key,
            http_client=http_client,
            max_retries=max_retries
        )
```

### B.2 Streaming Chat Handler

```python
from typing import Generator, Callable
from dataclasses import dataclass

@dataclass
class StreamResult:
    content: str
    tool_calls: list[dict]
    finish_reason: str
    usage: dict | None

def stream_chat(
    client: OpenAI,
    messages: list[dict],
    on_token: Callable[[str], None] | None = None,
    **kwargs
) -> StreamResult:
    """Stream chat completion with callback."""

    stream = client.chat.completions.create(
        messages=messages,
        stream=True,
        stream_options={"include_usage": True},
        **kwargs
    )

    content_parts = []
    tool_calls = {}
    finish_reason = None
    usage = None

    for chunk in stream:
        if chunk.usage:
            usage = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens
            }

        if not chunk.choices:
            continue

        choice = chunk.choices[0]
        delta = choice.delta

        if choice.finish_reason:
            finish_reason = choice.finish_reason

        if delta.content:
            content_parts.append(delta.content)
            if on_token:
                on_token(delta.content)

        if delta.tool_calls:
            for tc in delta.tool_calls:
                if tc.index not in tool_calls:
                    tool_calls[tc.index] = {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": "", "arguments": ""}
                    }
                if tc.function.name:
                    tool_calls[tc.index]["function"]["name"] = tc.function.name
                if tc.function.arguments:
                    tool_calls[tc.index]["function"]["arguments"] += tc.function.arguments

    return StreamResult(
        content="".join(content_parts),
        tool_calls=list(tool_calls.values()),
        finish_reason=finish_reason or "unknown",
        usage=usage
    )
```

---

## See Also

- [SKILL.md](SKILL.md) - Quick reference for immediate use
- [templates/](templates/) - Code generation templates
- [examples/](examples/) - Production-ready examples
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [OpenAI Cookbook](https://cookbook.openai.com/)

---

**Size Target**: <1MB
**Load Time**: <500ms
**Last Updated**: 2026-01-01
