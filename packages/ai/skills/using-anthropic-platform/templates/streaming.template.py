#!/usr/bin/env python3
"""
Anthropic Streaming Template

This template provides production-ready streaming implementations
for both synchronous and asynchronous use cases.

Placeholders:
- {{model}} - Model ID (e.g., "claude-sonnet-4-20250514")
- {{system_prompt}} - System message content

Usage:
    python streaming.py "Write a story about a robot."
"""

import sys
import logging
import asyncio
from typing import Generator, AsyncGenerator, Optional

from anthropic import Anthropic, AsyncAnthropic, APIError, RateLimitError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{model}}"
SYSTEM_PROMPT = "{{system_prompt}}"
MAX_TOKENS = 2048


class StreamingClient:
    """Anthropic client with synchronous streaming support."""

    def __init__(
        self,
        model: str = MODEL,
        system_prompt: str = SYSTEM_PROMPT,
        max_tokens: int = MAX_TOKENS
    ):
        self.client = Anthropic()
        self.model = model
        self.system_prompt = system_prompt
        self.max_tokens = max_tokens

    def stream_text(self, user_message: str) -> Generator[str, None, None]:
        """Stream response text chunks.

        Args:
            user_message: The user's message

        Yields:
            Text chunks as they arrive
        """
        try:
            logger.info(f"Starting stream to {self.model}")

            with self.client.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=self.system_prompt if self.system_prompt else None,
                messages=[{"role": "user", "content": user_message}]
            ) as stream:
                for text in stream.text_stream:
                    yield text

                # Get final message for usage stats
                final_message = stream.get_final_message()
                logger.info(
                    f"Stream complete - Input: {final_message.usage.input_tokens}, "
                    f"Output: {final_message.usage.output_tokens}"
                )

        except RateLimitError:
            logger.error("Rate limit exceeded")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise

    def stream_events(self, user_message: str) -> Generator[dict, None, None]:
        """Stream raw events for fine-grained control.

        Args:
            user_message: The user's message

        Yields:
            Event dictionaries with type and data
        """
        try:
            with self.client.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=self.system_prompt if self.system_prompt else None,
                messages=[{"role": "user", "content": user_message}]
            ) as stream:
                for event in stream:
                    yield {
                        "type": event.type,
                        "data": event
                    }

        except APIError as e:
            logger.error(f"API error: {e}")
            raise


class AsyncStreamingClient:
    """Anthropic client with asynchronous streaming support."""

    def __init__(
        self,
        model: str = MODEL,
        system_prompt: str = SYSTEM_PROMPT,
        max_tokens: int = MAX_TOKENS
    ):
        self.client = AsyncAnthropic()
        self.model = model
        self.system_prompt = system_prompt
        self.max_tokens = max_tokens

    async def stream_text(self, user_message: str) -> AsyncGenerator[str, None]:
        """Stream response text chunks asynchronously.

        Args:
            user_message: The user's message

        Yields:
            Text chunks as they arrive
        """
        try:
            logger.info(f"Starting async stream to {self.model}")

            async with self.client.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=self.system_prompt if self.system_prompt else None,
                messages=[{"role": "user", "content": user_message}]
            ) as stream:
                async for text in stream.text_stream:
                    yield text

                # Get final message for usage stats
                final_message = await stream.get_final_message()
                logger.info(
                    f"Stream complete - Input: {final_message.usage.input_tokens}, "
                    f"Output: {final_message.usage.output_tokens}"
                )

        except RateLimitError:
            logger.error("Rate limit exceeded")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise

    async def stream_events(self, user_message: str) -> AsyncGenerator[dict, None]:
        """Stream raw events asynchronously for fine-grained control.

        Args:
            user_message: The user's message

        Yields:
            Event dictionaries with type and data
        """
        try:
            async with self.client.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=self.system_prompt if self.system_prompt else None,
                messages=[{"role": "user", "content": user_message}]
            ) as stream:
                async for event in stream:
                    yield {
                        "type": event.type,
                        "data": event
                    }

        except APIError as e:
            logger.error(f"API error: {e}")
            raise


def stream_sync(message: str) -> str:
    """Synchronous streaming example."""
    client = StreamingClient()
    collected = []

    print("Response: ", end="", flush=True)
    for chunk in client.stream_text(message):
        print(chunk, end="", flush=True)
        collected.append(chunk)

    print()  # New line after streaming
    return "".join(collected)


async def stream_async(message: str) -> str:
    """Asynchronous streaming example."""
    client = AsyncStreamingClient()
    collected = []

    print("Response: ", end="", flush=True)
    async for chunk in client.stream_text(message):
        print(chunk, end="", flush=True)
        collected.append(chunk)

    print()  # New line after streaming
    return "".join(collected)


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print("Usage: python streaming.py <message>")
        print("\nExamples:")
        print('  python streaming.py "Write a haiku about coding"')
        print('  python streaming.py "Explain Python generators"')
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    try:
        # Use synchronous streaming for CLI
        stream_sync(user_input)

        # For async, you would use:
        # asyncio.run(stream_async(user_input))

    except RateLimitError:
        print("\nError: Rate limit exceeded. Please try again later.")
        sys.exit(1)

    except APIError as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
