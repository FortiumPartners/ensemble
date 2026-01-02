#!/usr/bin/env python3
"""
OpenAI Agents (Assistants API) Example

Demonstrates the Assistants API for building AI agents with:
- Persistent threads for conversation history
- Built-in tools: code_interpreter, file_search
- Custom function tools
- File uploads and management
- Streaming run execution

Prerequisites:
    pip install openai>=1.0.0
    export OPENAI_API_KEY=your-key

Usage:
    python agent.example.py
"""

import os
import json
import time
import logging
from typing import List, Dict, Any, Optional

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Basic Agent Creation
# =============================================================================

def create_basic_agent(client: OpenAI) -> Any:
    """Create a simple assistant agent.

    Args:
        client: OpenAI client instance

    Returns:
        The created assistant object
    """
    print("\n=== Creating Basic Agent ===\n")

    assistant = client.beta.assistants.create(
        name="Math Tutor",
        instructions="You are a helpful math tutor. Explain concepts clearly and provide step-by-step solutions.",
        model="gpt-4o-mini",
        tools=[{"type": "code_interpreter"}],  # Built-in tool for calculations
    )

    print(f"Created assistant: {assistant.id}")
    print(f"Name: {assistant.name}")
    print(f"Model: {assistant.model}")
    print(f"Tools: {[t.type for t in assistant.tools]}")

    return assistant


# =============================================================================
# Thread Management
# =============================================================================

def create_thread_and_run(client: OpenAI, assistant_id: str) -> Any:
    """Create a thread and run a conversation.

    Args:
        client: OpenAI client instance
        assistant_id: The assistant ID to use

    Returns:
        The thread object
    """
    print("\n=== Thread and Run ===\n")

    # Create a thread (conversation container)
    thread = client.beta.threads.create()
    print(f"Created thread: {thread.id}")

    # Add a message to the thread
    message = client.beta.threads.messages.create(
        thread_id=thread.id,
        role="user",
        content="What is the derivative of x^3 + 2x^2 - 5x + 7?",
    )
    print(f"Added message: {message.id}")

    # Run the assistant on the thread
    run = client.beta.threads.runs.create(
        thread_id=thread.id,
        assistant_id=assistant_id,
    )
    print(f"Started run: {run.id}")

    # Wait for completion
    while run.status in ["queued", "in_progress"]:
        time.sleep(1)
        run = client.beta.threads.runs.retrieve(
            thread_id=thread.id,
            run_id=run.id,
        )
        print(f"Run status: {run.status}")

    # Get the assistant's response
    messages = client.beta.threads.messages.list(thread_id=thread.id)

    for msg in messages.data:
        if msg.role == "assistant":
            for content in msg.content:
                if content.type == "text":
                    print(f"\nAssistant: {content.text.value}")
                    break
            break

    return thread


def continue_conversation(client: OpenAI, thread_id: str, assistant_id: str) -> None:
    """Continue an existing conversation.

    Args:
        client: OpenAI client instance
        thread_id: The existing thread ID
        assistant_id: The assistant ID to use
    """
    print("\n=== Continuing Conversation ===\n")

    # Add follow-up message
    client.beta.threads.messages.create(
        thread_id=thread_id,
        role="user",
        content="Now find the second derivative.",
    )
    print("Added follow-up message")

    # Run again - the assistant has full conversation context
    run = client.beta.threads.runs.create_and_poll(
        thread_id=thread_id,
        assistant_id=assistant_id,
    )

    if run.status == "completed":
        messages = client.beta.threads.messages.list(thread_id=thread_id, limit=1)
        for msg in messages.data:
            for content in msg.content:
                if content.type == "text":
                    print(f"Assistant: {content.text.value}")
                    break


# =============================================================================
# Agent with Custom Function Tools
# =============================================================================

def create_agent_with_tools(client: OpenAI) -> Any:
    """Create an agent with custom function tools.

    Args:
        client: OpenAI client instance

    Returns:
        The created assistant object
    """
    print("\n=== Agent with Custom Tools ===\n")

    # Define custom tools
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_stock_price",
                "description": "Get the current stock price for a given symbol",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": {
                            "type": "string",
                            "description": "The stock symbol (e.g., AAPL, GOOGL)",
                        }
                    },
                    "required": ["symbol"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calculate_portfolio_value",
                "description": "Calculate total portfolio value given holdings",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "holdings": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "symbol": {"type": "string"},
                                    "shares": {"type": "number"},
                                },
                            },
                        }
                    },
                    "required": ["holdings"],
                },
            },
        },
    ]

    assistant = client.beta.assistants.create(
        name="Financial Advisor",
        instructions="You are a financial advisor. Use the available tools to help users with stock and portfolio questions.",
        model="gpt-4o-mini",
        tools=tools,
    )

    print(f"Created assistant: {assistant.id}")
    print(f"Tools: {[t.function.name if t.type == 'function' else t.type for t in assistant.tools]}")

    return assistant


def handle_tool_calls(client: OpenAI, thread_id: str, run_id: str) -> Any:
    """Handle tool calls from the assistant.

    Args:
        client: OpenAI client instance
        thread_id: The thread ID
        run_id: The run ID

    Returns:
        The updated run object
    """
    # Mock function implementations
    def get_stock_price(symbol: str) -> Dict[str, Any]:
        prices = {"AAPL": 185.50, "GOOGL": 142.30, "MSFT": 378.20}
        return {"symbol": symbol, "price": prices.get(symbol, 100.00)}

    def calculate_portfolio_value(holdings: List[Dict]) -> Dict[str, Any]:
        prices = {"AAPL": 185.50, "GOOGL": 142.30, "MSFT": 378.20}
        total = sum(
            h["shares"] * prices.get(h["symbol"], 100.00)
            for h in holdings
        )
        return {"total_value": total}

    # Get the run to check for required actions
    run = client.beta.threads.runs.retrieve(
        thread_id=thread_id,
        run_id=run_id,
    )

    if run.status == "requires_action":
        tool_outputs = []

        for tool_call in run.required_action.submit_tool_outputs.tool_calls:
            args = json.loads(tool_call.function.arguments)
            logger.info(f"Executing tool: {tool_call.function.name} with args: {args}")

            if tool_call.function.name == "get_stock_price":
                result = get_stock_price(args["symbol"])
            elif tool_call.function.name == "calculate_portfolio_value":
                result = calculate_portfolio_value(args["holdings"])
            else:
                result = {"error": "Unknown function"}

            tool_outputs.append({
                "tool_call_id": tool_call.id,
                "output": json.dumps(result),
            })

        # Submit tool outputs back to the run
        run = client.beta.threads.runs.submit_tool_outputs_and_poll(
            thread_id=thread_id,
            run_id=run_id,
            tool_outputs=tool_outputs,
        )

    return run


def run_agent_with_tools(client: OpenAI) -> None:
    """Full example of running an agent with tool calling.

    Args:
        client: OpenAI client instance
    """
    print("\n=== Running Agent with Tool Calling ===\n")

    assistant = create_agent_with_tools(client)
    thread = client.beta.threads.create()

    # User asks about portfolio
    client.beta.threads.messages.create(
        thread_id=thread.id,
        role="user",
        content="What's the current price of AAPL and GOOGL? Then calculate the value of a portfolio with 100 shares of each.",
    )
    print("User: What's the current price of AAPL and GOOGL? Then calculate the value of a portfolio with 100 shares of each.")

    # Start the run
    run = client.beta.threads.runs.create(
        thread_id=thread.id,
        assistant_id=assistant.id,
    )

    # Poll and handle tool calls
    while run.status not in ["completed", "failed", "cancelled"]:
        time.sleep(1)
        run = client.beta.threads.runs.retrieve(
            thread_id=thread.id,
            run_id=run.id,
        )

        if run.status == "requires_action":
            run = handle_tool_calls(client, thread.id, run.id)

    # Get final response
    if run.status == "completed":
        messages = client.beta.threads.messages.list(thread_id=thread.id, limit=1)
        for msg in messages.data:
            for content in msg.content:
                if content.type == "text":
                    print(f"\nAssistant: {content.text.value}")
                    break

    # Cleanup
    client.beta.assistants.delete(assistant.id)
    print("\nCleaned up assistant")


# =============================================================================
# Streaming Agent Responses
# =============================================================================

def streaming_agent(client: OpenAI) -> None:
    """Stream agent responses in real-time.

    Args:
        client: OpenAI client instance
    """
    print("\n=== Streaming Agent Responses ===\n")

    assistant = client.beta.assistants.create(
        name="Storyteller",
        instructions="You are a creative storyteller. Write engaging short stories.",
        model="gpt-4o-mini",
    )

    thread = client.beta.threads.create()

    client.beta.threads.messages.create(
        thread_id=thread.id,
        role="user",
        content="Write a very short story (2-3 sentences) about a robot learning to paint.",
    )
    print("User: Write a very short story about a robot learning to paint.\n")
    print("Assistant: ", end="", flush=True)

    # Stream the run
    with client.beta.threads.runs.stream(
        thread_id=thread.id,
        assistant_id=assistant.id,
    ) as stream:
        for text in stream.text_deltas:
            print(text, end="", flush=True)

    print()  # Newline at end

    # Cleanup
    client.beta.assistants.delete(assistant.id)


# =============================================================================
# Agent with File Search (RAG)
# =============================================================================

def agent_with_file_search(client: OpenAI) -> None:
    """Create an agent that can search uploaded files.

    Args:
        client: OpenAI client instance
    """
    print("\n=== Agent with File Search ===\n")

    # Create a vector store for files
    vector_store = client.beta.vector_stores.create(
        name="Product Documentation",
    )
    print(f"Created vector store: {vector_store.id}")

    # Note: In a real scenario, you would upload files:
    # file = client.files.create(file=open("docs.pdf", "rb"), purpose="assistants")
    # client.beta.vector_stores.files.create(vector_store_id=vector_store.id, file_id=file.id)

    # Create assistant with file search
    assistant = client.beta.assistants.create(
        name="Documentation Helper",
        instructions="You help users find information in the product documentation.",
        model="gpt-4o-mini",
        tools=[{"type": "file_search"}],
        tool_resources={
            "file_search": {
                "vector_store_ids": [vector_store.id],
            }
        },
    )

    print(f"Created assistant with file search: {assistant.id}")
    print("Note: Upload files to the vector store to enable document search")

    # Cleanup
    client.beta.assistants.delete(assistant.id)
    client.beta.vector_stores.delete(vector_store.id)
    print("Cleaned up resources")


# =============================================================================
# GPT-4o Mega Agent Pattern
# =============================================================================

def mega_agent_pattern(client: OpenAI) -> None:
    """
    Mega Agent Pattern

    GPT-4o and newer models can handle many tools simultaneously,
    enabling consolidation of multiple agents into a single "mega-agent"
    which is often faster and easier to maintain than multi-agent orchestration.

    Args:
        client: OpenAI client instance
    """
    print("\n=== Mega Agent Pattern ===\n")

    # Define many tools for a single powerful agent
    tools = [
        {"type": "code_interpreter"},
        {"type": "file_search"},
        {
            "type": "function",
            "function": {
                "name": "search_database",
                "description": "Search the product database",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer"},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "send_email",
                "description": "Send an email to a user",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "to": {"type": "string"},
                        "subject": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["to", "subject", "body"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_ticket",
                "description": "Create a support ticket",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                        "description": {"type": "string"},
                    },
                    "required": ["title", "description"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "schedule_meeting",
                "description": "Schedule a meeting with a customer",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "customer_id": {"type": "string"},
                        "date": {"type": "string"},
                        "duration_minutes": {"type": "integer"},
                        "topic": {"type": "string"},
                    },
                    "required": ["customer_id", "date", "topic"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_crm",
                "description": "Update customer record in CRM",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "customer_id": {"type": "string"},
                        "field": {"type": "string"},
                        "value": {"type": "string"},
                    },
                    "required": ["customer_id", "field", "value"],
                },
            },
        },
    ]

    assistant = client.beta.assistants.create(
        name="Customer Success Mega Agent",
        instructions="""You are a comprehensive customer success agent with access to:
        - Code interpreter for data analysis
        - File search for documentation
        - Database search for product info
        - Email for customer communication
        - Ticket system for issue tracking
        - Meeting scheduler for customer calls
        - CRM for customer record management

        Handle customer requests end-to-end using the appropriate tools.""",
        model="gpt-4o-mini",
        tools=tools,
    )

    tool_names = []
    for t in assistant.tools:
        if t.type == "function":
            tool_names.append(t.function.name)
        else:
            tool_names.append(t.type)

    print(f"Created mega-agent with {len(tools)} tools: {assistant.id}")
    print(f"Available tools: {', '.join(tool_names)}")
    print("\nGPT-4o can handle complex multi-tool workflows in a single agent!")
    print("This pattern simplifies architecture compared to multi-agent orchestration.")

    # Cleanup
    client.beta.assistants.delete(assistant.id)


# =============================================================================
# Agent with Code Interpreter Example
# =============================================================================

def code_interpreter_agent(client: OpenAI) -> None:
    """Demonstrate agent with code interpreter for data analysis.

    Args:
        client: OpenAI client instance
    """
    print("\n=== Code Interpreter Agent ===\n")

    assistant = client.beta.assistants.create(
        name="Data Analyst",
        instructions="You are a data analyst. Use code interpreter to analyze data and create visualizations.",
        model="gpt-4o-mini",
        tools=[{"type": "code_interpreter"}],
    )

    thread = client.beta.threads.create()

    client.beta.threads.messages.create(
        thread_id=thread.id,
        role="user",
        content="Calculate the first 10 Fibonacci numbers and show them in a list.",
    )
    print("User: Calculate the first 10 Fibonacci numbers and show them in a list.\n")

    # Run with polling
    run = client.beta.threads.runs.create_and_poll(
        thread_id=thread.id,
        assistant_id=assistant.id,
    )

    if run.status == "completed":
        messages = client.beta.threads.messages.list(thread_id=thread.id, limit=1)
        for msg in messages.data:
            for content in msg.content:
                if content.type == "text":
                    print(f"Assistant: {content.text.value}")
                    break

    # Cleanup
    client.beta.assistants.delete(assistant.id)


# =============================================================================
# Reusable Agent Manager Class
# =============================================================================

class AgentManager:
    """Reusable agent manager for production applications.

    This class provides a clean interface for managing assistants
    and threads with proper cleanup.
    """

    def __init__(self, model: str = "gpt-4o-mini"):
        """Initialize the agent manager.

        Args:
            model: The model to use for assistants
        """
        self.client = OpenAI()
        self.model = model
        self.assistants: Dict[str, Any] = {}
        self.threads: Dict[str, Any] = {}

    def create_assistant(
        self,
        name: str,
        instructions: str,
        tools: Optional[List[Dict]] = None
    ) -> str:
        """Create a new assistant.

        Args:
            name: Assistant name
            instructions: System instructions
            tools: List of tool configurations

        Returns:
            The assistant ID
        """
        assistant = self.client.beta.assistants.create(
            name=name,
            instructions=instructions,
            model=self.model,
            tools=tools or [],
        )
        self.assistants[assistant.id] = assistant
        return assistant.id

    def create_thread(self) -> str:
        """Create a new conversation thread.

        Returns:
            The thread ID
        """
        thread = self.client.beta.threads.create()
        self.threads[thread.id] = thread
        return thread.id

    def send_message(
        self,
        thread_id: str,
        assistant_id: str,
        content: str,
        stream: bool = False
    ) -> str:
        """Send a message and get a response.

        Args:
            thread_id: The thread to use
            assistant_id: The assistant to use
            content: Message content
            stream: Whether to stream the response

        Returns:
            The assistant's response
        """
        # Add user message
        self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=content,
        )

        if stream:
            response_text = ""
            with self.client.beta.threads.runs.stream(
                thread_id=thread_id,
                assistant_id=assistant_id,
            ) as run_stream:
                for text in run_stream.text_deltas:
                    response_text += text
            return response_text
        else:
            # Run and poll
            run = self.client.beta.threads.runs.create_and_poll(
                thread_id=thread_id,
                assistant_id=assistant_id,
            )

            if run.status == "completed":
                messages = self.client.beta.threads.messages.list(
                    thread_id=thread_id, limit=1
                )
                for msg in messages.data:
                    for content_block in msg.content:
                        if content_block.type == "text":
                            return content_block.text.value
            return ""

    def cleanup(self) -> None:
        """Delete all managed assistants."""
        for assistant_id in list(self.assistants.keys()):
            try:
                self.client.beta.assistants.delete(assistant_id)
                del self.assistants[assistant_id]
            except Exception as e:
                logger.warning(f"Failed to delete assistant {assistant_id}: {e}")

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit with cleanup."""
        self.cleanup()


def agent_manager_example(client: OpenAI) -> None:
    """Demonstrate the AgentManager class.

    Args:
        client: OpenAI client instance (unused, manager creates its own)
    """
    print("\n=== Agent Manager Pattern ===\n")

    with AgentManager() as manager:
        # Create assistant
        assistant_id = manager.create_assistant(
            name="Helper Bot",
            instructions="You are a helpful assistant. Be concise.",
        )
        print(f"Created assistant: {assistant_id}")

        # Create thread
        thread_id = manager.create_thread()
        print(f"Created thread: {thread_id}")

        # Send messages
        response = manager.send_message(
            thread_id=thread_id,
            assistant_id=assistant_id,
            content="What is 2 + 2?",
        )
        print(f"\nUser: What is 2 + 2?")
        print(f"Assistant: {response}")

        # Second message (context preserved)
        response = manager.send_message(
            thread_id=thread_id,
            assistant_id=assistant_id,
            content="Now multiply that by 3.",
        )
        print(f"\nUser: Now multiply that by 3.")
        print(f"Assistant: {response}")

    print("\nAssistants automatically cleaned up via context manager")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Agents (Assistants API) Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        print("Please set it with: export OPENAI_API_KEY=your-key")
        return

    client = OpenAI()

    try:
        # Basic agent
        assistant = create_basic_agent(client)

        # Thread management
        thread = create_thread_and_run(client, assistant.id)
        continue_conversation(client, thread.id, assistant.id)

        # Cleanup basic agent
        client.beta.assistants.delete(assistant.id)

        # Agent with custom tools
        run_agent_with_tools(client)

        # Streaming
        streaming_agent(client)

        # Code interpreter
        code_interpreter_agent(client)

        # File search (RAG)
        agent_with_file_search(client)

        # Mega agent pattern
        mega_agent_pattern(client)

        # Agent manager class
        agent_manager_example(client)

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All examples completed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
