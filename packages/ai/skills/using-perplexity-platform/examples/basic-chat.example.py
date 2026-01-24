#!/usr/bin/env python3
"""
Perplexity Sonar Basic Chat Example

Demonstrates basic search-augmented chat completion with Perplexity's Sonar API.

Requirements:
    pip install openai

Environment:
    export PERPLEXITY_API_KEY="pplx-..."
"""

import os
import logging
from dataclasses import dataclass
from typing import Optional

from openai import OpenAI, APIError, RateLimitError, AuthenticationError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """Structured search result with content and metadata."""
    content: str
    citations: list[str]
    model: str
    prompt_tokens: int
    completion_tokens: int


def create_client() -> OpenAI:
    """
    Create configured Perplexity client.

    Returns:
        Configured OpenAI client pointing to Perplexity API

    Raises:
        ValueError: If API key is not set
    """
    api_key = os.environ.get("PERPLEXITY_API_KEY") or os.environ.get("PPLX_API_KEY")

    if not api_key:
        raise ValueError(
            "API key required. Set PERPLEXITY_API_KEY or PPLX_API_KEY environment variable."
        )

    return OpenAI(
        api_key=api_key,
        base_url="https://api.perplexity.ai"
    )


def print_header(title: str) -> None:
    """Print formatted section header."""
    print(f"\n{'=' * 60}")
    print(f"{title}")
    print('=' * 60)


def print_subheader(title: str) -> None:
    """Print formatted subsection header."""
    print(f"\n=== {title} ===\n")


# =============================================================================
# Example 1: Simple Search Query
# =============================================================================

def example_simple_query(client: OpenAI) -> None:
    """
    Demonstrate a simple search-augmented query.

    Shows basic API usage with citation handling.
    """
    print_subheader("Simple Search Query")

    query = "What are the latest developments in AI as of 2024?"
    print(f"Query: {query}\n")

    try:
        response = client.chat.completions.create(
            model="sonar",
            messages=[
                {"role": "user", "content": query}
            ],
            max_tokens=500,
            temperature=0.2  # Lower temperature for factual accuracy
        )

        print("Answer:")
        print(response.choices[0].message.content)

        # Display citations if available
        if hasattr(response, 'citations') and response.citations:
            print("\nSources:")
            for i, url in enumerate(response.citations, 1):
                print(f"  {i}. {url}")

        print(f"\nTokens used: {response.usage.total_tokens}")

    except APIError as e:
        logger.error(f"API error: {e}")
        raise


# =============================================================================
# Example 2: Query with System Prompt
# =============================================================================

def example_with_system_prompt(client: OpenAI) -> None:
    """
    Demonstrate using system prompts to guide search focus.

    System prompts help focus the search and response style.
    """
    print_subheader("Query with System Prompt")

    system_prompt = """You are a technology analyst specializing in AI and machine learning.
    Provide concise, factual responses with specific examples and data points.
    Always cite your sources."""

    query = "What are the top 3 AI companies by valuation?"
    print(f"System: {system_prompt[:100]}...")
    print(f"Query: {query}\n")

    response = client.chat.completions.create(
        model="sonar-pro",  # Use pro for deeper search
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        max_tokens=800,
        temperature=0.1
    )

    print("Answer:")
    print(response.choices[0].message.content)

    if hasattr(response, 'citations') and response.citations:
        print("\nSources:")
        for i, url in enumerate(response.citations, 1):
            print(f"  {i}. {url}")


# =============================================================================
# Example 3: Multi-Turn Conversation
# =============================================================================

class ConversationManager:
    """
    Manage multi-turn conversations with search context.

    Maintains conversation history and aggregates citations
    across multiple exchanges.
    """

    def __init__(
        self,
        client: OpenAI,
        system_prompt: str = "You are a helpful research assistant.",
        model: str = "sonar"
    ):
        self.client = client
        self.model = model
        self.messages = [{"role": "system", "content": system_prompt}]
        self.all_citations: list[str] = []

    def ask(self, query: str) -> SearchResult:
        """
        Send a query and get a response.

        Args:
            query: User's question

        Returns:
            SearchResult with content and citations
        """
        self.messages.append({"role": "user", "content": query})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=self.messages,
            max_tokens=1000,
            temperature=0.2
        )

        content = response.choices[0].message.content
        self.messages.append({"role": "assistant", "content": content})

        # Collect citations
        citations = []
        if hasattr(response, 'citations'):
            citations = response.citations or []
            self.all_citations.extend(citations)

        return SearchResult(
            content=content,
            citations=citations,
            model=response.model,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens
        )

    def get_all_citations(self) -> list[str]:
        """Get all unique citations from the conversation."""
        return list(set(self.all_citations))

    def clear_history(self) -> None:
        """Clear conversation history, keeping system prompt."""
        self.messages = self.messages[:1]
        self.all_citations = []


def example_multi_turn_conversation(client: OpenAI) -> None:
    """
    Demonstrate multi-turn conversation with context.

    Shows how to maintain conversation history and
    aggregate citations across multiple exchanges.
    """
    print_subheader("Multi-Turn Conversation")

    conv = ConversationManager(
        client,
        system_prompt="You are a science educator. Explain concepts clearly and cite sources."
    )

    # First question
    query1 = "What is quantum computing?"
    print(f"User: {query1}")
    result1 = conv.ask(query1)
    print(f"Assistant: {result1.content[:300]}...")
    print(f"(Citations: {len(result1.citations)})")

    # Follow-up question
    query2 = "What are its practical applications today?"
    print(f"\nUser: {query2}")
    result2 = conv.ask(query2)
    print(f"Assistant: {result2.content[:300]}...")
    print(f"(Citations: {len(result2.citations)})")

    # Another follow-up
    query3 = "Which companies are leading in this space?"
    print(f"\nUser: {query3}")
    result3 = conv.ask(query3)
    print(f"Assistant: {result3.content[:300]}...")
    print(f"(Citations: {len(result3.citations)})")

    # Summary
    all_citations = conv.get_all_citations()
    print(f"\n--- Conversation Summary ---")
    print(f"Messages: {len(conv.messages)}")
    print(f"Total unique sources: {len(all_citations)}")
    if all_citations:
        print("All sources:")
        for url in all_citations[:5]:  # Show first 5
            print(f"  - {url}")
        if len(all_citations) > 5:
            print(f"  ... and {len(all_citations) - 5} more")


# =============================================================================
# Example 4: Error Handling
# =============================================================================

def example_error_handling(client: OpenAI) -> None:
    """
    Demonstrate comprehensive error handling.

    Shows how to handle various API errors gracefully.
    """
    print_subheader("Error Handling")

    def safe_search(query: str, max_retries: int = 3) -> Optional[SearchResult]:
        """Execute search with error handling and retries."""
        import time

        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model="sonar",
                    messages=[{"role": "user", "content": query}],
                    max_tokens=500
                )

                citations = getattr(response, 'citations', []) or []

                return SearchResult(
                    content=response.choices[0].message.content,
                    citations=citations,
                    model=response.model,
                    prompt_tokens=response.usage.prompt_tokens,
                    completion_tokens=response.usage.completion_tokens
                )

            except AuthenticationError:
                print("ERROR: Invalid API key")
                return None

            except RateLimitError:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt
                    print(f"Rate limited, waiting {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    print("ERROR: Rate limit exceeded after retries")
                    return None

            except APIError as e:
                if e.status_code >= 500:
                    if attempt < max_retries - 1:
                        print(f"Server error, retrying...")
                        time.sleep(1)
                    else:
                        print(f"ERROR: Server error after retries: {e}")
                        return None
                else:
                    print(f"ERROR: Client error: {e}")
                    return None

        return None

    # Test with a valid query
    print("Testing safe_search function...")
    result = safe_search("What is the capital of France?")

    if result:
        print(f"Success! Answer: {result.content[:100]}...")
        print(f"Model: {result.model}")
        print(f"Tokens: {result.prompt_tokens + result.completion_tokens}")
    else:
        print("Search failed - check error messages above")


# =============================================================================
# Example 5: Different Models Comparison
# =============================================================================

def example_model_comparison(client: OpenAI) -> None:
    """
    Compare different Sonar models.

    Shows the trade-offs between speed and depth.
    """
    print_subheader("Model Comparison")

    query = "Explain the significance of transformer architecture in AI"
    models = ["sonar", "sonar-pro"]

    for model in models:
        print(f"\n--- Model: {model} ---")

        import time
        start = time.time()

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": query}],
            max_tokens=300
        )

        elapsed = time.time() - start

        print(f"Response time: {elapsed:.2f}s")
        print(f"Answer preview: {response.choices[0].message.content[:200]}...")
        print(f"Tokens: {response.usage.total_tokens}")

        citations = getattr(response, 'citations', []) or []
        print(f"Citations: {len(citations)}")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all examples."""
    print_header("Perplexity Sonar Basic Chat Examples")

    try:
        client = create_client()
        print("Client created successfully")

        example_simple_query(client)
        example_with_system_prompt(client)
        example_multi_turn_conversation(client)
        example_error_handling(client)
        example_model_comparison(client)

        print_header("All Examples Complete")

    except ValueError as e:
        print(f"\nConfiguration Error: {e}")
        print("Please set PERPLEXITY_API_KEY environment variable")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise


if __name__ == "__main__":
    main()
