#!/usr/bin/env python3
"""
OpenAI Responses API Template (Python)

The Responses API is OpenAI's next-generation API that supports:
- Chain-of-thought (CoT) passing between conversation turns
- Built-in tools (web_search, code_interpreter, file_search)
- Improved intelligence with fewer reasoning tokens
- Higher cache hit rates and lower latency

Placeholders:
- {{MODEL}} - Model name (e.g., gpt-4.1, o3)
- {{SYSTEM_PROMPT}} - System instructions
- {{MAX_OUTPUT_TOKENS}} - Maximum output tokens

Usage:
    python responses-api.py "Explain quantum computing"
"""

import os
import sys
import logging
from typing import Optional

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{MODEL}}"
SYSTEM_PROMPT = "{{SYSTEM_PROMPT}}"
MAX_OUTPUT_TOKENS = {{MAX_OUTPUT_TOKENS}}


def create_response(
    user_input: str,
    model: str = MODEL,
    instructions: str = SYSTEM_PROMPT,
    max_output_tokens: int = MAX_OUTPUT_TOKENS,
    reasoning_effort: str = "medium",
    previous_response_id: Optional[str] = None,
) -> dict:
    """
    Create a response using the Responses API.

    Args:
        user_input: The user's message
        model: Model to use
        instructions: System instructions
        max_output_tokens: Maximum tokens in response
        reasoning_effort: none, low, medium, high (model dependent)
        previous_response_id: ID of previous response for CoT continuation

    Returns:
        Response object with id, output, and usage
    """
    client = OpenAI()

    response = client.responses.create(
        model=model,
        input=user_input,
        instructions=instructions,
        max_output_tokens=max_output_tokens,
        reasoning={
            "effort": reasoning_effort,
        },
        # Pass previous response ID to continue chain-of-thought
        previous_response_id=previous_response_id,
    )

    return {
        "id": response.id,
        "output": response.output_text,
        "reasoning_tokens": getattr(response.usage, 'reasoning_tokens', 0),
        "total_tokens": response.usage.total_tokens,
    }


def create_response_with_tools(
    user_input: str,
    model: str = MODEL,
    tools: Optional[list[str]] = None,
) -> dict:
    """
    Create a response with built-in tools.

    Available built-in tools:
    - web_search: Search the web for current information
    - code_interpreter: Execute Python code
    - file_search: Search uploaded files
    """
    client = OpenAI()
    tools = tools or ["web_search"]

    response = client.responses.create(
        model=model,
        input=user_input,
        tools=[{"type": tool} for tool in tools],
    )

    return {
        "id": response.id,
        "output": response.output_text,
        "tool_calls": [
            {"type": tc.type, "result": getattr(tc, 'result', None)}
            for tc in response.tool_calls
        ] if response.tool_calls else [],
    }


def stream_response(
    user_input: str,
    model: str = MODEL,
    instructions: str = SYSTEM_PROMPT,
) -> str:
    """Stream a response with real-time output.

    Args:
        user_input: The user's message
        model: Model to use
        instructions: System instructions

    Returns:
        The complete response text
    """
    client = OpenAI()
    collected_content = []

    stream = client.responses.create(
        model=model,
        input=user_input,
        instructions=instructions,
        stream=True,
    )

    for event in stream:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
            collected_content.append(event.delta)
        elif event.type == "response.done":
            print()  # Newline at end

    return "".join(collected_content)


class ResponsesConversation:
    """Manage multi-turn conversation with CoT preservation.

    The key advantage of the Responses API is that by passing
    previous_response_id, the model retains its reasoning context
    across turns, leading to more coherent multi-step solutions.
    """

    def __init__(
        self,
        model: str = MODEL,
        instructions: str = SYSTEM_PROMPT,
        max_output_tokens: int = MAX_OUTPUT_TOKENS,
    ):
        """Initialize the conversation manager.

        Args:
            model: Model to use
            instructions: System instructions
            max_output_tokens: Maximum tokens per response
        """
        self.client = OpenAI()
        self.model = model
        self.instructions = instructions
        self.max_output_tokens = max_output_tokens
        self.last_response_id: Optional[str] = None

    def send(self, user_input: str) -> str:
        """Send a message and get response, preserving CoT context.

        Args:
            user_input: The user's message

        Returns:
            The assistant's response text
        """
        response = self.client.responses.create(
            model=self.model,
            input=user_input,
            instructions=self.instructions,
            max_output_tokens=self.max_output_tokens,
            previous_response_id=self.last_response_id,
        )

        self.last_response_id = response.id
        return response.output_text

    def reset(self) -> None:
        """Reset the conversation, clearing CoT context."""
        self.last_response_id = None

    def get_last_response_id(self) -> Optional[str]:
        """Get the ID of the last response for external use."""
        return self.last_response_id


class ResponsesWithToolsConversation:
    """Multi-turn conversation with built-in tools and CoT preservation."""

    def __init__(
        self,
        model: str = MODEL,
        instructions: str = SYSTEM_PROMPT,
        tools: Optional[list[str]] = None,
    ):
        """Initialize conversation with tools.

        Args:
            model: Model to use
            instructions: System instructions
            tools: List of built-in tools to enable
        """
        self.client = OpenAI()
        self.model = model
        self.instructions = instructions
        self.tools = [{"type": t} for t in (tools or ["web_search"])]
        self.last_response_id: Optional[str] = None

    def send(self, user_input: str) -> dict:
        """Send a message and get response with tool results.

        Args:
            user_input: The user's message

        Returns:
            Dict with output text and any tool calls made
        """
        response = self.client.responses.create(
            model=self.model,
            input=user_input,
            instructions=self.instructions,
            tools=self.tools,
            previous_response_id=self.last_response_id,
        )

        self.last_response_id = response.id

        return {
            "output": response.output_text,
            "tool_calls": [
                {"type": tc.type, "result": getattr(tc, 'result', None)}
                for tc in response.tool_calls
            ] if response.tool_calls else [],
        }

    def reset(self) -> None:
        """Reset the conversation, clearing CoT context."""
        self.last_response_id = None


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print("Usage: python responses-api.py <message>")
        print("\nExamples:")
        print("  python responses-api.py 'Explain quantum computing'")
        print("  python responses-api.py 'What is 15% of 250?'")
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    try:
        result = create_response(user_input)
        print(f"Response: {result['output']}")
        print(f"\nTokens used: {result['total_tokens']}")
        if result['reasoning_tokens']:
            print(f"Reasoning tokens: {result['reasoning_tokens']}")

    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
