#!/usr/bin/env python3
"""
Perplexity Sonar Streaming Example

Demonstrates real-time streaming responses with Perplexity's Sonar API.

Requirements:
    pip install openai

Environment:
    export PERPLEXITY_API_KEY="pplx-..."
"""

import os
import asyncio
import time
from typing import Generator, AsyncGenerator

from openai import OpenAI, AsyncOpenAI


def create_client() -> OpenAI:
    """Create configured Perplexity client."""
    api_key = os.environ.get("PERPLEXITY_API_KEY") or os.environ.get("PPLX_API_KEY")
    if not api_key:
        raise ValueError("PERPLEXITY_API_KEY environment variable required")

    return OpenAI(api_key=api_key, base_url="https://api.perplexity.ai")


def create_async_client() -> AsyncOpenAI:
    """Create configured async Perplexity client."""
    api_key = os.environ.get("PERPLEXITY_API_KEY") or os.environ.get("PPLX_API_KEY")
    if not api_key:
        raise ValueError("PERPLEXITY_API_KEY environment variable required")

    return AsyncOpenAI(api_key=api_key, base_url="https://api.perplexity.ai")


def print_header(title: str) -> None:
    """Print formatted section header."""
    print(f"\n{'=' * 60}")
    print(f"{title}")
    print('=' * 60)


def print_subheader(title: str) -> None:
    """Print formatted subsection header."""
    print(f"\n=== {title} ===\n")


# =============================================================================
# Example 1: Basic Synchronous Streaming
# =============================================================================

def example_basic_streaming() -> None:
    """
    Demonstrate basic synchronous streaming.

    Shows real-time token-by-token output.
    """
    print_subheader("Basic Synchronous Streaming")

    client = create_client()
    query = "Explain how neural networks learn, step by step."

    print(f"Query: {query}\n")
    print("Response (streaming):")

    start_time = time.time()
    chunk_count = 0
    char_count = 0

    stream = client.chat.completions.create(
        model="sonar",
        messages=[{"role": "user", "content": query}],
        stream=True
    )

    for chunk in stream:
        chunk_count += 1
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            char_count += len(content)
            print(content, end="", flush=True)

    elapsed = time.time() - start_time
    print(f"\n\n--- Stats ---")
    print(f"Time: {elapsed:.2f}s")
    print(f"Chunks: {chunk_count}")
    print(f"Characters: {char_count}")
    print(f"Speed: {char_count / elapsed:.0f} chars/sec")


# =============================================================================
# Example 2: Streaming with Content Collection
# =============================================================================

def stream_and_collect(
    client: OpenAI,
    query: str,
    model: str = "sonar"
) -> tuple[str, int]:
    """
    Stream response while collecting full content.

    Args:
        client: Perplexity client
        query: User question
        model: Model to use

    Returns:
        Tuple of (full_content, chunk_count)
    """
    collected = []
    chunk_count = 0

    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": query}],
        stream=True
    )

    for chunk in stream:
        chunk_count += 1
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected.append(content)
            print(content, end="", flush=True)

    print()  # Newline
    return "".join(collected), chunk_count


def example_collect_while_streaming() -> None:
    """
    Demonstrate streaming with content collection.

    Shows how to display real-time and keep full response.
    """
    print_subheader("Streaming with Collection")

    client = create_client()
    query = "What are the key features of Python 3.12?"

    print(f"Query: {query}\n")
    print("Response:")

    full_content, chunks = stream_and_collect(client, query)

    print(f"\n--- Collected {len(full_content)} characters in {chunks} chunks ---")
    print(f"First 100 chars: {full_content[:100]}...")


# =============================================================================
# Example 3: Async Streaming
# =============================================================================

async def async_stream_search(
    client: AsyncOpenAI,
    query: str,
    model: str = "sonar"
) -> AsyncGenerator[str, None]:
    """
    Stream search response asynchronously.

    Args:
        client: Async Perplexity client
        query: User question
        model: Model to use

    Yields:
        Content chunks
    """
    stream = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": query}],
        stream=True
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def example_async_streaming() -> None:
    """
    Demonstrate asynchronous streaming.

    Shows async/await pattern for streaming.
    """
    print_subheader("Async Streaming")

    client = create_async_client()
    query = "What is the current state of quantum computing?"

    print(f"Query: {query}\n")
    print("Response (async):")

    collected = []
    async for chunk in async_stream_search(client, query):
        collected.append(chunk)
        print(chunk, end="", flush=True)

    print(f"\n\n--- Collected {len(''.join(collected))} characters ---")


# =============================================================================
# Example 4: Concurrent Async Streams
# =============================================================================

async def stream_query(
    client: AsyncOpenAI,
    query: str,
    index: int
) -> str:
    """Stream a single query and return collected content."""
    collected = []

    async for chunk in async_stream_search(client, query):
        collected.append(chunk)

    return "".join(collected)


async def example_concurrent_streams() -> None:
    """
    Demonstrate concurrent async streaming.

    Shows how to run multiple streams in parallel.
    """
    print_subheader("Concurrent Async Streams")

    client = create_async_client()

    queries = [
        "What is machine learning?",
        "What is deep learning?",
        "What is reinforcement learning?"
    ]

    print("Running 3 queries concurrently...\n")
    start_time = time.time()

    tasks = [stream_query(client, q, i) for i, q in enumerate(queries)]
    results = await asyncio.gather(*tasks)

    elapsed = time.time() - start_time

    for i, (query, result) in enumerate(zip(queries, results)):
        print(f"Q{i+1}: {query}")
        print(f"A{i+1}: {result[:150]}...\n")

    print(f"--- All 3 completed in {elapsed:.2f}s ---")


# =============================================================================
# Example 5: Streaming Conversation
# =============================================================================

class StreamingConversation:
    """
    Multi-turn conversation with streaming responses.

    Maintains conversation history while streaming each response.
    """

    def __init__(self, system_prompt: str = "You are a helpful assistant."):
        self.client = create_client()
        self.messages = [{"role": "system", "content": system_prompt}]

    def stream_ask(self, query: str) -> Generator[str, None, str]:
        """
        Ask a question with streaming response.

        Args:
            query: User question

        Yields:
            Content chunks

        Returns:
            Full response content
        """
        self.messages.append({"role": "user", "content": query})

        stream = self.client.chat.completions.create(
            model="sonar",
            messages=self.messages,
            stream=True
        )

        collected = []
        for chunk in stream:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                collected.append(content)
                yield content

        full_response = "".join(collected)
        self.messages.append({"role": "assistant", "content": full_response})
        return full_response

    def clear(self) -> None:
        """Clear conversation history."""
        self.messages = self.messages[:1]


def example_streaming_conversation() -> None:
    """
    Demonstrate streaming in multi-turn conversation.

    Shows how to stream while maintaining context.
    """
    print_subheader("Streaming Conversation")

    conv = StreamingConversation(
        system_prompt="You are a helpful science tutor. Give clear, concise explanations."
    )

    questions = [
        "What is photosynthesis?",
        "Why is it important for life on Earth?",
        "How does it relate to the carbon cycle?"
    ]

    for i, question in enumerate(questions, 1):
        print(f"\nQ{i}: {question}")
        print(f"A{i}: ", end="")

        for chunk in conv.stream_ask(question):
            print(chunk, end="", flush=True)

        print()  # Newline after response

    print(f"\n--- Conversation had {len(conv.messages)} messages ---")


# =============================================================================
# Example 6: SSE Generator for Web
# =============================================================================

def create_sse_generator(query: str) -> Generator[str, None, None]:
    """
    Create Server-Sent Events generator.

    For use with web frameworks like FastAPI/Flask.

    Args:
        query: User question

    Yields:
        SSE-formatted strings
    """
    client = create_client()

    stream = client.chat.completions.create(
        model="sonar",
        messages=[{"role": "user", "content": query}],
        stream=True
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            # Escape newlines for SSE
            escaped = content.replace("\n", "\\n")
            yield f"data: {escaped}\n\n"

    yield "data: [DONE]\n\n"


def example_sse_generator() -> None:
    """
    Demonstrate SSE generator pattern.

    Shows the output format for web streaming.
    """
    print_subheader("SSE Generator (Web Pattern)")

    query = "List 3 programming languages and their uses."

    print(f"Query: {query}\n")
    print("SSE Output:")
    print("-" * 40)

    for sse_data in create_sse_generator(query):
        print(sse_data, end="")

    print("-" * 40)
    print("\n(This format is used for web streaming endpoints)")


# =============================================================================
# Example 7: Streaming with Progress Indicator
# =============================================================================

def stream_with_progress(query: str) -> str:
    """
    Stream response with a progress indicator.

    Shows dots while waiting for initial response.
    """
    client = create_client()

    print("Searching", end="", flush=True)

    stream = client.chat.completions.create(
        model="sonar",
        messages=[{"role": "user", "content": query}],
        stream=True
    )

    collected = []
    first_chunk = True

    for chunk in stream:
        if chunk.choices[0].delta.content:
            if first_chunk:
                print("\n\nResponse:")
                first_chunk = False
            content = chunk.choices[0].delta.content
            collected.append(content)
            print(content, end="", flush=True)
        elif first_chunk:
            print(".", end="", flush=True)

    print()
    return "".join(collected)


def example_progress_indicator() -> None:
    """
    Demonstrate streaming with progress indicator.

    Shows user feedback while waiting for first token.
    """
    print_subheader("Streaming with Progress")

    query = "What are the benefits of exercise?"
    print(f"Query: {query}\n")

    result = stream_with_progress(query)
    print(f"\n--- Response length: {len(result)} chars ---")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all streaming examples."""
    print_header("Perplexity Sonar Streaming Examples")

    try:
        # Sync examples
        example_basic_streaming()
        example_collect_while_streaming()
        example_streaming_conversation()
        example_sse_generator()
        example_progress_indicator()

        # Async examples
        asyncio.run(example_async_streaming())
        asyncio.run(example_concurrent_streams())

        print_header("All Streaming Examples Complete")

    except ValueError as e:
        print(f"\nConfiguration Error: {e}")
        print("Please set PERPLEXITY_API_KEY environment variable")
    except Exception as e:
        print(f"\nError: {e}")
        raise


if __name__ == "__main__":
    main()
