#!/usr/bin/env python3
"""
Anthropic Extended Thinking Template

This template provides production-ready implementations for using
Claude's extended thinking capability for complex reasoning tasks.

Placeholders:
- {{model}} - Model ID (must support thinking, e.g., "claude-sonnet-4-20250514")
- {{budget_tokens}} - Maximum tokens for thinking (e.g., 10000)

Usage:
    python extended-thinking.py "Solve this complex problem..."

Note: Extended thinking is only available on Claude Sonnet 4 and Claude Opus 4.5.
"""

import sys
import logging
from typing import Optional, Tuple
from dataclasses import dataclass

from anthropic import Anthropic, APIError, RateLimitError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{model}}"
BUDGET_TOKENS = {{budget_tokens}}
MAX_TOKENS = 16000  # Must be higher to accommodate thinking + response


@dataclass
class ThinkingResponse:
    """Container for extended thinking response."""
    thinking: Optional[str]
    response: str
    input_tokens: int
    output_tokens: int
    thinking_tokens: int


class ExtendedThinkingClient:
    """Anthropic client with extended thinking support."""

    def __init__(
        self,
        model: str = MODEL,
        budget_tokens: int = BUDGET_TOKENS,
        max_tokens: int = MAX_TOKENS
    ):
        """Initialize the extended thinking client.

        Args:
            model: Anthropic model ID (must support thinking)
            budget_tokens: Maximum tokens for thinking process
            max_tokens: Maximum total output tokens
        """
        self.client = Anthropic()
        self.model = model
        self.budget_tokens = budget_tokens
        self.max_tokens = max_tokens

    def think(
        self,
        prompt: str,
        system: Optional[str] = None,
        show_thinking: bool = True
    ) -> ThinkingResponse:
        """Send a message with extended thinking enabled.

        Args:
            prompt: The user's message/problem to solve
            system: Optional system prompt
            show_thinking: Whether to include thinking in response

        Returns:
            ThinkingResponse with thinking process and final answer
        """
        try:
            logger.info(f"Starting extended thinking with {self.budget_tokens} budget tokens")

            kwargs = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "thinking": {
                    "type": "enabled",
                    "budget_tokens": self.budget_tokens
                },
                "messages": [{"role": "user", "content": prompt}]
            }

            if system:
                kwargs["system"] = system

            response = self.client.messages.create(**kwargs)

            # Extract thinking and text blocks
            thinking_content = None
            response_content = ""

            for block in response.content:
                if block.type == "thinking":
                    thinking_content = block.thinking
                elif block.type == "text":
                    response_content = block.text

            # Calculate thinking tokens (approximate from output)
            thinking_tokens = 0
            if thinking_content:
                # Rough estimate: 4 chars per token
                thinking_tokens = len(thinking_content) // 4

            logger.info(
                f"Complete - Input: {response.usage.input_tokens}, "
                f"Output: {response.usage.output_tokens}"
            )

            return ThinkingResponse(
                thinking=thinking_content if show_thinking else None,
                response=response_content,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                thinking_tokens=thinking_tokens
            )

        except RateLimitError:
            logger.error("Rate limit exceeded")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise

    def think_stream(
        self,
        prompt: str,
        system: Optional[str] = None,
        stream_thinking: bool = True,
        stream_response: bool = True
    ) -> ThinkingResponse:
        """Stream extended thinking response.

        Args:
            prompt: The user's message/problem to solve
            system: Optional system prompt
            stream_thinking: Whether to print thinking as it arrives
            stream_response: Whether to print response as it arrives

        Returns:
            ThinkingResponse with complete thinking and response
        """
        try:
            logger.info(f"Starting streamed extended thinking")

            kwargs = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "thinking": {
                    "type": "enabled",
                    "budget_tokens": self.budget_tokens
                },
                "messages": [{"role": "user", "content": prompt}]
            }

            if system:
                kwargs["system"] = system

            thinking_parts = []
            response_parts = []
            current_block_type = None

            with self.client.messages.stream(**kwargs) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        current_block_type = block.type

                        if block.type == "thinking" and stream_thinking:
                            print("\n=== Thinking ===\n", flush=True)
                        elif block.type == "text" and stream_response:
                            print("\n=== Response ===\n", flush=True)

                    elif event.type == "content_block_delta":
                        if hasattr(event.delta, "thinking"):
                            thinking_parts.append(event.delta.thinking)
                            if stream_thinking:
                                print(event.delta.thinking, end="", flush=True)
                        elif hasattr(event.delta, "text"):
                            response_parts.append(event.delta.text)
                            if stream_response:
                                print(event.delta.text, end="", flush=True)

                    elif event.type == "content_block_stop":
                        if current_block_type and (stream_thinking or stream_response):
                            print()  # New line after block

                # Get final message
                final_message = stream.get_final_message()

            thinking_content = "".join(thinking_parts) if thinking_parts else None
            response_content = "".join(response_parts)
            thinking_tokens = len(thinking_content) // 4 if thinking_content else 0

            return ThinkingResponse(
                thinking=thinking_content,
                response=response_content,
                input_tokens=final_message.usage.input_tokens,
                output_tokens=final_message.usage.output_tokens,
                thinking_tokens=thinking_tokens
            )

        except RateLimitError:
            logger.error("Rate limit exceeded")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise


def get_budget_for_complexity(task: str) -> int:
    """Suggest budget tokens based on task complexity.

    This is a simple heuristic - adjust based on your needs.
    """
    task_lower = task.lower()

    # High complexity indicators
    high_complexity = ["prove", "derive", "analyze", "optimize", "design", "architect"]
    if any(word in task_lower for word in high_complexity):
        return 20000

    # Medium complexity indicators
    medium_complexity = ["explain", "compare", "evaluate", "implement", "solve"]
    if any(word in task_lower for word in medium_complexity):
        return 10000

    # Default for simpler tasks
    return 5000


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print("Usage: python extended-thinking.py <prompt>")
        print("\nExtended thinking is best for:")
        print("  - Complex reasoning problems")
        print("  - Multi-step calculations")
        print("  - Code architecture decisions")
        print("  - Proof and derivation tasks")
        print("\nExamples:")
        print('  python extended-thinking.py "Solve: If 5 people can paint 3 houses in 2 days, how many days for 3 people to paint 5 houses?"')
        print('  python extended-thinking.py "Design a caching strategy for a high-traffic API"')
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    # Auto-adjust budget based on task
    budget = get_budget_for_complexity(user_input)
    logger.info(f"Using budget of {budget} tokens based on task complexity")

    try:
        client = ExtendedThinkingClient(budget_tokens=budget)

        # Use streaming for better UX
        result = client.think_stream(
            prompt=user_input,
            stream_thinking=True,
            stream_response=True
        )

        print(f"\n\n--- Stats ---")
        print(f"Input tokens: {result.input_tokens}")
        print(f"Output tokens: {result.output_tokens}")
        print(f"Estimated thinking tokens: {result.thinking_tokens}")

    except RateLimitError:
        print("\nError: Rate limit exceeded. Please try again later.")
        sys.exit(1)

    except APIError as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
