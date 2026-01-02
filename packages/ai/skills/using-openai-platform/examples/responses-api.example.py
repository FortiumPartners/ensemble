#!/usr/bin/env python3
"""
OpenAI Responses API Example

Demonstrates the Responses API which offers:
- Chain-of-thought (CoT) passing between turns for improved context
- Built-in tools (web_search, code_interpreter, file_search)
- Streaming support
- Better cache hit rates than Chat Completions
- Simplified input/output interface

Prerequisites:
    pip install openai>=2.0.0
    export OPENAI_API_KEY=your-key

Usage:
    python responses-api.example.py
"""

import os
import logging
from typing import Optional

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Basic Responses API Usage
# =============================================================================

def basic_response():
    """Basic Responses API usage."""
    print("\n=== Basic Response ===\n")

    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1",
        input="What are the key differences between Python and JavaScript?",
    )

    print(f"Response ID: {response.id}")
    print(f"Output: {response.output_text}")
    print(f"Total tokens: {response.usage.total_tokens}")


def response_with_instructions():
    """Response with system instructions."""
    print("\n=== Response with Instructions ===\n")

    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1",
        input="Explain recursion",
        instructions="You are a patient teacher who explains concepts using simple analogies. "
                    "Always include a real-world example.",
    )

    print(f"Output: {response.output_text}")


# =============================================================================
# Reasoning Configuration
# =============================================================================

def response_with_reasoning():
    """Response with configurable reasoning effort."""
    print("\n=== Response with Reasoning ===\n")

    client = OpenAI()

    # Use high reasoning for complex problems
    response = client.responses.create(
        model="gpt-4.1",
        input="Solve this step by step: If a train travels 120 miles in 2 hours, "
              "then stops for 30 minutes, then travels 90 miles in 1.5 hours, "
              "what is its average speed for the entire journey?",
        reasoning={"effort": "high"},
    )

    print(f"Output: {response.output_text}")
    if hasattr(response.usage, 'reasoning_tokens'):
        print(f"Reasoning tokens used: {response.usage.reasoning_tokens}")


def compare_reasoning_levels():
    """Compare different reasoning effort levels."""
    print("\n=== Comparing Reasoning Levels ===\n")

    client = OpenAI()
    question = "What is the sum of all prime numbers less than 20?"

    for effort in ["low", "medium", "high"]:
        response = client.responses.create(
            model="gpt-4.1",
            input=question,
            reasoning={"effort": effort},
        )
        reasoning_tokens = getattr(response.usage, 'reasoning_tokens', 'N/A')
        print(f"Effort '{effort}': {response.output_text[:100]}...")
        print(f"  Reasoning tokens: {reasoning_tokens}")
        print()


# =============================================================================
# Built-in Tools
# =============================================================================

def response_with_web_search():
    """Response using built-in web search tool."""
    print("\n=== Response with Web Search ===\n")

    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1",
        input="What are the latest developments in AI regulation in 2025?",
        tools=[{"type": "web_search"}],
    )

    print(f"Output: {response.output_text}")

    if response.tool_calls:
        print("\nTool calls made:")
        for tc in response.tool_calls:
            print(f"  - {tc.type}")


def response_with_code_interpreter():
    """Response using built-in code interpreter."""
    print("\n=== Response with Code Interpreter ===\n")

    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1",
        input="Calculate the compound interest on $10,000 at 5% annual rate "
              "for 10 years, compounded monthly. Show me the calculation.",
        tools=[{"type": "code_interpreter"}],
    )

    print(f"Output: {response.output_text}")


def response_with_multiple_tools():
    """Response using multiple built-in tools."""
    print("\n=== Response with Multiple Tools ===\n")

    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1",
        input="Search for the current population of Tokyo, then calculate "
              "what percentage it is of Japan's total population.",
        tools=[
            {"type": "web_search"},
            {"type": "code_interpreter"},
        ],
    )

    print(f"Output: {response.output_text}")

    if response.tool_calls:
        print("\nTools used:")
        for tc in response.tool_calls:
            print(f"  - {tc.type}")


# =============================================================================
# Multi-turn with Chain-of-Thought Preservation
# =============================================================================

def multi_turn_with_cot():
    """
    Multi-turn conversation preserving chain-of-thought.

    This is the KEY advantage of Responses API over Chat Completions:
    By passing previous_response_id, the model retains its reasoning
    context across turns, leading to more coherent multi-step solutions.
    """
    print("\n=== Multi-turn with Chain-of-Thought ===\n")

    client = OpenAI()

    # First turn
    response1 = client.responses.create(
        model="gpt-4.1",
        input="I'm planning a 2-week trip to Japan. What should I consider?",
        instructions="You are an expert travel planner.",
    )

    print(f"Turn 1: {response1.output_text[:200]}...")

    # Second turn - passes previous response ID to maintain reasoning context
    response2 = client.responses.create(
        model="gpt-4.1",
        input="Focus on Tokyo and Kyoto. What's the best way to split my time?",
        instructions="You are an expert travel planner.",
        previous_response_id=response1.id,  # Key: preserves CoT
    )

    print(f"\nTurn 2: {response2.output_text[:200]}...")

    # Third turn - continues the reasoning chain
    response3 = client.responses.create(
        model="gpt-4.1",
        input="What about day trips from each city?",
        previous_response_id=response2.id,
    )

    print(f"\nTurn 3: {response3.output_text[:200]}...")


def cot_for_problem_solving():
    """Use CoT preservation for multi-step problem solving."""
    print("\n=== CoT for Problem Solving ===\n")

    client = OpenAI()

    # Step 1: Understand the problem
    r1 = client.responses.create(
        model="gpt-4.1",
        input="I need to design a database schema for a library system. "
              "What entities and relationships should I consider?",
        reasoning={"effort": "high"},
    )
    print(f"Step 1 - Entity Analysis: {r1.output_text[:150]}...")

    # Step 2: Build on the analysis
    r2 = client.responses.create(
        model="gpt-4.1",
        input="Now create the SQL schema for the most important 3 tables.",
        previous_response_id=r1.id,
    )
    print(f"\nStep 2 - Schema Design: {r2.output_text[:150]}...")

    # Step 3: Add constraints
    r3 = client.responses.create(
        model="gpt-4.1",
        input="Add appropriate indexes and constraints for performance.",
        previous_response_id=r2.id,
    )
    print(f"\nStep 3 - Optimization: {r3.output_text[:150]}...")


# =============================================================================
# Streaming
# =============================================================================

def streaming_response():
    """Stream response output in real-time."""
    print("\n=== Streaming Response ===\n")

    client = OpenAI()

    print("Response: ", end="")

    stream = client.responses.create(
        model="gpt-4.1",
        input="Write a haiku about programming.",
        stream=True,
    )

    total_tokens = 0
    for event in stream:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
        elif event.type == "response.done":
            total_tokens = event.response.usage.total_tokens

    print(f"\n[Done - {total_tokens} tokens]")


def streaming_with_cot():
    """Stream responses while preserving chain-of-thought."""
    print("\n=== Streaming with CoT ===\n")

    client = OpenAI()

    # First response
    print("Turn 1: ", end="")
    response1_id = None

    stream1 = client.responses.create(
        model="gpt-4.1",
        input="What is machine learning?",
        stream=True,
    )

    for event in stream1:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
        elif event.type == "response.done":
            response1_id = event.response.id

    print("\n")

    # Second response with CoT
    print("Turn 2: ", end="")

    stream2 = client.responses.create(
        model="gpt-4.1",
        input="Give me a simple example.",
        previous_response_id=response1_id,
        stream=True,
    )

    for event in stream2:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
        elif event.type == "response.done":
            print()


# =============================================================================
# Conversation Manager Class
# =============================================================================

class ResponsesConversation:
    """Manage multi-turn conversation with CoT preservation."""

    def __init__(
        self,
        model: str = "gpt-4.1",
        instructions: str = "",
        tools: Optional[list] = None,
    ):
        self.client = OpenAI()
        self.model = model
        self.instructions = instructions
        self.tools = tools
        self.last_response_id: Optional[str] = None

    def send(self, user_input: str) -> str:
        """Send a message and get response, preserving CoT context."""
        kwargs = {
            "model": self.model,
            "input": user_input,
            "previous_response_id": self.last_response_id,
        }

        if self.instructions:
            kwargs["instructions"] = self.instructions

        if self.tools:
            kwargs["tools"] = self.tools

        response = self.client.responses.create(**kwargs)
        self.last_response_id = response.id
        return response.output_text

    def reset(self):
        """Reset conversation, clearing CoT context."""
        self.last_response_id = None


def conversation_manager_example():
    """Demonstrate the conversation manager pattern."""
    print("\n=== Conversation Manager Example ===\n")

    conv = ResponsesConversation(
        instructions="You are a helpful math tutor. Be encouraging."
    )

    questions = [
        "What is calculus?",
        "Can you give me a simple example?",
        "How is it used in real life?",
    ]

    for i, q in enumerate(questions, 1):
        print(f"User: {q}")
        response = conv.send(q)
        print(f"Assistant: {response[:150]}...")
        print()


# =============================================================================
# Comparison with Chat Completions
# =============================================================================

def compare_with_chat_completions():
    """
    Demonstrate why you might choose Responses API over Chat Completions.

    Key differences:
    1. CoT passing: Responses API passes reasoning between turns
    2. Built-in tools: web_search, code_interpreter, file_search
    3. Simpler API: input/output instead of messages array
    4. Better caching: Higher cache hit rates with previous_response_id
    """
    print("\n=== Responses API vs Chat Completions ===\n")
    print("""
    Use Responses API when:
    - You need multi-turn reasoning continuity (CoT passing)
    - You want built-in tools (web_search, code_interpreter)
    - You're building agentic applications
    - You want better latency via response caching
    - You prefer simpler input/output interface

    Use Chat Completions when:
    - You need fine-grained message control (roles, metadata)
    - You're using custom function/tool definitions
    - You need vision capabilities with images
    - You're migrating existing code gradually
    - You need features not yet in Responses API

    API Comparison:

    Chat Completions:
        messages=[
            {"role": "system", "content": "..."},
            {"role": "user", "content": "..."},
            {"role": "assistant", "content": "..."},
        ]

    Responses API:
        input="user message"
        instructions="system prompt"
        previous_response_id="resp_xxx"  # Preserves CoT
    """)


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Responses API Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        print("Set it with: export OPENAI_API_KEY='your-key'")
        return

    try:
        # Basic usage
        basic_response()
        response_with_instructions()

        # Reasoning
        response_with_reasoning()
        # compare_reasoning_levels()  # Uncomment to run (uses more tokens)

        # Built-in tools
        response_with_web_search()
        response_with_code_interpreter()
        # response_with_multiple_tools()  # Uncomment to run

        # Multi-turn with CoT
        multi_turn_with_cot()
        cot_for_problem_solving()

        # Streaming
        streaming_response()
        streaming_with_cot()

        # Conversation manager
        conversation_manager_example()

        # Comparison info
        compare_with_chat_completions()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All examples completed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
