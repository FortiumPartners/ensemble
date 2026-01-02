"""
Perplexity Sonar Streaming Template

Real-time streaming responses with search-augmented generation.

Placeholders:
- {{MODEL}} -> Model ID (sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro)
- {{SYSTEM_PROMPT}} -> System message content

Usage:
    1. Copy this file to your project
    2. Replace placeholders with actual values
    3. Set PERPLEXITY_API_KEY environment variable
    4. Run the script
"""

import os
import asyncio
import logging
from typing import Generator, AsyncGenerator, Optional
from dataclasses import dataclass

from openai import OpenAI, AsyncOpenAI, APIError, RateLimitError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration - Replace placeholders
MODEL = "{{MODEL}}"
SYSTEM_PROMPT = "{{SYSTEM_PROMPT}}"


@dataclass
class StreamResult:
    """Result from streaming completion."""
    content: str
    citations: list[str]
    chunk_count: int


def create_client() -> OpenAI:
    """Create configured Perplexity client."""
    api_key = os.environ.get("PERPLEXITY_API_KEY") or os.environ.get("PPLX_API_KEY")

    if not api_key:
        raise ValueError(
            "PERPLEXITY_API_KEY or PPLX_API_KEY environment variable required"
        )

    return OpenAI(
        api_key=api_key,
        base_url="https://api.perplexity.ai"
    )


def create_async_client() -> AsyncOpenAI:
    """Create configured async Perplexity client."""
    api_key = os.environ.get("PERPLEXITY_API_KEY") or os.environ.get("PPLX_API_KEY")

    if not api_key:
        raise ValueError(
            "PERPLEXITY_API_KEY or PPLX_API_KEY environment variable required"
        )

    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.perplexity.ai"
    )


# =============================================================================
# Synchronous Streaming
# =============================================================================

def stream_search(
    query: str,
    client: Optional[OpenAI] = None,
    system_prompt: str = SYSTEM_PROMPT,
    model: str = MODEL,
    max_tokens: int = 2000,
    temperature: float = 0.2
) -> Generator[str, None, StreamResult]:
    """
    Stream search-augmented response synchronously.

    Yields content chunks as they arrive.
    Returns StreamResult with full content and citations.

    Args:
        query: User's question or search query
        client: Optional pre-configured client
        system_prompt: System message for context
        model: Perplexity model to use
        max_tokens: Maximum response tokens
        temperature: Response randomness

    Yields:
        Content chunks as strings

    Returns:
        StreamResult with full content and citations
    """
    if client is None:
        client = create_client()

    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True
    )

    collected_content = []
    citations = []
    chunk_count = 0

    for chunk in stream:
        chunk_count += 1

        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected_content.append(content)
            yield content

        # Check for citations in chunk metadata
        if hasattr(chunk, 'citations'):
            citations.extend(chunk.citations)

    return StreamResult(
        content="".join(collected_content),
        citations=list(set(citations)),
        chunk_count=chunk_count
    )


def stream_to_console(
    query: str,
    model: str = MODEL,
    show_stats: bool = True
) -> StreamResult:
    """
    Stream response directly to console with real-time output.

    Args:
        query: User's question
        model: Perplexity model to use
        show_stats: Whether to show completion statistics

    Returns:
        StreamResult with full content and citations
    """
    client = create_client()
    collected = []
    citations = []
    chunk_count = 0

    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query}
        ],
        stream=True
    )

    for chunk in stream:
        chunk_count += 1

        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected.append(content)
            print(content, end="", flush=True)

        if hasattr(chunk, 'citations'):
            citations.extend(chunk.citations)

    print()  # Newline after streaming

    if show_stats:
        print(f"\n--- Chunks: {chunk_count} | Chars: {len(''.join(collected))} ---")

    return StreamResult(
        content="".join(collected),
        citations=list(set(citations)),
        chunk_count=chunk_count
    )


# =============================================================================
# Asynchronous Streaming
# =============================================================================

async def async_stream_search(
    query: str,
    client: Optional[AsyncOpenAI] = None,
    system_prompt: str = SYSTEM_PROMPT,
    model: str = MODEL,
    max_tokens: int = 2000,
    temperature: float = 0.2
) -> AsyncGenerator[str, None]:
    """
    Stream search-augmented response asynchronously.

    Args:
        query: User's question or search query
        client: Optional pre-configured async client
        system_prompt: System message for context
        model: Perplexity model to use
        max_tokens: Maximum response tokens
        temperature: Response randomness

    Yields:
        Content chunks as strings
    """
    if client is None:
        client = create_async_client()

    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def async_stream_to_string(
    query: str,
    model: str = MODEL
) -> str:
    """
    Stream response asynchronously and collect full content.

    Args:
        query: User's question
        model: Perplexity model to use

    Returns:
        Complete response content as string
    """
    collected = []

    async for chunk in async_stream_search(query, model=model):
        collected.append(chunk)
        print(chunk, end="", flush=True)

    print()  # Newline after streaming
    return "".join(collected)


async def async_stream_multiple(
    queries: list[str],
    model: str = MODEL
) -> list[str]:
    """
    Stream multiple queries concurrently.

    Args:
        queries: List of questions
        model: Perplexity model to use

    Returns:
        List of complete responses
    """
    async def stream_one(query: str, index: int) -> str:
        collected = []
        async for chunk in async_stream_search(query, model=model):
            collected.append(chunk)
        return "".join(collected)

    tasks = [stream_one(q, i) for i, q in enumerate(queries)]
    return await asyncio.gather(*tasks)


# =============================================================================
# Server-Sent Events (SSE) for Web Applications
# =============================================================================

def create_sse_generator(
    query: str,
    model: str = MODEL
) -> Generator[str, None, None]:
    """
    Create SSE-formatted generator for web endpoints.

    Usage with FastAPI:
        @app.get("/search")
        async def search(query: str):
            return StreamingResponse(
                create_sse_generator(query),
                media_type="text/event-stream"
            )

    Args:
        query: User's question
        model: Perplexity model to use

    Yields:
        SSE-formatted data strings
    """
    client = create_client()

    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query}
        ],
        stream=True
    )

    for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            # Escape newlines for SSE format
            escaped = content.replace("\n", "\\n")
            yield f"data: {escaped}\n\n"

    yield "data: [DONE]\n\n"


# =============================================================================
# Streaming Conversation Manager
# =============================================================================

class StreamingChat:
    """
    Multi-turn conversation with streaming responses.

    Example:
        chat = StreamingChat()

        # Stream first response
        for chunk in chat.stream("What is quantum computing?"):
            print(chunk, end="", flush=True)

        # Continue conversation with streaming
        for chunk in chat.stream("What are its applications?"):
            print(chunk, end="", flush=True)
    """

    def __init__(
        self,
        system_prompt: str = SYSTEM_PROMPT,
        model: str = MODEL
    ):
        self.client = create_client()
        self.model = model
        self.messages = [{"role": "system", "content": system_prompt}]
        self.all_citations: list[str] = []

    def stream(
        self,
        query: str,
        temperature: float = 0.2
    ) -> Generator[str, None, str]:
        """
        Stream response and maintain conversation context.

        Args:
            query: User's question
            temperature: Response randomness

        Yields:
            Content chunks

        Returns:
            Complete response content
        """
        self.messages.append({"role": "user", "content": query})

        stream = self.client.chat.completions.create(
            model=self.model,
            messages=self.messages,
            temperature=temperature,
            stream=True
        )

        collected = []
        for chunk in stream:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                collected.append(content)
                yield content

            if hasattr(chunk, 'citations'):
                self.all_citations.extend(chunk.citations)

        full_response = "".join(collected)
        self.messages.append({"role": "assistant", "content": full_response})
        return full_response

    def get_citations(self) -> list[str]:
        """Get all unique citations from conversation."""
        return list(set(self.all_citations))

    def clear(self) -> None:
        """Clear conversation history."""
        self.messages = self.messages[:1]
        self.all_citations = []


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    print("=== Synchronous Streaming ===")
    result = stream_to_console("What are the latest AI developments?")
    if result.citations:
        print(f"Citations: {result.citations}")

    print("\n=== Async Streaming ===")
    asyncio.run(async_stream_to_string("Explain machine learning briefly."))

    print("\n=== Streaming Conversation ===")
    chat = StreamingChat()

    print("\nQ1: What is quantum computing?")
    for chunk in chat.stream("What is quantum computing?"):
        print(chunk, end="", flush=True)
    print()

    print("\nQ2: What are its applications?")
    for chunk in chat.stream("What are its practical applications?"):
        print(chunk, end="", flush=True)
    print()

    print(f"\nAll citations: {chat.get_citations()}")
