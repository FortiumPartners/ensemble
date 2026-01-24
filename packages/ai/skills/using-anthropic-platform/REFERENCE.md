# Anthropic Claude SDK - Complete Reference

This document contains comprehensive API reference, advanced patterns, and detailed implementations for the Anthropic Claude SDK.

**Quick Reference**: See [SKILL.md](./SKILL.md) for essential patterns.

---

## Table of Contents

1. [Claude Agent SDK](#claude-agent-sdk)
2. [Message Batches API](#message-batches-api)
3. [Computer Use (Beta)](#computer-use-beta)
4. [MCP (Model Context Protocol)](#mcp-model-context-protocol)
5. [Citations](#citations)
6. [Advanced Messages API](#advanced-messages-api)
7. [Advanced Tool Use](#advanced-tool-use)
8. [Advanced Extended Thinking](#advanced-extended-thinking)
9. [Advanced Streaming](#advanced-streaming)
10. [Advanced Vision](#advanced-vision)
11. [Prompt Caching Details](#prompt-caching-details)
12. [Error Handling](#error-handling)
13. [Best Practices](#best-practices)

---

## Claude Agent SDK

The Claude Agent SDK powers Claude Code and enables building custom AI agents with tool access.

### Installation

```bash
# Python
pip install claude-code-sdk

# NPM
npm install @anthropic-ai/claude-code-sdk
```

### Python Agent Example

```python
"""Build custom agents with the Claude Agent SDK."""
import asyncio
from claude_code_sdk import Claude, ClaudeOptions

async def run_agent():
    options = ClaudeOptions(
        model="claude-sonnet-4-20250514",
        allowed_tools=["Task", "Read", "Write", "Edit", "Bash"],
        system_prompt="You are a helpful coding assistant.",
        permission_mode="default",
        max_turns=10,
    )

    async with Claude(options=options) as agent:
        result = await agent.query(
            prompt="Create a Python script that lists all files"
        )

        async for message in agent.receive_response():
            if hasattr(message, "text"):
                print(message.text, end="", flush=True)
            elif hasattr(message, "tool_use"):
                print(f"\n[Using tool: {message.tool_use.name}]")
            elif hasattr(message, "result"):
                return message.result

asyncio.run(run_agent())
```

### TypeScript Agent Example

```typescript
import { Claude, ClaudeOptions } from '@anthropic-ai/claude-code-sdk';

async function runAgent() {
  const options: ClaudeOptions = {
    model: 'claude-sonnet-4-20250514',
    allowedTools: ['Task', 'Read', 'Write', 'Edit', 'Bash', 'WebSearch'],
    systemPrompt: 'You are a helpful coding assistant.',
    permissionMode: 'default',
  };

  const agent = new Claude(options);

  try {
    await agent.query({
      prompt: 'Analyze the package.json and suggest improvements',
    });

    for await (const message of agent.stream()) {
      if (message.type === 'text') {
        process.stdout.write(message.text);
      } else if (message.type === 'tool_use') {
        console.log(`\n[Tool: ${message.name}]`);
      }
    }
  } finally {
    await agent.close();
  }
}
```

### Agent SDK Configuration

| Option | Type | Description |
|--------|------|-------------|
| `model` | string | Claude model to use |
| `allowed_tools` | array | Tools the agent can use |
| `system_prompt` | string | Custom system prompt |
| `permission_mode` | string | `default`, `plan`, or `acceptEdits` |
| `max_turns` | int | Maximum conversation turns |
| `working_directory` | string | Base directory for file operations |
| `env_vars` | dict | Environment variables for subprocess |

### Available Agent Tools

| Tool | Description |
|------|-------------|
| `Task` | Spawn sub-agents for delegated work |
| `Read` | Read file contents |
| `Write` | Write/create files |
| `Edit` | Make precise edits to files |
| `Bash` | Execute shell commands |
| `WebSearch` | Search the web for information |
| `Glob` | Find files matching patterns |
| `Grep` | Search file contents |

### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Ask user before file modifications and command execution |
| `plan` | Show plan, ask approval, then execute without further prompts |
| `acceptEdits` | Auto-approve file edits, ask for commands |

### Session Management

```python
"""Maintain conversation context across queries."""
from claude_code_sdk import Claude, ClaudeOptions

async def multi_turn_session():
    options = ClaudeOptions(model="claude-sonnet-4-20250514")

    async with Claude(options=options) as agent:
        await agent.query("Read the README.md file")
        async for msg in agent.receive_response():
            pass

        await agent.query("Now summarize what you read")
        async for msg in agent.receive_response():
            if hasattr(msg, "text"):
                print(msg.text)
```

---

## Message Batches API

Process large volumes of requests asynchronously with 50% cost savings.

### When to Use Batches

| Use Case | Batches API |
|----------|-------------|
| Real-time chat | No |
| Bulk document processing | Yes |
| Dataset evaluation | Yes |
| Batch embeddings/classification | Yes |
| Time-sensitive requests | No |
| Non-interactive workflows | Yes |

### Create a Batch

```python
"""Create and process message batches."""
from anthropic import Anthropic

client = Anthropic()

batch = client.messages.batches.create(
    requests=[
        {
            "custom_id": "request-1",
            "params": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [
                    {"role": "user", "content": "Summarize the theory of relativity"}
                ]
            }
        },
        {
            "custom_id": "request-2",
            "params": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [
                    {"role": "user", "content": "Explain quantum entanglement"}
                ]
            }
        }
    ]
)

print(f"Batch ID: {batch.id}")
print(f"Status: {batch.processing_status}")
```

### Check Batch Status

```python
"""Poll batch status until complete."""
import time

def wait_for_batch(batch_id: str, poll_interval: int = 30) -> dict:
    while True:
        batch = client.messages.batches.retrieve(batch_id)

        print(f"Status: {batch.processing_status}")
        print(f"Completed: {batch.request_counts.succeeded}/{batch.request_counts.processing}")

        if batch.processing_status == "ended":
            return batch
        if batch.processing_status == "canceled":
            raise Exception("Batch was canceled")

        time.sleep(poll_interval)

completed_batch = wait_for_batch(batch.id)
```

### Retrieve Batch Results

```python
"""Retrieve and process batch results."""

def get_batch_results(batch_id: str) -> list[dict]:
    results = []

    for result in client.messages.batches.results(batch_id):
        results.append({
            "custom_id": result.custom_id,
            "success": result.result.type == "succeeded",
            "message": result.result.message if result.result.type == "succeeded" else None,
            "error": result.result.error if result.result.type == "errored" else None
        })

    return results

results = get_batch_results(batch.id)
for result in results:
    if result["success"]:
        print(f"{result['custom_id']}: {result['message'].content[0].text[:100]}...")
    else:
        print(f"{result['custom_id']}: Error - {result['error']}")
```

### Batch Management

```python
# List all batches
batches = client.messages.batches.list(limit=10)
for batch in batches.data:
    print(f"{batch.id}: {batch.processing_status}")

# Cancel a batch
client.messages.batches.cancel(batch_id)
```

### Batch Processing Limits

| Limit | Value |
|-------|-------|
| Max requests per batch | 10,000 |
| Max processing time | 24 hours |
| Batch retention | 29 days |
| Results availability | 29 days after completion |

---

## Computer Use (Beta)

Enable Claude to interact with computer interfaces through screenshots and actions.

### Enable Computer Use

```python
"""Use Claude to interact with computer interfaces."""
from anthropic import Anthropic

client = Anthropic()

tools = [
    {
        "type": "computer_20241022",
        "name": "computer",
        "display_width_px": 1024,
        "display_height_px": 768,
        "display_number": 1
    },
    {
        "type": "text_editor_20241022",
        "name": "str_replace_editor"
    },
    {
        "type": "bash_20241022",
        "name": "bash"
    }
]

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    messages=[
        {"role": "user", "content": "Take a screenshot and describe what you see"}
    ],
    betas=["computer-use-2024-10-22"]
)

for block in response.content:
    if block.type == "tool_use":
        print(f"Tool: {block.name}")
        print(f"Input: {block.input}")
```

### Computer Tool Actions

| Action | Description |
|--------|-------------|
| `screenshot` | Capture current screen state |
| `mouse_move` | Move cursor to coordinates |
| `left_click` | Click at current position |
| `right_click` | Right-click at current position |
| `double_click` | Double-click at current position |
| `type` | Type text at current position |
| `key` | Press keyboard keys |
| `scroll` | Scroll in specified direction |

### Handle Computer Actions

```python
"""Process computer use tool calls."""
import base64
import subprocess

def handle_computer_action(action: dict) -> dict:
    action_type = action.get("action")

    if action_type == "screenshot":
        result = subprocess.run(
            ["screencapture", "-x", "/tmp/screenshot.png"],
            capture_output=True
        )
        with open("/tmp/screenshot.png", "rb") as f:
            image_data = base64.standard_b64encode(f.read()).decode()
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": image_data
            }
        }

    elif action_type == "mouse_move":
        x, y = action["coordinate"]
        return {"success": True}

    elif action_type == "left_click":
        return {"success": True}

    elif action_type == "type":
        text = action["text"]
        return {"success": True}

    return {"error": f"Unknown action: {action_type}"}


def computer_use_loop(user_request: str) -> str:
    messages = [{"role": "user", "content": user_request}]

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            tools=tools,
            messages=messages,
            betas=["computer-use-2024-10-22"]
        )

        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    return block.text

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                if block.name == "computer":
                    result = handle_computer_action(block.input)
                elif block.name == "bash":
                    result = subprocess.run(
                        block.input["command"],
                        shell=True,
                        capture_output=True,
                        text=True
                    )
                    result = {"stdout": result.stdout, "stderr": result.stderr}
                else:
                    result = {"error": "Unknown tool"}

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(result)
                })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})
```

### Safety Considerations

| Risk | Mitigation |
|------|------------|
| Unintended actions | Use sandboxed environments (VMs, containers) |
| Credential exposure | Never run on systems with saved credentials |
| System damage | Limit to non-production systems |
| Data exfiltration | Monitor network access |

---

## MCP (Model Context Protocol)

MCP is an open protocol for extending Claude's capabilities with external tools and data sources.

### What is MCP?

MCP provides a standardized way to:
- Connect Claude to external data sources
- Add custom tools and capabilities
- Share context between applications
- Build composable AI integrations

### MCP Architecture

```
+------------------+     +------------------+     +------------------+
|   Claude/App     |<--->|    MCP Server    |<--->|   Data Source    |
|  (MCP Client)    |     |   (Your Code)    |     | (DB, API, Files) |
+------------------+     +------------------+     +------------------+
```

### Using MCP Tools in Messages

```python
"""Invoke MCP tools through the Messages API."""
from anthropic import Anthropic

client = Anthropic()

mcp_tools = [
    {
        "name": "mcp__database__query",
        "description": "Query the connected database",
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "SQL query to execute"},
                "limit": {"type": "integer", "default": 100}
            },
            "required": ["sql"]
        }
    },
    {
        "name": "mcp__filesystem__read",
        "description": "Read a file from the connected filesystem",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to read"}
            },
            "required": ["path"]
        }
    }
]

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    tools=mcp_tools,
    messages=[
        {"role": "user", "content": "Find all users who signed up last month"}
    ]
)
```

### MCP Server Example

```python
"""Simple MCP server implementation."""
from mcp import Server, Tool, Resource

server = Server("my-mcp-server")

@server.tool("query_database")
async def query_database(sql: str, limit: int = 100) -> dict:
    results = await db.execute(sql, limit=limit)
    return {"rows": results, "count": len(results)}

@server.resource("file://{path}")
async def read_file(path: str) -> str:
    with open(path, "r") as f:
        return f.read()

if __name__ == "__main__":
    server.run()
```

### MCP Integration Points

| Integration | Description |
|-------------|-------------|
| Claude Desktop | Built-in MCP support for local servers |
| Claude Code | MCP servers extend Claude Code capabilities |
| API | MCP tools exposed as regular tools |
| SDK | MCP client libraries for custom apps |

For comprehensive MCP documentation, see https://modelcontextprotocol.io/

---

## Citations

Enable grounded responses with source references from documents.

### Enable Citations

```python
"""Get responses with citations from documents."""
import base64
from anthropic import Anthropic

client = Anthropic()

with open("research_paper.pdf", "rb") as f:
    pdf_data = base64.standard_b64encode(f.read()).decode()

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_data
                    },
                    "citations": {"enabled": True}
                },
                {
                    "type": "text",
                    "text": "Summarize the key findings with citations"
                }
            ]
        }
    ]
)

for block in response.content:
    if block.type == "text":
        print(block.text)

        if hasattr(block, "citations") and block.citations:
            print("\nCitations:")
            for citation in block.citations:
                print(f"  - Page {citation.page}: {citation.quote[:50]}...")
```

### Citation Response Structure

```python
{
    "type": "text",
    "text": "The study found that...",
    "citations": [
        {
            "type": "document",
            "document_index": 0,
            "document_title": "Research Paper",
            "page": 5,
            "quote": "Our results indicate a 23% improvement...",
            "start_char": 1245,
            "end_char": 1298
        }
    ]
}
```

### Multiple Document Citations

```python
"""Cite from multiple documents."""
documents = [
    {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": doc1_data},
        "citations": {"enabled": True},
        "title": "Annual Report 2024"
    },
    {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": doc2_data},
        "citations": {"enabled": True},
        "title": "Market Analysis Q4"
    }
]

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": documents + [
                {"type": "text", "text": "Compare the financial performance across both documents"}
            ]
        }
    ]
)
```

### Citation Best Practices

| Practice | Recommendation |
|----------|----------------|
| Document size | Keep under 50MB per document |
| Multiple docs | Max 5 documents for best citation quality |
| Query specificity | Ask specific questions for targeted citations |
| Verification | Always verify cited quotes in source material |

---

## Advanced Messages API

### Conversation Manager Class

```python
class Conversation:
    """Manage multi-turn conversations with Claude."""

    def __init__(self, system_prompt: str, model: str = "claude-sonnet-4-20250514"):
        self.messages = []
        self.system = system_prompt
        self.model = model
        self.client = Anthropic()

    def chat(self, user_message: str) -> str:
        self.messages.append({"role": "user", "content": user_message})

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=self.system,
            messages=self.messages
        )

        assistant_message = response.content[0].text
        self.messages.append({"role": "assistant", "content": assistant_message})

        return assistant_message

    def clear(self) -> None:
        self.messages = []


conv = Conversation("You are a helpful coding assistant.")
print(conv.chat("How do I read a file in Python?"))
print(conv.chat("What about async?"))
```

### All Parameters Reference

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | Model ID (required) |
| `max_tokens` | int | Max response tokens (required) |
| `messages` | array | Conversation messages (required) |
| `system` | string | System prompt |
| `temperature` | float (0-1) | Randomness (0=deterministic) |
| `top_p` | float (0-1) | Nucleus sampling |
| `top_k` | int | Top-k sampling |
| `stop_sequences` | array | Stop sequences |
| `stream` | boolean | Enable streaming |
| `metadata` | object | Request metadata |
| `tools` | array | Tool definitions |
| `tool_choice` | object | Tool selection |

---

## Advanced Tool Use

### Complete Tool Use Loop with Error Handling

```python
import json
from typing import Any
from anthropic import Anthropic

client = Anthropic()

tools = [
    {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City and state, e.g., San Francisco, CA"
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Temperature unit"
                }
            },
            "required": ["location"]
        }
    }
]

def get_weather(location: str, unit: str = "celsius") -> dict[str, Any]:
    return {"temperature": 22, "conditions": "sunny", "unit": unit}

available_functions = {"get_weather": get_weather}

def process_with_tools(user_message: str) -> str:
    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=tools,
            messages=messages
        )

        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    return block.text
            return ""

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                function = available_functions.get(block.name)
                if function:
                    result = function(**block.input)
                else:
                    result = {"error": f"Unknown function: {block.name}"}

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result)
                })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

result = process_with_tools("What's the weather in Tokyo?")
print(result)
```

### Tool Choice Options

```python
# Let model decide when to use tools
tool_choice = {"type": "auto"}

# Force no tool use
tool_choice = {"type": "none"}

# Require at least one tool call
tool_choice = {"type": "any"}

# Force specific tool
tool_choice = {"type": "tool", "name": "get_weather"}
```

---

## Advanced Extended Thinking

### Extended Thinking with Streaming

```python
with client.messages.stream(
    model="claude-sonnet-4-20250514",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000
    },
    messages=[{"role": "user", "content": "Complex reasoning task..."}]
) as stream:
    for event in stream:
        if event.type == "content_block_start":
            if event.content_block.type == "thinking":
                print("\n=== Thinking ===")
            elif event.content_block.type == "text":
                print("\n=== Response ===")
        elif event.type == "content_block_delta":
            if hasattr(event.delta, "thinking"):
                print(event.delta.thinking, end="", flush=True)
            elif hasattr(event.delta, "text"):
                print(event.delta.text, end="", flush=True)
```

### Budget Token Guidelines

| Task Complexity | Recommended Budget |
|-----------------|-------------------|
| Simple reasoning | 2,000 - 5,000 |
| Moderate complexity | 5,000 - 10,000 |
| Complex problems | 10,000 - 20,000 |
| Maximum depth | 20,000 - 32,000 |

**Note**: Extended thinking tokens are billed at output rates.

---

## Advanced Streaming

### Server-Sent Events (SSE) for Web

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from anthropic import Anthropic

app = FastAPI()
client = Anthropic()

@app.get("/stream")
async def stream_endpoint(prompt: str):
    def generate():
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {text}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

### Async Streaming with Full Control

```python
import asyncio
from anthropic import AsyncAnthropic

async def stream_response(prompt: str) -> str:
    client = AsyncAnthropic()
    collected = []

    async with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        async for text in stream.text_stream:
            collected.append(text)
            print(text, end="", flush=True)

    return "".join(collected)

asyncio.run(stream_response("Tell me a joke."))
```

---

## Advanced Vision

### Image from URL

```python
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": "https://example.com/image.jpg"
                    }
                },
                {
                    "type": "text",
                    "text": "What's in this image?"
                }
            ]
        }
    ]
)
```

### PDF Document Analysis

```python
import base64

with open("document.pdf", "rb") as f:
    pdf_data = base64.standard_b64encode(f.read()).decode("utf-8")

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_data
                    }
                },
                {
                    "type": "text",
                    "text": "Summarize this document."
                }
            ]
        }
    ]
)
```

---

## Prompt Caching Details

### Cache Control Patterns

```python
from anthropic import Anthropic

client = Anthropic()

# Large system prompt that benefits from caching
long_system_prompt = """You are an expert in...""" * 100  # Must be >1024 tokens

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": long_system_prompt,
            "cache_control": {"type": "ephemeral"}
        }
    ],
    messages=[
        {"role": "user", "content": "Question here"}
    ]
)

print(f"Cache creation tokens: {message.usage.cache_creation_input_tokens}")
print(f"Cache read tokens: {message.usage.cache_read_input_tokens}")
```

### Cache Requirements

- Minimum cacheable: 1024 tokens (2048 for claude-opus-4-5)
- Cache lifetime: ~5 minutes (ephemeral)
- Caching applies to prefixes only

### Cost Savings

| Scenario | Input Cost |
|----------|------------|
| No cache | 100% |
| Cache write | 125% (25% premium) |
| Cache hit | 10% (90% savings) |

---

## Error Handling

### Exception Types

```python
from anthropic import (
    Anthropic,
    APIError,
    APIConnectionError,
    RateLimitError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    InternalServerError,
    APIStatusError
)
```

### Comprehensive Error Handling

```python
from anthropic import (
    Anthropic,
    APIError,
    RateLimitError,
    AuthenticationError,
    APIConnectionError
)
import logging
import time

logger = logging.getLogger(__name__)
client = Anthropic()

def safe_message(messages: list, max_retries: int = 3) -> str | None:
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                messages=messages
            )
            return response.content[0].text

        except AuthenticationError as e:
            logger.error("Invalid API key - check ANTHROPIC_API_KEY")
            raise

        except RateLimitError as e:
            if attempt == max_retries - 1:
                raise
            wait_time = (2 ** attempt) + 1
            logger.warning(f"Rate limited, retrying in {wait_time}s")
            time.sleep(wait_time)

        except APIConnectionError as e:
            if attempt == max_retries - 1:
                raise
            logger.warning(f"Connection error, retrying...")
            time.sleep(1)

        except APIError as e:
            if e.status_code >= 500:
                if attempt == max_retries - 1:
                    raise
                wait_time = (2 ** attempt) + 1
                logger.warning(f"Server error {e.status_code}, retrying in {wait_time}s")
                time.sleep(wait_time)
            else:
                raise

    return None
```

---

## Best Practices

### 1. API Key Management

```python
# GOOD: Use environment variable (auto-detected)
client = Anthropic()

# GOOD: Use secret manager
from your_secret_manager import get_secret
client = Anthropic(api_key=get_secret("anthropic-api-key"))

# BAD: Never hardcode keys
# client = Anthropic(api_key="sk-...")  # NEVER DO THIS
```

### 2. Cost Optimization

```python
def get_model_for_task(task_type: str) -> str:
    """Select appropriate model for cost/quality tradeoff."""
    models = {
        "simple": "claude-3-5-haiku-20241022",
        "standard": "claude-3-5-sonnet-20241022",
        "complex": "claude-sonnet-4-20250514",
        "maximum": "claude-opus-4-5-20251101",
        "batch": "claude-sonnet-4-20250514"
    }
    return models.get(task_type, "claude-3-5-sonnet-20241022")
```

### 3. Token Estimation

```python
def estimate_tokens(text: str) -> int:
    """Rough token estimation (4 chars ~ 1 token for English)."""
    return len(text) // 4

# For accurate counting, use anthropic-tokenizer
# pip install anthropic-tokenizer
from anthropic_tokenizer import count_tokens
exact_count = count_tokens("Your text here", "claude-sonnet-4-20250514")
```

---

## Context7 Integration

For up-to-date documentation, use Context7 MCP when available:

### When to Use Context7

| Scenario | Context7 Query |
|----------|----------------|
| Python SDK latest | `resolve-library-id: anthropic` then `query-docs` |
| Node SDK latest | Query `/anthropic/anthropic-sdk-typescript` |
| API docs | Query `/websites/docs_anthropic` |
| Extended thinking | Query "extended thinking" |
| Tool use | Query "tool use" |

---

## Related Resources

- Official Docs: https://docs.anthropic.com/
- SDK Python: https://github.com/anthropics/anthropic-sdk-python
- SDK TypeScript: https://github.com/anthropics/anthropic-sdk-typescript
- Agent SDK: https://github.com/anthropics/claude-code-sdk
- MCP Spec: https://modelcontextprotocol.io/

---

_Anthropic SDK Reference | Last Updated: 2026-01-01_
