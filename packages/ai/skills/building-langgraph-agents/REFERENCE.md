# LangGraph Reference Guide

> Comprehensive patterns, production setup, and advanced features for LangGraph development.
> Load this file for detailed implementation guidance beyond SKILL.md quick start.

---

## Table of Contents

1. [Platform Differentiators](#platform-differentiators)
2. [Comparison with Alternatives](#comparison-with-alternatives)
3. [State Management](#state-management)
4. [Graph Building](#graph-building)
5. [Common Graph Patterns](#common-graph-patterns)
6. [Human-in-the-Loop](#human-in-the-loop)
7. [Multi-Agent Patterns](#multi-agent-patterns)
8. [Tool Integration](#tool-integration)
9. [Streaming](#streaming)
10. [Persistence / Checkpointers](#persistence--checkpointers)
11. [LangGraph Platform](#langgraph-platform)
12. [LangGraph Studio](#langgraph-studio)
13. [Error Handling](#error-handling)
14. [Best Practices](#best-practices)
15. [Anti-Patterns](#anti-patterns)
16. [Integration Checklist](#integration-checklist)

---

## Platform Differentiators

| Feature | LangGraph | Description |
|---------|-----------|-------------|
| Cyclic Graphs | Native | Loops and iterations without workarounds |
| State Persistence | Built-in | Checkpointers for memory, SQLite, Postgres |
| Human-in-the-Loop | First-class | `interrupt_before`, `interrupt_after` with state modification |
| Time Travel | Supported | Replay from any checkpoint, debug historical states |
| Streaming | Granular | Stream nodes, state updates, tokens, or all events |
| Branching | Conditional edges | Route based on state values or LLM output |
| Parallel Execution | `Send` API | Fan-out to multiple nodes simultaneously |
| Subgraphs | Nested | Compose graphs hierarchically for modularity |
| LangSmith Integration | Native | Tracing, debugging, evaluation out of the box |
| Visual Debugging | LangGraph Studio | Desktop app for graph visualization and debugging |
| Managed Deployment | LangGraph Platform | Hosted infrastructure with API, scaling, persistence |

---

## Comparison with Alternatives

| Capability | LangGraph | Raw LangChain | CrewAI | AutoGen |
|------------|-----------|---------------|--------|---------|
| Cyclic workflows | Native | Manual/impossible | Limited | Supported |
| Fine-grained control | Full | Full | Abstracted | Abstracted |
| State persistence | Checkpointers | Manual | None | Limited |
| Human-in-the-loop | First-class | Manual | Limited | Supported |
| Visual debugging | Studio | None | None | None |
| TypeScript support | Full | Full | None | None |
| Learning curve | Medium | Low | Low | Medium |
| Production-ready | Platform | DIY | Early | Early |

### When to Choose LangGraph

- Need cycles, loops, or iterative refinement
- Require persistent state across sessions
- Human approval/review workflows
- Complex multi-agent coordination
- Production deployment with managed infrastructure
- Fine-grained control over execution flow

### When to Choose Alternatives

- **Raw LangChain**: Simple linear chains, no cycles needed
- **CrewAI**: Quick prototyping with role-based agents
- **AutoGen**: Research/experimentation, conversation-style agents

---

## State Management

### Basic State

```python
from typing import TypedDict

class State(TypedDict):
    messages: list
    context: str
    iteration: int
    done: bool
```

### Annotated State with Reducers

Reducers define how updates are merged with existing state.

```python
from typing import Annotated
from operator import add
from langgraph.graph import add_messages

class State(TypedDict):
    # add_messages: intelligently merges message lists
    messages: Annotated[list, add_messages]

    # operator.add: concatenates lists
    items: Annotated[list, add]

    # No annotation: simple overwrite
    context: str
```

### Built-in Reducers

| Reducer | Import | Behavior |
|---------|--------|----------|
| `add_messages` | `langgraph.graph` | Merge messages, handle AI message IDs |
| `operator.add` | `operator` | Concatenate lists |
| Custom function | N/A | `def reducer(old, new) -> combined` |

### Custom Reducer Example

```python
def max_reducer(current: int, update: int) -> int:
    """Keep the maximum value."""
    return max(current, update)

class State(TypedDict):
    high_score: Annotated[int, max_reducer]
```

### MessagesState (Prebuilt)

For chat applications, use the prebuilt MessagesState:

```python
from langgraph.graph import MessagesState

# Equivalent to:
# class MessagesState(TypedDict):
#     messages: Annotated[list[AnyMessage], add_messages]

graph = StateGraph(MessagesState)
```

---

## Graph Building

### Adding Nodes

```python
# Function node
graph.add_node("process", process_function)

# Runnable node (LangChain compatible)
graph.add_node("llm", llm_chain)

# Prebuilt node
from langgraph.prebuilt import ToolNode
graph.add_node("tools", ToolNode(tools))
```

### Unconditional Edges

```python
graph.add_edge(START, "first")
graph.add_edge("first", "second")
graph.add_edge("second", END)
```

### Conditional Edges

```python
def route_by_intent(state: State) -> str:
    """Return the name of the next node."""
    if state["intent"] == "search":
        return "search_node"
    elif state["intent"] == "calculate":
        return "calc_node"
    return "default_node"

graph.add_conditional_edges(
    "classifier",           # Source node
    route_by_intent,        # Routing function
    {                       # Mapping (optional, for validation)
        "search_node": "search_node",
        "calc_node": "calc_node",
        "default_node": "default_node"
    }
)
```

### Conditional Edge to END

```python
def should_continue(state: State) -> str:
    if state["done"]:
        return END
    return "continue_processing"

graph.add_conditional_edges("check", should_continue)
```

### Entry Points

```python
# Standard entry
graph.add_edge(START, "entry_node")

# Conditional entry
graph.set_conditional_entry_point(
    router_function,
    {"route_a": "node_a", "route_b": "node_b"}
)
```

### Building Cycles

```python
def check_iteration(state: State) -> str:
    if state["iteration"] >= 3:
        return "done"
    return "continue"

graph.add_node("process", process_node)
graph.add_node("check", check_node)

graph.add_edge(START, "process")
graph.add_edge("process", "check")
graph.add_conditional_edges(
    "check",
    check_iteration,
    {"continue": "process", "done": END}  # Loop back or exit
)
```

---

## Common Graph Patterns

### Linear Pipeline

```
START -> Extract -> Transform -> Load -> END
```

```python
graph.add_edge(START, "extract")
graph.add_edge("extract", "transform")
graph.add_edge("transform", "load")
graph.add_edge("load", END)
```

### Branching (Fan-out)

```
START -> Router -> [Branch A] -> Merge -> END
              \-> [Branch B] -/
```

```python
def router(state):
    return state["route"]

graph.add_conditional_edges(
    "router",
    router,
    {"a": "branch_a", "b": "branch_b"}
)
graph.add_edge("branch_a", "merge")
graph.add_edge("branch_b", "merge")
```

### Cycle with Exit Condition

```
START -> Process -> Check --(done)--> END
              ^______|  (not done)
```

```python
def check_done(state):
    return END if state["done"] else "process"

graph.add_edge(START, "process")
graph.add_edge("process", "check")
graph.add_conditional_edges("check", check_done)
```

### Parallel Execution (Send API)

```python
from langgraph.constants import Send

def fan_out(state: State) -> list[Send]:
    """Send work to multiple parallel workers."""
    return [
        Send("worker", {"task": task, "id": i})
        for i, task in enumerate(state["tasks"])
    ]

graph.add_conditional_edges("dispatcher", fan_out)
```

### Subgraph Composition

```python
# Create inner graph
inner = StateGraph(InnerState)
inner.add_node("step1", step1_fn)
inner.add_node("step2", step2_fn)
inner.add_edge(START, "step1")
inner.add_edge("step1", "step2")
inner.add_edge("step2", END)
inner_compiled = inner.compile()

# Use as node in outer graph
outer = StateGraph(OuterState)
outer.add_node("preprocessing", preprocess)
outer.add_node("inner_workflow", inner_compiled)  # Subgraph as node
outer.add_node("postprocessing", postprocess)

outer.add_edge(START, "preprocessing")
outer.add_edge("preprocessing", "inner_workflow")
outer.add_edge("inner_workflow", "postprocessing")
outer.add_edge("postprocessing", END)
```

---

## Human-in-the-Loop

### Interrupt Before Node

Pause execution before a node runs, allowing human review.

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()

app = graph.compile(
    checkpointer=memory,
    interrupt_before=["sensitive_action"]  # Pause before this node
)

config = {"configurable": {"thread_id": "user-123"}}

# Run until interrupt
result = app.invoke({"input": "data"}, config)
print("Paused for review. Current state:", result)

# Human reviews... then continue
final_result = app.invoke(None, config)  # None continues from checkpoint
```

### Interrupt After Node

Pause after a node completes for review before proceeding.

```python
app = graph.compile(
    checkpointer=memory,
    interrupt_after=["draft_response"]
)
```

### Modifying State During Interrupt

```python
config = {"configurable": {"thread_id": "user-123"}}

# Run until interrupt
result = app.invoke(input_data, config)

# Get current state snapshot
state_snapshot = app.get_state(config)
print("Current state:", state_snapshot.values)

# Human modifies state
app.update_state(
    config,
    {"approved": True, "modified_content": "Updated by human"}
)

# Continue with modified state
final = app.invoke(None, config)
```

### Multiple Interrupt Points

```python
app = graph.compile(
    checkpointer=memory,
    interrupt_before=["dangerous_operation"],
    interrupt_after=["draft_output", "final_review"]
)
```

---

## Multi-Agent Patterns

### Supervisor Pattern

A supervisor agent routes tasks to specialized workers.

```python
from langchain_openai import ChatOpenAI

class SupervisorState(TypedDict):
    messages: Annotated[list, add_messages]
    next_agent: str
    task_complete: bool

def supervisor(state: SupervisorState) -> dict:
    """Decide which agent should handle the task."""
    llm = ChatOpenAI(model="gpt-4o")

    decision = llm.invoke([
        ("system", "Route to: researcher, writer, or FINISH"),
        *state["messages"]
    ])

    if "researcher" in decision.content.lower():
        return {"next_agent": "researcher"}
    elif "writer" in decision.content.lower():
        return {"next_agent": "writer"}
    return {"next_agent": "FINISH", "task_complete": True}

def researcher(state: SupervisorState) -> dict:
    return {"messages": [("assistant", "Research findings...")]}

def writer(state: SupervisorState) -> dict:
    return {"messages": [("assistant", "Draft content...")]}

# Build supervisor graph
graph = StateGraph(SupervisorState)
graph.add_node("supervisor", supervisor)
graph.add_node("researcher", researcher)
graph.add_node("writer", writer)

graph.add_edge(START, "supervisor")

def route_to_agent(state):
    if state["task_complete"]:
        return END
    return state["next_agent"]

graph.add_conditional_edges("supervisor", route_to_agent)
graph.add_edge("researcher", "supervisor")
graph.add_edge("writer", "supervisor")

app = graph.compile()
```

### Hierarchical Agents

```
Supervisor
|-- Research Team (subgraph)
|   |-- Searcher
|   +-- Analyst
+-- Writing Team (subgraph)
    |-- Drafter
    +-- Editor
```

```python
# Create team subgraphs
research_team = create_research_team_graph()
writing_team = create_writing_team_graph()

# Main supervisor
main_graph = StateGraph(MainState)
main_graph.add_node("supervisor", main_supervisor)
main_graph.add_node("research_team", research_team.compile())
main_graph.add_node("writing_team", writing_team.compile())

main_graph.add_conditional_edges("supervisor", team_router)
main_graph.add_edge("research_team", "supervisor")
main_graph.add_edge("writing_team", "supervisor")
```

### Agent Handoff with Command

```python
from langgraph.types import Command

def agent_with_handoff(state: State) -> Command:
    """Handoff to another agent with context."""
    return Command(
        goto="specialist_agent",
        update={"context": state["analysis"], "handoff_reason": "needs expertise"}
    )
```

---

## Tool Integration

### Defining Tools

```python
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """Search the web for information.

    Args:
        query: The search query string
    """
    return search_api(query)

@tool
def calculator(expression: str) -> float:
    """Evaluate a mathematical expression.

    Args:
        expression: Math expression like '2 + 2' or 'sqrt(16)'
    """
    import math
    return eval(expression, {"__builtins__": {}}, {"sqrt": math.sqrt, "pow": pow})

@tool
def get_weather(city: str, units: str = "fahrenheit") -> dict:
    """Get current weather for a city.

    Args:
        city: City name
        units: Temperature units (fahrenheit or celsius)
    """
    return {"city": city, "temp": 72, "units": units, "conditions": "sunny"}
```

### Binding Tools to LLM

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")
tools = [search, calculator, get_weather]

# Bind tools - LLM will format tool calls in responses
llm_with_tools = llm.bind_tools(tools)

def agent(state: MessagesState):
    response = llm_with_tools.invoke(state["messages"])
    return {"messages": [response]}
```

### ToolNode for Automatic Execution

```python
from langgraph.prebuilt import ToolNode

# ToolNode automatically executes tools from AIMessage.tool_calls
tool_node = ToolNode(tools)

graph.add_node("tools", tool_node)
```

### Accessing State in Tools

```python
from langgraph.prebuilt import InjectedState
from typing import Annotated

@tool
def stateful_search(
    query: str,
    state: Annotated[dict, InjectedState]
) -> str:
    """Search with full access to graph state."""
    user_preferences = state.get("preferences", {})
    history = state.get("messages", [])
    enhanced_query = f"{query} preferences:{user_preferences}"
    return perform_search(enhanced_query)
```

### Tool Error Handling

```python
from langchain_core.tools import ToolException

@tool
def risky_operation(data: str) -> str:
    """Operation that might fail."""
    try:
        result = external_api(data)
        return result
    except ExternalAPIError as e:
        raise ToolException(f"API error: {e}")  # Gracefully reported to LLM
```

---

## Streaming

### Stream Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `values` | Full state after each node | Simple debugging |
| `updates` | Only changes from each node | Efficient monitoring |
| `messages` | Token-by-token LLM output | Real-time UI updates |
| `events` | All events (start, end, errors) | Comprehensive logging |

### Basic Streaming

```python
# Stream state updates
for chunk in app.stream({"messages": [("user", "Hello")]}):
    node_name = list(chunk.keys())[0]
    node_output = chunk[node_name]
    print(f"{node_name}: {node_output}")

# Stream with specific mode
for chunk in app.stream(input_data, stream_mode="updates"):
    print(chunk)
```

### Async Streaming

```python
async for chunk in app.astream(input_data):
    print(chunk)
```

### Stream Events (Most Granular)

```python
async for event in app.astream_events(input_data, version="v2"):
    kind = event["event"]

    if kind == "on_chain_start":
        print(f"Starting: {event['name']}")

    elif kind == "on_chat_model_stream":
        # Token-by-token LLM output
        content = event["data"]["chunk"].content
        print(content, end="", flush=True)

    elif kind == "on_chain_end":
        print(f"\nFinished: {event['name']}")

    elif kind == "on_tool_start":
        print(f"Calling tool: {event['name']}")
```

### Stream from Specific Nodes

```python
async for event in app.astream_events(input_data, version="v2"):
    if event["name"] == "agent" and event["event"] == "on_chat_model_stream":
        token = event["data"]["chunk"].content
        if token:
            print(token, end="", flush=True)
```

---

## Persistence / Checkpointers

| Checkpointer | Import | Use Case | Persistence |
|--------------|--------|----------|-------------|
| `MemorySaver` | `langgraph.checkpoint.memory` | Development, testing | In-memory (lost on restart) |
| `SqliteSaver` | `langgraph.checkpoint.sqlite` | Single-node production | File-based |
| `AsyncSqliteSaver` | `langgraph.checkpoint.sqlite.aio` | Async applications | File-based |
| `PostgresSaver` | `langgraph.checkpoint.postgres` | Multi-node production | PostgreSQL |
| `AsyncPostgresSaver` | `langgraph.checkpoint.postgres.aio` | Async + Postgres | PostgreSQL |

### MemorySaver (Development)

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
app = graph.compile(checkpointer=memory)

config = {"configurable": {"thread_id": "user-123"}}
result = app.invoke({"messages": [("user", "Hi")]}, config)

# Continue same conversation
result = app.invoke({"messages": [("user", "What did I say?")]}, config)
```

### SqliteSaver (Single Node)

```python
from langgraph.checkpoint.sqlite import SqliteSaver

with SqliteSaver.from_conn_string("checkpoints.db") as checkpointer:
    app = graph.compile(checkpointer=checkpointer)

    config = {"configurable": {"thread_id": "session-456"}}
    result = app.invoke(input_data, config)
```

### PostgresSaver (Production)

```python
from langgraph.checkpoint.postgres import PostgresSaver

DB_URI = "postgresql://user:pass@localhost:5432/langgraph"

with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
    # Setup tables (first time only)
    checkpointer.setup()

    app = graph.compile(checkpointer=checkpointer)

    config = {"configurable": {"thread_id": "prod-thread-789"}}
    result = app.invoke(input_data, config)
```

### Async PostgresSaver

```python
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def main():
    async with AsyncPostgresSaver.from_conn_string(DB_URI) as checkpointer:
        await checkpointer.setup()

        app = graph.compile(checkpointer=checkpointer)

        config = {"configurable": {"thread_id": "async-thread"}}
        result = await app.ainvoke(input_data, config)
```

### Time Travel Debugging

```python
config = {"configurable": {"thread_id": "debug-session"}}

# Get full history
history = list(app.get_state_history(config))

for i, state_snapshot in enumerate(history):
    print(f"Step {i}: {state_snapshot.values}")
    print(f"  Next: {state_snapshot.next}")
    print(f"  Config: {state_snapshot.config}")

# Replay from specific checkpoint
old_state = history[2]  # Go back 2 steps
result = app.invoke(None, old_state.config)  # Continue from there
```

---

## LangGraph Platform

### Overview

LangGraph Platform provides managed infrastructure for deploying LangGraph applications:
- Automatic scaling
- Built-in persistence
- API endpoints
- Monitoring and logging
- Authentication

### Deployment Options

| Option | Description |
|--------|-------------|
| **Self-Hosted** | Deploy with `langgraph` CLI on your infrastructure |
| **Cloud** | Fully managed LangGraph Cloud service |

### Project Configuration (langgraph.json)

```json
{
  "dependencies": ["."],
  "graphs": {
    "agent": "./agent.py:graph"
  },
  "env": ".env"
}
```

### CLI Commands

```bash
langgraph init       # Initialize project
langgraph dev        # Start local development server
langgraph build --tag my-agent  # Build Docker image
langgraph up         # Deploy locally with Docker
langgraph status     # Check status
```

### SDK Client Usage

```python
from langgraph_sdk import get_client

client = get_client(url="http://localhost:8123")

# Create a conversation thread
thread = await client.threads.create()

# Run the graph
run = await client.runs.create(
    thread["thread_id"],
    assistant_id="agent",
    input={"messages": [{"role": "user", "content": "Hello"}]}
)

# Wait for completion
result = await client.runs.join(thread["thread_id"], run["run_id"])

# Stream responses
async for event in client.runs.stream(
    thread["thread_id"],
    assistant_id="agent",
    input={"messages": [{"role": "user", "content": "Hello"}]}
):
    print(event)
```

---

## LangGraph Studio

Desktop application for visual debugging and development.

### Features

| Feature | Description |
|---------|-------------|
| **Graph Visualization** | See node connections and data flow |
| **State Inspector** | View state at each execution step |
| **Time Travel** | Step backward/forward through execution |
| **Breakpoints** | Pause execution at specific nodes |
| **Edit & Replay** | Modify state and re-run from any point |
| **Thread Management** | Switch between conversation threads |

### Setup

1. Download LangGraph Studio from [langchain.com](https://www.langchain.com/langgraph-studio)
2. Open project folder containing `langgraph.json`
3. Studio automatically detects and visualizes your graphs

### Usage Tips

- Use Studio during development to debug complex flows
- Set breakpoints on conditional edges to inspect routing decisions
- Time travel helps identify where state diverges from expected
- Export execution traces for sharing/debugging

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `InvalidUpdateError` | Node returned keys not in state schema | Only return defined state keys |
| `GraphRecursionError` | Max iterations exceeded (default: 25) | Add exit condition or increase `recursion_limit` |
| `NodeInterrupt` | Explicit interrupt raised | Handle in human-in-the-loop flow |
| `ValueError: Checkpointer required` | Thread operations without persistence | Add checkpointer to `compile()` |
| `KeyError` in state | Accessing undefined state key | Check state schema, provide defaults |

### Setting Recursion Limit

```python
app = graph.compile()

result = app.invoke(
    input_data,
    {"recursion_limit": 50}  # Default is 25
)
```

### Retry Pattern

```python
import time
from langchain_core.runnables import RunnableConfig

def node_with_retry(state: State, config: RunnableConfig) -> dict:
    """Node with exponential backoff retry."""
    max_retries = 3

    for attempt in range(max_retries):
        try:
            result = call_external_api(state["input"])
            return {"result": result, "error": None}
        except ExternalAPIError as e:
            if attempt == max_retries - 1:
                return {"result": None, "error": str(e)}
            time.sleep(2 ** attempt)

    return {"result": None, "error": "Max retries exceeded"}
```

### Graceful Degradation

```python
def safe_node(state: State) -> dict:
    """Node that handles errors gracefully."""
    try:
        result = risky_operation(state["data"])
        return {"result": result, "status": "success", "error": None}
    except OperationError as e:
        return {"result": None, "status": "failed", "error": str(e)}
    except Exception as e:
        return {"result": None, "status": "error", "error": f"Unexpected: {e}"}
```

### Error Routing

```python
def route_on_error(state: State) -> str:
    """Route based on error status."""
    if state.get("error"):
        return "error_handler"
    return "continue_processing"

graph.add_conditional_edges("risky_node", route_on_error)
```

---

## Best Practices

### 1. State Design

```python
# GOOD: Minimal, typed state
class State(TypedDict):
    messages: Annotated[list, add_messages]
    current_step: str
    iteration: int

# BAD: Unstructured blob
class State(TypedDict):
    data: dict  # What's in here?
```

### 2. Node Granularity

```python
# GOOD: Single responsibility
def validate_input(state): ...
def process_data(state): ...
def format_output(state): ...

# BAD: Monolithic node
def do_everything(state):
    validate()
    process()
    format()
    return result
```

### 3. Conditional Logic

```python
# GOOD: Pure, deterministic routing
def route(state: State) -> str:
    if state["intent"] == "search":
        return "search_node"
    return "default_node"

# BAD: Side effects in router
def route(state: State) -> str:
    log_to_database(state)  # Side effect!
    return state["next"]
```

### 4. Always Use Checkpointers in Production

```python
# GOOD: Persistent state
app = graph.compile(checkpointer=postgres_saver)

# BAD: Lost on crash
app = graph.compile()
```

### 5. Meaningful Thread IDs

```python
# GOOD: Traceable IDs
config = {"configurable": {"thread_id": f"user-{user_id}-session-{session_id}"}}

# BAD: Random/meaningless
config = {"configurable": {"thread_id": "abc123"}}
```

### 6. Enable Streaming for UX

```python
# GOOD: User sees progress
async for chunk in app.astream_events(input, version="v2"):
    yield chunk

# BAD: User waits for full response
result = app.invoke(input)
```

### 7. Test Nodes in Isolation

```python
def test_process_node():
    state = {"input": "test", "count": 0}
    result = process_node(state)
    assert result["count"] == 1
```

### 8. Decompose with Subgraphs

```python
# GOOD: Modular composition
research_graph = create_research_subgraph()
main_graph.add_node("research", research_graph.compile())

# BAD: 50 nodes in one graph
```

### 9. Always Have Exit Conditions

```python
# GOOD: Guaranteed termination
def check(state) -> str:
    if state["iteration"] > 10:
        return END  # Safety exit
    if state["done"]:
        return END
    return "continue"
```

### 10. Enable LangSmith Tracing

```bash
export LANGSMITH_API_KEY="ls-..."
export LANGCHAIN_TRACING_V2="true"
```

---

## Anti-Patterns

### Unbounded Cycles

```python
# BAD: Infinite loop
graph.add_edge("process", "check")
graph.add_edge("check", "process")  # No exit!

# GOOD: Exit condition
def check(state) -> str:
    return END if state["done"] else "process"

graph.add_conditional_edges("check", check)
```

### Overloaded State

```python
# BAD: Kitchen sink state
class State(TypedDict):
    everything: dict
    temp_data: Any
    debug_info: list

# GOOD: Focused state
class State(TypedDict):
    messages: Annotated[list, add_messages]
    current_task: str
```

### Side Effects in Nodes

```python
# BAD: Global mutation
cache = {}

def node(state):
    cache[state["id"]] = state  # Side effect!
    return state

# GOOD: Pure function
def node(state):
    return {"processed": True}
```

### Ignoring Checkpointer

```python
# BAD: No persistence in production
app = graph.compile()
# Crash = lost conversation

# GOOD: Always checkpoint
app = graph.compile(checkpointer=PostgresSaver(...))
```

### Blocking in Async Context

```python
# BAD: Blocking call in async
async def handler():
    result = app.invoke(data)  # Blocks event loop!

# GOOD: Use async methods
async def handler():
    result = await app.ainvoke(data)
```

### Hardcoded Model Selection

```python
# BAD: Can't change model
llm = ChatOpenAI(model="gpt-4o")

# GOOD: Configurable
def get_llm(model: str = "gpt-4o"):
    return ChatOpenAI(model=model)
```

---

## Integration Checklist

### Pre-Flight

- [ ] `langgraph` installed with compatible `langchain-core`
- [ ] State schema defined with proper TypedDict
- [ ] All nodes return valid partial state updates
- [ ] Exit conditions exist for all cycles
- [ ] Checkpointer configured for stateful applications
- [ ] LangSmith API key set (recommended for debugging)
- [ ] Tools properly typed with docstrings

### Production Readiness

- [ ] PostgresSaver for multi-node persistence
- [ ] Error handling in all nodes
- [ ] Retry logic for external API calls
- [ ] Streaming enabled for user-facing applications
- [ ] Thread ID strategy defined and documented
- [ ] Recursion limit appropriate for graph complexity
- [ ] Monitoring/alerting configured
- [ ] Rate limiting at application level
- [ ] Graceful degradation for failures
- [ ] LangGraph Studio tested during development

---

## Agent Integration (Ensemble)

### Compatible Agents

| Agent | Use Case |
|-------|----------|
| `backend-developer` | Graph implementation, state design, node logic |
| `deep-debugger` | Execution issues, state bugs, cycle analysis |
| `tech-lead-orchestrator` | Multi-agent architecture, graph decomposition |
| `code-reviewer` | Graph logic review, state management audit |
| `test-runner` | Node unit tests, integration tests |

### Handoff to Deep-Debugger

```yaml
When:
  - Graph stuck in infinite cycle
  - State not updating as expected
  - Checkpointer errors or data loss
  - Streaming not producing output
  - Conditional edges routing incorrectly

Provide:
  - Graph structure (nodes, edges, conditions)
  - State schema definition
  - Error messages and stack traces
  - Checkpoint history if available
  - Sample input that reproduces issue
```

### Handoff from Tech-Lead

```yaml
When:
  - Multi-agent architecture designed
  - Graph patterns selected
  - Implementation ready to begin

Receive:
  - Architecture diagram/description
  - State schema requirements
  - Node responsibilities
  - Integration points with external systems
  - Performance requirements
```

### Handoff to Code-Reviewer

```yaml
When:
  - Graph implementation complete
  - Ready for production deployment

Review Focus:
  - Exit conditions for all cycles
  - Error handling in nodes
  - State schema completeness
  - Checkpointer configuration
  - Security of tool implementations
```

---

## Context7 Integration

For up-to-date documentation, use Context7 MCP when available:

| Scenario | Context7 Query |
|----------|----------------|
| Python SDK latest | `resolve-library-id: langgraph` then `query-docs` |
| Prebuilt agents | Query "langgraph create_react_agent" |
| Checkpointers | Query "langgraph checkpointer postgres" |
| Platform API | Query "langgraph platform deployment" |

---

## See Also

- [SKILL.md](./SKILL.md) - Quick start and basic patterns
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [LangGraph Platform](https://www.langchain.com/langgraph-platform)
- [LangGraph Studio](https://www.langchain.com/langgraph-studio)
- [LangSmith](https://smith.langchain.com/)
- [LangGraph Tutorials](https://langchain-ai.github.io/langgraph/tutorials/)
- [LangGraph Examples](https://github.com/langchain-ai/langgraph/tree/main/examples)

---

## Pricing Reference

| Tier | Cost | Description |
|------|------|-------------|
| **Open Source** | Free | Full LangGraph library, self-hosted |
| **LangSmith Free** | Free | 5K traces/month, basic debugging |
| **LangSmith Plus** | $39+/mo | Unlimited traces, advanced features |
| **LangGraph Platform** | Usage-based | Managed deployment, scaling, persistence |

**Disclaimer**: Pricing subject to change. Verify at [langchain.com](https://www.langchain.com/pricing).
