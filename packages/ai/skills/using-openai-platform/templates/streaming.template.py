#!/usr/bin/env python3
"""
OpenAI Streaming Template

This template provides synchronous and asynchronous streaming implementations
for real-time response handling.

Placeholders:
- {{model}} - Model ID (e.g., "gpt-5")
- {{system_prompt}} - System message content

Usage:
    python streaming.py "Tell me a story"
"""

import asyncio
import sys
import logging
from typing import Generator, AsyncGenerator, List, Dict

from openai import OpenAI, AsyncOpenAI, APIError, RateLimitError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{model}}"
SYSTEM_PROMPT = "{{system_prompt}}"


class SyncStreamingClient:
    """Synchronous streaming client for OpenAI."""

    def __init__(self, model: str = MODEL, system_prompt: str = SYSTEM_PROMPT):
        self.client = OpenAI()
        self.model = model
        self.system_prompt = system_prompt

    def stream(self, user_message: str) -> Generator[str, None, str]:
        """Stream a response token by token.

        Args:
            user_message: The user's message

        Yields:
            Individual content chunks

        Returns:
            The complete response
        """
        messages: List[Dict[str, str]] = []

        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})

        messages.append({"role": "user", "content": user_message})

        try:
            logger.info(f"Starting stream from {self.model}")

            stream = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True
            )

            collected_content = []

            for chunk in stream:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    collected_content.append(content)
                    yield content

            return "".join(collected_content)

        except RateLimitError:
            logger.error("Rate limit exceeded")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise

    def stream_to_stdout(self, user_message: str) -> str:
        """Stream response directly to stdout.

        Args:
            user_message: The user's message

        Returns:
            The complete response
        """
        full_response = ""

        for chunk in self.stream(user_message):
            print(chunk, end="", flush=True)
            full_response += chunk

        print()  # Newline at end
        return full_response


class AsyncStreamingClient:
    """Asynchronous streaming client for OpenAI."""

    def __init__(self, model: str = MODEL, system_prompt: str = SYSTEM_PROMPT):
        self.client = AsyncOpenAI()
        self.model = model
        self.system_prompt = system_prompt

    async def stream(self, user_message: str) -> AsyncGenerator[str, None]:
        """Stream a response asynchronously.

        Args:
            user_message: The user's message

        Yields:
            Individual content chunks
        """
        messages: List[Dict[str, str]] = []

        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})

        messages.append({"role": "user", "content": user_message})

        try:
            logger.info(f"Starting async stream from {self.model}")

            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True
            )

            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except RateLimitError:
            logger.error("Rate limit exceeded")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise

    async def stream_to_stdout(self, user_message: str) -> str:
        """Stream response directly to stdout asynchronously.

        Args:
            user_message: The user's message

        Returns:
            The complete response
        """
        full_response = ""

        async for chunk in self.stream(user_message):
            print(chunk, end="", flush=True)
            full_response += chunk

        print()  # Newline at end
        return full_response

    async def collect(self, user_message: str) -> str:
        """Collect streaming response into a single string.

        Args:
            user_message: The user's message

        Returns:
            The complete response
        """
        chunks = []
        async for chunk in self.stream(user_message):
            chunks.append(chunk)
        return "".join(chunks)


def main_sync():
    """Synchronous main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python streaming.py <message>")
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    try:
        client = SyncStreamingClient()
        client.stream_to_stdout(user_input)

    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


async def main_async():
    """Asynchronous main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python streaming.py <message>")
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    try:
        client = AsyncStreamingClient()
        await client.stream_to_stdout(user_input)

    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    # Use sync by default, async with --async flag
    if "--async" in sys.argv:
        sys.argv.remove("--async")
        asyncio.run(main_async())
    else:
        main_sync()
