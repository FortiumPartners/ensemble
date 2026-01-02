#!/usr/bin/env python3
"""
Streaming Responses Example

This example demonstrates OpenAI's streaming capabilities:
- Real-time token-by-token output
- Synchronous streaming
- Asynchronous streaming
- Progress indication
- Stream completion handling

Usage:
    python streaming.example.py
    python streaming.example.py --async
"""

import os
import sys
import asyncio
import logging
from typing import Generator, AsyncGenerator

from openai import OpenAI, AsyncOpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Synchronous Streaming
# =============================================================================

def stream_simple():
    """Simple streaming example with direct output."""
    print("\n=== Simple Streaming ===\n")

    client = OpenAI()

    print("Generating story (streaming):\n")
    print("-" * 40)

    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Write a haiku about programming."}
        ],
        stream=True
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)

    print("\n" + "-" * 40)


def stream_with_collection() -> str:
    """Streaming with content collection."""
    print("\n=== Streaming with Collection ===\n")

    client = OpenAI()

    print("Generating response:\n")

    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "List 3 benefits of code review."}
        ],
        stream=True
    )

    collected_content = []
    for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected_content.append(content)
            print(content, end="", flush=True)

    full_response = "".join(collected_content)

    print(f"\n\nTotal characters: {len(full_response)}")
    return full_response


def stream_generator() -> Generator[str, None, None]:
    """Return a generator for streaming responses."""
    client = OpenAI()

    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Explain recursion in one sentence."}
        ],
        stream=True
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def stream_with_progress():
    """Streaming with progress indication."""
    print("\n=== Streaming with Progress ===\n")

    client = OpenAI()

    print("Generating long response:\n")

    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": "Write a short paragraph about the history of computing."
            }
        ],
        stream=True,
        max_tokens=200
    )

    token_count = 0
    for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            print(content, end="", flush=True)
            token_count += 1

    print(f"\n\nApproximate tokens streamed: {token_count}")


def stream_multiple_messages():
    """Demonstrate streaming in a conversation."""
    print("\n=== Streaming in Conversation ===\n")

    client = OpenAI()
    messages = [
        {"role": "system", "content": "You are a helpful assistant."}
    ]

    queries = [
        "What is Python?",
        "What's its main use?",
    ]

    for query in queries:
        print(f"User: {query}")
        print("Assistant: ", end="")

        messages.append({"role": "user", "content": query})

        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            stream=True,
            max_tokens=100
        )

        assistant_response = []
        for chunk in stream:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                assistant_response.append(content)
                print(content, end="", flush=True)

        full_response = "".join(assistant_response)
        messages.append({"role": "assistant", "content": full_response})
        print("\n")


# =============================================================================
# Asynchronous Streaming
# =============================================================================

async def async_stream_simple():
    """Async streaming example."""
    print("\n=== Async Streaming ===\n")

    client = AsyncOpenAI()

    print("Generating async response:\n")

    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Write a limerick about Python."}
        ],
        stream=True
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)

    print("\n")


async def async_stream_generator() -> AsyncGenerator[str, None]:
    """Return an async generator for streaming responses."""
    client = AsyncOpenAI()

    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Define AI in one sentence."}
        ],
        stream=True
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def async_concurrent_streams():
    """Demonstrate concurrent async streams."""
    print("\n=== Concurrent Async Streams ===\n")

    client = AsyncOpenAI()

    prompts = [
        "Define machine learning in one sentence.",
        "Define deep learning in one sentence.",
        "Define neural network in one sentence.",
    ]

    async def stream_response(prompt: str, index: int):
        """Stream a single response."""
        stream = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        content = []
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                content.append(chunk.choices[0].delta.content)

        return index, prompt, "".join(content)

    # Run all streams concurrently
    tasks = [stream_response(p, i) for i, p in enumerate(prompts)]
    results = await asyncio.gather(*tasks)

    # Print results
    for index, prompt, response in sorted(results):
        print(f"{index + 1}. {prompt}")
        print(f"   {response}\n")


async def async_stream_with_timeout():
    """Async streaming with timeout handling."""
    print("\n=== Async Streaming with Timeout ===\n")

    client = AsyncOpenAI()

    try:
        stream = await asyncio.wait_for(
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": "Write a short joke."}
                ],
                stream=True
            ),
            timeout=10.0
        )

        async for chunk in stream:
            if chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="", flush=True)

        print("\n")

    except asyncio.TimeoutError:
        print("Request timed out!")


# =============================================================================
# Main
# =============================================================================

def main_sync():
    """Run synchronous examples."""
    print("=" * 60)
    print("OpenAI Streaming Examples (Synchronous)")
    print("=" * 60)

    stream_simple()
    stream_with_collection()
    stream_with_progress()
    stream_multiple_messages()

    # Use generator
    print("\n=== Using Generator ===\n")
    print("Response: ", end="")
    for chunk in stream_generator():
        print(chunk, end="", flush=True)
    print("\n")


async def main_async():
    """Run asynchronous examples."""
    print("=" * 60)
    print("OpenAI Streaming Examples (Asynchronous)")
    print("=" * 60)

    await async_stream_simple()
    await async_stream_with_timeout()
    await async_concurrent_streams()

    # Use async generator
    print("=== Using Async Generator ===\n")
    print("Response: ", end="")
    async for chunk in async_stream_generator():
        print(chunk, end="", flush=True)
    print("\n")


def main():
    """Main entry point."""
    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set.")
        return

    if "--async" in sys.argv:
        asyncio.run(main_async())
    else:
        main_sync()

    print("=" * 60)
    print("All streaming examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
