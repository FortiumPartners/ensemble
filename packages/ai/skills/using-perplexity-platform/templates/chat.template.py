"""
Perplexity Sonar Chat Completions Template

Search-augmented chat completion with citation handling.

Placeholders:
- {{MODEL}} -> Model ID (sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro)
- {{SYSTEM_PROMPT}} -> System message content
- {{MAX_TOKENS}} -> Maximum response tokens

Usage:
    1. Copy this file to your project
    2. Replace placeholders with actual values
    3. Set PERPLEXITY_API_KEY environment variable
    4. Run the script
"""

import os
import logging
from dataclasses import dataclass
from typing import Optional

from openai import OpenAI, APIError, RateLimitError, AuthenticationError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration - Replace placeholders
MODEL = "{{MODEL}}"
SYSTEM_PROMPT = "{{SYSTEM_PROMPT}}"
MAX_TOKENS = {{MAX_TOKENS}}


@dataclass
class SearchResponse:
    """Structured response with content and citations."""
    content: str
    citations: list[str]
    model: str
    usage: dict


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


def search_chat(
    query: str,
    client: Optional[OpenAI] = None,
    system_prompt: str = SYSTEM_PROMPT,
    model: str = MODEL,
    max_tokens: int = MAX_TOKENS,
    temperature: float = 0.2
) -> SearchResponse:
    """
    Perform search-augmented chat completion.

    Args:
        query: User's question or search query
        client: Optional pre-configured client
        system_prompt: System message for context
        model: Perplexity model to use
        max_tokens: Maximum response tokens
        temperature: Response randomness (lower = more focused)

    Returns:
        SearchResponse with content and citations
    """
    if client is None:
        client = create_client()

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query}
            ],
            max_tokens=max_tokens,
            temperature=temperature
        )

        content = response.choices[0].message.content

        # Extract citations if available
        citations = []
        if hasattr(response, 'citations'):
            citations = response.citations

        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens
        }

        return SearchResponse(
            content=content,
            citations=citations,
            model=response.model,
            usage=usage
        )

    except AuthenticationError as e:
        logger.error("Authentication failed - check PERPLEXITY_API_KEY")
        raise

    except RateLimitError as e:
        logger.warning("Rate limited - implement backoff in production")
        raise

    except APIError as e:
        logger.error(f"API error: {e}")
        raise


class PerplexityChat:
    """
    Multi-turn conversation manager with search context.

    Example:
        chat = PerplexityChat("You are a research assistant.")
        response = chat.ask("What are recent AI developments?")
        print(response.content)
        response = chat.ask("Tell me more about the first one.")
        print(chat.get_all_citations())
    """

    def __init__(
        self,
        system_prompt: str = SYSTEM_PROMPT,
        model: str = MODEL,
        max_tokens: int = MAX_TOKENS
    ):
        self.client = create_client()
        self.model = model
        self.max_tokens = max_tokens
        self.messages = [{"role": "system", "content": system_prompt}]
        self.all_citations: list[str] = []

    def ask(self, query: str, temperature: float = 0.2) -> SearchResponse:
        """
        Send a query and get search-augmented response.

        Args:
            query: User's question
            temperature: Response randomness

        Returns:
            SearchResponse with content and citations
        """
        self.messages.append({"role": "user", "content": query})

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                max_tokens=self.max_tokens,
                temperature=temperature
            )

            content = response.choices[0].message.content
            self.messages.append({"role": "assistant", "content": content})

            # Collect citations
            citations = []
            if hasattr(response, 'citations'):
                citations = response.citations
                self.all_citations.extend(citations)

            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }

            return SearchResponse(
                content=content,
                citations=citations,
                model=response.model,
                usage=usage
            )

        except Exception as e:
            # Remove failed message from history
            self.messages.pop()
            raise

    def get_all_citations(self) -> list[str]:
        """Get all unique citations from the conversation."""
        return list(set(self.all_citations))

    def clear_history(self) -> None:
        """Clear conversation history, keep system prompt."""
        self.messages = self.messages[:1]
        self.all_citations = []

    def get_message_count(self) -> int:
        """Get number of messages in conversation."""
        return len(self.messages)


def format_response(response: SearchResponse, include_citations: bool = True) -> str:
    """
    Format response for display.

    Args:
        response: SearchResponse object
        include_citations: Whether to include citation URLs

    Returns:
        Formatted string with content and optional citations
    """
    output = response.content

    if include_citations and response.citations:
        output += "\n\n---\n**Sources:**\n"
        for i, url in enumerate(response.citations, 1):
            output += f"{i}. {url}\n"

    return output


# Example usage
if __name__ == "__main__":
    # Single query example
    print("=== Single Query ===")
    result = search_chat("What are the latest developments in AI?")
    print(format_response(result))

    print("\n=== Multi-turn Conversation ===")
    chat = PerplexityChat()
    response1 = chat.ask("What is quantum computing?")
    print(f"Response 1: {response1.content[:200]}...")

    response2 = chat.ask("What are its practical applications?")
    print(f"Response 2: {response2.content[:200]}...")

    print(f"\nAll citations: {chat.get_all_citations()}")
