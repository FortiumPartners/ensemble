#!/usr/bin/env python3
"""
Anthropic Streaming Example

This example demonstrates various streaming patterns with the Anthropic Claude API,
including text streaming, event-based streaming, and async streaming.

Usage:
    python streaming.example.py "Write a poem about programming"

Requirements:
    pip install anthropic
    export ANTHROPIC_API_KEY="sk-ant-..."
"""

import sys
import asyncio
import logging
from typing import Generator, AsyncGenerator

from anthropic import Anthropic, AsyncAnthropic, APIError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def simple_stream(prompt: str) -> str:
    """Simple text streaming using the text_stream helper."""
    print("\n=== Simple Text Stream ===\n")

    client = Anthropic()
    collected = []

    with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
            collected.append(text)

        # Get usage info after streaming
        final = stream.get_final_message()
        print(f"\n\nTokens - Input: {final.usage.input_tokens}, Output: {final.usage.output_tokens}")

    return "".join(collected)


def event_stream(prompt: str) -> str:
    """Event-based streaming for fine-grained control."""
    print("\n=== Event-Based Stream ===\n")

    client = Anthropic()
    collected = []

    with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for event in stream:
            if event.type == "message_start":
                print(f"[Message started: {event.message.id}]")

            elif event.type == "content_block_start":
                print(f"[Content block: {event.content_block.type}]")

            elif event.type == "content_block_delta":
                if hasattr(event.delta, "text"):
                    text = event.delta.text
                    print(text, end="", flush=True)
                    collected.append(text)

            elif event.type == "content_block_stop":
                print("\n[Block complete]")

            elif event.type == "message_delta":
                print(f"[Stop reason: {event.delta.stop_reason}]")

            elif event.type == "message_stop":
                print("[Stream complete]")

        final = stream.get_final_message()
        print(f"\nTokens - Input: {final.usage.input_tokens}, Output: {final.usage.output_tokens}")

    return "".join(collected)


async def async_stream(prompt: str) -> str:
    """Asynchronous streaming for concurrent operations."""
    print("\n=== Async Stream ===\n")

    client = AsyncAnthropic()
    collected = []

    async with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        async for text in stream.text_stream:
            print(text, end="", flush=True)
            collected.append(text)

        final = await stream.get_final_message()
        print(f"\n\nTokens - Input: {final.usage.input_tokens}, Output: {final.usage.output_tokens}")

    return "".join(collected)


def stream_generator(prompt: str) -> Generator[str, None, None]:
    """Generator-based streaming for integration with other systems."""
    client = Anthropic()

    with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for text in stream.text_stream:
            yield text


async def async_stream_generator(prompt: str) -> AsyncGenerator[str, None]:
    """Async generator for async integrations."""
    client = AsyncAnthropic()

    async with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        async for text in stream.text_stream:
            yield text


def generator_example(prompt: str):
    """Demonstrate using the generator."""
    print("\n=== Generator Stream ===\n")

    word_count = 0
    char_count = 0

    for chunk in stream_generator(prompt):
        print(chunk, end="", flush=True)
        char_count += len(chunk)
        word_count += chunk.count(" ")

    print(f"\n\nStats: ~{word_count} words, {char_count} characters")


async def concurrent_streams():
    """Demonstrate multiple concurrent streams."""
    print("\n=== Concurrent Streams ===\n")

    prompts = [
        "Write a haiku about the ocean",
        "Write a haiku about the mountains",
        "Write a haiku about the forest"
    ]

    async def stream_one(prompt: str, index: int) -> str:
        """Stream a single prompt and collect result."""
        client = AsyncAnthropic()
        collected = []

        async with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}]
        ) as stream:
            async for text in stream.text_stream:
                collected.append(text)

        return f"[{index}] {prompt}:\n{''.join(collected)}"

    # Run all streams concurrently
    tasks = [stream_one(p, i) for i, p in enumerate(prompts)]
    results = await asyncio.gather(*tasks)

    for result in results:
        print(result)
        print()


def streaming_with_system_prompt(prompt: str):
    """Streaming with a system prompt."""
    print("\n=== Stream with System Prompt ===\n")

    client = Anthropic()

    with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="You are a pirate. Always respond in pirate speak.",
        messages=[{"role": "user", "content": prompt}]
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)

    print()


def run_all_examples(prompt: str):
    """Run all streaming examples."""
    print("=" * 60)
    print("Anthropic Streaming Examples")
    print("=" * 60)

    # Simple text stream
    simple_stream(prompt)

    # Generator-based stream
    generator_example(prompt)

    # Streaming with system prompt
    streaming_with_system_prompt("Tell me about treasure")

    # Event-based stream (more verbose)
    print("\n[Skipping event stream for brevity - run with --events to see]")

    # Async examples
    print("\n=== Running async examples ===")
    asyncio.run(async_stream(prompt))
    asyncio.run(concurrent_streams())

    print("\n" + "=" * 60)
    print("All streaming examples complete!")
    print("=" * 60)


def main():
    """Main entry point."""
    if len(sys.argv) > 1:
        if sys.argv[1] == "--events":
            # Run event-based example
            prompt = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "Tell me a short joke"
            event_stream(prompt)
        elif sys.argv[1] == "--async":
            # Run async example
            prompt = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "Tell me a short joke"
            asyncio.run(async_stream(prompt))
        elif sys.argv[1] == "--concurrent":
            # Run concurrent example
            asyncio.run(concurrent_streams())
        else:
            # Simple stream with provided prompt
            prompt = " ".join(sys.argv[1:])
            simple_stream(prompt)
    else:
        # Run all examples with default prompt
        print("Usage: python streaming.example.py [prompt]")
        print("       python streaming.example.py --events [prompt]")
        print("       python streaming.example.py --async [prompt]")
        print("       python streaming.example.py --concurrent")
        print("\nRunning all examples with default prompt...\n")

        try:
            run_all_examples("Write a short poem about coding")
        except APIError as e:
            print(f"\nAPI Error: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
