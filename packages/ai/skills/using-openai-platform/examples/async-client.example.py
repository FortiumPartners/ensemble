#!/usr/bin/env python3
"""
Async Client Example

This example demonstrates asynchronous OpenAI API usage:
- AsyncOpenAI client setup
- Concurrent API calls
- Async context managers
- Error handling in async code
- Rate limit handling with semaphores
- Batch processing patterns

Usage:
    python async-client.example.py
"""

import os
import asyncio
import logging
import time
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from openai import AsyncOpenAI, APIError, RateLimitError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Data Models
# =============================================================================

@dataclass
class CompletionResult:
    """Result from an async completion."""
    prompt: str
    response: str
    tokens: int
    duration_ms: float
    success: bool
    error: Optional[str] = None


# =============================================================================
# Basic Async Examples
# =============================================================================

async def async_basic_completion():
    """Basic async completion example."""
    print("\n=== Basic Async Completion ===\n")

    client = AsyncOpenAI()

    start = time.time()

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "What is the capital of Japan?"}
        ]
    )

    duration = (time.time() - start) * 1000

    print(f"Question: What is the capital of Japan?")
    print(f"Answer: {response.choices[0].message.content}")
    print(f"Duration: {duration:.0f}ms")
    print(f"Tokens: {response.usage.total_tokens}")


async def async_multiple_sequential():
    """Multiple async calls executed sequentially."""
    print("\n=== Sequential Async Calls ===\n")

    client = AsyncOpenAI()

    questions = [
        "What is 2 + 2?",
        "What color is the sky?",
        "What is the largest planet?",
    ]

    start = time.time()

    for question in questions:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": question}],
            max_tokens=50
        )
        print(f"Q: {question}")
        print(f"A: {response.choices[0].message.content}\n")

    total_duration = (time.time() - start) * 1000
    print(f"Total sequential time: {total_duration:.0f}ms")


async def async_multiple_concurrent():
    """Multiple async calls executed concurrently."""
    print("\n=== Concurrent Async Calls ===\n")

    client = AsyncOpenAI()

    questions = [
        "What is 2 + 2?",
        "What color is the sky?",
        "What is the largest planet?",
    ]

    async def ask_question(question: str) -> tuple:
        """Ask a single question and return result."""
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": question}],
            max_tokens=50
        )
        return question, response.choices[0].message.content

    start = time.time()

    # Execute all calls concurrently
    results = await asyncio.gather(*[ask_question(q) for q in questions])

    total_duration = (time.time() - start) * 1000

    for question, answer in results:
        print(f"Q: {question}")
        print(f"A: {answer}\n")

    print(f"Total concurrent time: {total_duration:.0f}ms")
    print("(Compare to sequential time - concurrent should be faster!)")


# =============================================================================
# Advanced Async Patterns
# =============================================================================

async def async_with_timeout():
    """Async calls with timeout handling."""
    print("\n=== Async with Timeout ===\n")

    client = AsyncOpenAI()

    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": "Write a very short haiku."}
                ],
                max_tokens=50
            ),
            timeout=10.0
        )
        print(f"Response: {response.choices[0].message.content}")

    except asyncio.TimeoutError:
        print("Request timed out after 10 seconds!")


async def async_with_semaphore():
    """Rate-limited concurrent calls using semaphore."""
    print("\n=== Rate-Limited Concurrent Calls ===\n")

    client = AsyncOpenAI()

    # Limit to 3 concurrent requests
    semaphore = asyncio.Semaphore(3)

    prompts = [
        "Define: algorithm",
        "Define: recursion",
        "Define: polymorphism",
        "Define: encapsulation",
        "Define: inheritance",
        "Define: abstraction",
    ]

    async def rate_limited_call(prompt: str, index: int) -> CompletionResult:
        """Make an API call with rate limiting."""
        async with semaphore:
            start = time.time()
            try:
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=100
                )
                duration = (time.time() - start) * 1000

                return CompletionResult(
                    prompt=prompt,
                    response=response.choices[0].message.content,
                    tokens=response.usage.total_tokens,
                    duration_ms=duration,
                    success=True
                )

            except Exception as e:
                return CompletionResult(
                    prompt=prompt,
                    response="",
                    tokens=0,
                    duration_ms=0,
                    success=False,
                    error=str(e)
                )

    start = time.time()

    # Execute with rate limiting
    tasks = [rate_limited_call(p, i) for i, p in enumerate(prompts)]
    results = await asyncio.gather(*tasks)

    total_duration = (time.time() - start) * 1000

    for result in results:
        if result.success:
            term = result.prompt.split(": ")[1]
            answer = result.response[:80] + "..." if len(result.response) > 80 else result.response
            print(f"  {term}: {answer}")
        else:
            print(f"  Failed: {result.error}")

    print(f"\nTotal time with rate limiting: {total_duration:.0f}ms")
    print(f"Processed {len(results)} requests with max 3 concurrent")


async def async_batch_processing():
    """Process items in batches asynchronously."""
    print("\n=== Batch Processing ===\n")

    client = AsyncOpenAI()

    # Items to process
    items = [
        "Translate to French: Hello",
        "Translate to French: Goodbye",
        "Translate to French: Thank you",
        "Translate to French: Please",
        "Translate to French: Yes",
        "Translate to French: No",
        "Translate to French: Help",
        "Translate to French: Sorry",
    ]

    batch_size = 3

    async def process_item(item: str) -> Dict[str, str]:
        """Process a single item."""
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": item}],
            max_tokens=50
        )
        return {
            "input": item,
            "output": response.choices[0].message.content
        }

    async def process_batch(batch: List[str]) -> List[Dict[str, str]]:
        """Process a batch of items concurrently."""
        tasks = [process_item(item) for item in batch]
        return await asyncio.gather(*tasks)

    all_results = []
    start = time.time()

    # Process in batches
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        print(f"Processing batch {batch_num}...")

        results = await process_batch(batch)
        all_results.extend(results)

        # Small delay between batches (optional)
        if i + batch_size < len(items):
            await asyncio.sleep(0.1)

    total_duration = (time.time() - start) * 1000

    print(f"\nResults:")
    for result in all_results:
        english = result["input"].split(": ")[1]
        french = result["output"].strip()
        print(f"  {english} -> {french}")

    print(f"\nProcessed {len(items)} items in batches of {batch_size}")
    print(f"Total time: {total_duration:.0f}ms")


async def async_error_handling():
    """Comprehensive error handling for async operations."""
    print("\n=== Async Error Handling ===\n")

    client = AsyncOpenAI()

    async def safe_completion(prompt: str, max_retries: int = 3) -> Optional[str]:
        """Make a completion with retry logic."""
        for attempt in range(max_retries):
            try:
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=50
                )
                return response.choices[0].message.content

            except RateLimitError:
                wait_time = 2 ** attempt  # Exponential backoff
                logger.warning(f"Rate limited, waiting {wait_time}s...")
                await asyncio.sleep(wait_time)

            except APIError as e:
                logger.error(f"API error: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)
                else:
                    return None

            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                return None

        return None

    # Test with a valid request
    result = await safe_completion("Say 'hello' in one word.")
    if result:
        print(f"Success: {result}")
    else:
        print("Failed after retries")


async def async_streaming():
    """Async streaming example."""
    print("\n=== Async Streaming ===\n")

    client = AsyncOpenAI()

    print("Streaming response:")
    print("-" * 40)

    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Write a very short poem about code."}
        ],
        stream=True
    )

    collected = []
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            collected.append(content)
            print(content, end="", flush=True)

    print("\n" + "-" * 40)
    print(f"Total chunks: {len(collected)}")


async def async_context_manager():
    """Using async client as context manager."""
    print("\n=== Async Context Manager ===\n")

    # The AsyncOpenAI client can be used as a context manager
    # for proper resource cleanup
    async with AsyncOpenAI() as client:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "What is 10 * 10?"}
            ]
        )
        print(f"Response: {response.choices[0].message.content}")

    print("Client properly closed after context exit")


# =============================================================================
# Practical Patterns
# =============================================================================

async def parallel_analysis():
    """Analyze text in parallel with multiple prompts."""
    print("\n=== Parallel Analysis ===\n")

    client = AsyncOpenAI()

    text = """
    The new product launch was incredibly successful. Sales exceeded
    expectations by 40%, and customer feedback has been overwhelmingly
    positive. However, the supply chain faced some challenges that
    need to be addressed before the next quarter.
    """

    analyses = {
        "sentiment": "Analyze the sentiment of this text. Reply with just: positive, negative, or mixed.",
        "summary": "Summarize this text in one sentence.",
        "keywords": "Extract 3 key topics from this text. Reply with just the topics, comma-separated.",
        "tone": "What is the professional tone of this text? Reply in 2-3 words."
    }

    async def analyze(name: str, prompt: str) -> tuple:
        """Run a single analysis."""
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": f"{prompt}\n\nText: {text}"}
            ],
            max_tokens=100
        )
        return name, response.choices[0].message.content.strip()

    start = time.time()

    # Run all analyses in parallel
    tasks = [analyze(name, prompt) for name, prompt in analyses.items()]
    results = await asyncio.gather(*tasks)

    duration = (time.time() - start) * 1000

    print("Analysis Results:")
    for name, result in results:
        print(f"  {name.capitalize()}: {result}")

    print(f"\nAll {len(analyses)} analyses completed in {duration:.0f}ms")


async def async_conversation_manager():
    """Manage multiple conversations asynchronously."""
    print("\n=== Async Conversation Manager ===\n")

    client = AsyncOpenAI()

    # Simulate multiple users with different conversations
    conversations = {
        "user_1": [
            {"role": "system", "content": "You are a helpful math tutor."},
            {"role": "user", "content": "What is the Pythagorean theorem?"}
        ],
        "user_2": [
            {"role": "system", "content": "You are a cooking assistant."},
            {"role": "user", "content": "How do I make pasta?"}
        ],
        "user_3": [
            {"role": "system", "content": "You are a fitness coach."},
            {"role": "user", "content": "How often should I exercise?"}
        ]
    }

    async def handle_conversation(user_id: str, messages: List[Dict]) -> tuple:
        """Handle a single conversation."""
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=100
        )
        return user_id, response.choices[0].message.content

    start = time.time()

    # Handle all conversations concurrently
    tasks = [
        handle_conversation(user_id, messages)
        for user_id, messages in conversations.items()
    ]
    results = await asyncio.gather(*tasks)

    duration = (time.time() - start) * 1000

    for user_id, response in results:
        print(f"{user_id}: {response[:100]}...")
        print()

    print(f"Handled {len(conversations)} conversations in {duration:.0f}ms")


# =============================================================================
# Main
# =============================================================================

async def main():
    """Run all async examples."""
    print("=" * 60)
    print("OpenAI Async Client Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        print("Set it with: export OPENAI_API_KEY='sk-...'")
        return

    try:
        # Basic examples
        await async_basic_completion()
        await async_multiple_sequential()
        await async_multiple_concurrent()

        # Advanced patterns
        await async_with_timeout()
        await async_with_semaphore()
        await async_batch_processing()
        await async_error_handling()
        await async_streaming()
        await async_context_manager()

        # Practical patterns
        await parallel_analysis()
        await async_conversation_manager()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All async examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
