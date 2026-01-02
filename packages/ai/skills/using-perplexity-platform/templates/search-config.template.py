"""
Perplexity Sonar Search Configuration Template

Advanced search configuration with domain filtering, recency, and academic focus.

Placeholders:
- {{MODEL}} -> Model ID (sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro)
- {{ALLOWED_DOMAINS}} -> Comma-separated list of allowed domains
- {{RECENCY_FILTER}} -> day, week, month, or year

Usage:
    1. Copy this file to your project
    2. Replace placeholders with actual values
    3. Set PERPLEXITY_API_KEY environment variable
    4. Run the script
"""

import os
import logging
from dataclasses import dataclass, field
from typing import Optional, Literal
from enum import Enum

from openai import OpenAI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration - Replace placeholders
MODEL = "{{MODEL}}"
ALLOWED_DOMAINS = "{{ALLOWED_DOMAINS}}".split(",") if "{{ALLOWED_DOMAINS}}" else []
RECENCY_FILTER = "{{RECENCY_FILTER}}"


class RecencyFilter(Enum):
    """Available recency filter options."""
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"


@dataclass
class SearchConfig:
    """Configuration for Perplexity search behavior."""
    domain_filter: list[str] = field(default_factory=list)
    recency_filter: Optional[str] = None
    return_images: bool = False
    return_related_questions: bool = False


@dataclass
class SearchResponse:
    """Structured response with content, citations, and metadata."""
    content: str
    citations: list[str]
    images: list[str]
    related_questions: list[str]
    model: str


# =============================================================================
# Preset Search Configurations
# =============================================================================

# Academic/Research sources
ACADEMIC_DOMAINS = [
    "arxiv.org",
    "pubmed.ncbi.nlm.nih.gov",
    "scholar.google.com",
    "nature.com",
    "science.org",
    "cell.com",
    "ieee.org",
    "acm.org",
    "springer.com",
    "wiley.com"
]

# Tech news sources
TECH_NEWS_DOMAINS = [
    "techcrunch.com",
    "theverge.com",
    "wired.com",
    "arstechnica.com",
    "engadget.com",
    "zdnet.com",
    "cnet.com"
]

# AI/ML specific sources
AI_ML_DOMAINS = [
    "arxiv.org",
    "openai.com",
    "anthropic.com",
    "deepmind.com",
    "huggingface.co",
    "pytorch.org",
    "tensorflow.org"
]

# Business/Finance sources
BUSINESS_DOMAINS = [
    "bloomberg.com",
    "reuters.com",
    "wsj.com",
    "ft.com",
    "cnbc.com",
    "forbes.com"
]

# Government/Official sources
OFFICIAL_DOMAINS = [
    ".gov",
    ".edu",
    "who.int",
    "un.org",
    "europa.eu"
]


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


def search_with_config(
    query: str,
    config: SearchConfig,
    client: Optional[OpenAI] = None,
    system_prompt: str = "You are a helpful research assistant. Provide accurate, well-sourced information.",
    model: str = MODEL,
    max_tokens: int = 2000,
    temperature: float = 0.2
) -> SearchResponse:
    """
    Perform search with custom configuration.

    Args:
        query: User's question or search query
        config: SearchConfig with domain/recency settings
        client: Optional pre-configured client
        system_prompt: System message for context
        model: Perplexity model to use
        max_tokens: Maximum response tokens
        temperature: Response randomness

    Returns:
        SearchResponse with content, citations, and metadata
    """
    if client is None:
        client = create_client()

    # Build extra_body with search configuration
    extra_body = {}

    if config.domain_filter:
        extra_body["search_domain_filter"] = config.domain_filter

    if config.recency_filter:
        extra_body["search_recency_filter"] = config.recency_filter

    if config.return_images:
        extra_body["return_images"] = True

    if config.return_related_questions:
        extra_body["return_related_questions"] = True

    # Make request
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        max_tokens=max_tokens,
        temperature=temperature,
        extra_body=extra_body if extra_body else None
    )

    content = response.choices[0].message.content

    # Extract metadata
    citations = getattr(response, 'citations', []) or []
    images = getattr(response, 'images', []) or []
    related = getattr(response, 'related_questions', []) or []

    return SearchResponse(
        content=content,
        citations=citations,
        images=images,
        related_questions=related,
        model=response.model
    )


# =============================================================================
# Convenience Functions
# =============================================================================

def search_academic(
    query: str,
    recency: Optional[str] = None
) -> SearchResponse:
    """
    Search academic and research sources only.

    Args:
        query: Research question
        recency: Optional recency filter (day, week, month, year)

    Returns:
        SearchResponse from academic sources
    """
    config = SearchConfig(
        domain_filter=ACADEMIC_DOMAINS,
        recency_filter=recency
    )
    return search_with_config(
        query,
        config,
        system_prompt="You are an academic research assistant. Cite peer-reviewed sources and be precise about claims."
    )


def search_tech_news(
    query: str,
    recency: str = "week"
) -> SearchResponse:
    """
    Search tech news sources for recent developments.

    Args:
        query: Tech-related question
        recency: Recency filter (default: week)

    Returns:
        SearchResponse from tech news sources
    """
    config = SearchConfig(
        domain_filter=TECH_NEWS_DOMAINS,
        recency_filter=recency,
        return_related_questions=True
    )
    return search_with_config(
        query,
        config,
        system_prompt="You are a tech industry analyst. Focus on recent developments and industry trends."
    )


def search_ai_ml(
    query: str,
    include_arxiv: bool = True
) -> SearchResponse:
    """
    Search AI/ML specific sources.

    Args:
        query: AI/ML related question
        include_arxiv: Whether to include arXiv papers

    Returns:
        SearchResponse from AI/ML sources
    """
    domains = AI_ML_DOMAINS.copy()
    if not include_arxiv:
        domains = [d for d in domains if d != "arxiv.org"]

    config = SearchConfig(
        domain_filter=domains,
        return_related_questions=True
    )
    return search_with_config(
        query,
        config,
        system_prompt="You are an AI/ML expert. Explain technical concepts clearly and cite authoritative sources."
    )


def search_current_events(
    query: str,
    recency: str = "day"
) -> SearchResponse:
    """
    Search for current events and breaking news.

    Args:
        query: News-related question
        recency: Recency filter (default: day)

    Returns:
        SearchResponse with current information
    """
    config = SearchConfig(
        recency_filter=recency,
        return_related_questions=True
    )
    return search_with_config(
        query,
        config,
        system_prompt="You are a news analyst. Provide factual, up-to-date information with source attribution."
    )


def search_business(
    query: str,
    recency: Optional[str] = "week"
) -> SearchResponse:
    """
    Search business and financial sources.

    Args:
        query: Business/finance question
        recency: Recency filter (default: week)

    Returns:
        SearchResponse from business sources
    """
    config = SearchConfig(
        domain_filter=BUSINESS_DOMAINS,
        recency_filter=recency
    )
    return search_with_config(
        query,
        config,
        system_prompt="You are a business analyst. Provide accurate financial and market information."
    )


def search_official(
    query: str
) -> SearchResponse:
    """
    Search government and official sources only.

    Args:
        query: Policy or official information question

    Returns:
        SearchResponse from official sources
    """
    config = SearchConfig(
        domain_filter=OFFICIAL_DOMAINS
    )
    return search_with_config(
        query,
        config,
        system_prompt="You are a policy analyst. Cite official government and institutional sources."
    )


# =============================================================================
# Custom Configuration Builder
# =============================================================================

class SearchBuilder:
    """
    Fluent builder for search configuration.

    Example:
        result = (SearchBuilder()
            .with_domains(["nature.com", "science.org"])
            .recent("month")
            .with_images()
            .search("Latest climate research"))
    """

    def __init__(self):
        self._config = SearchConfig()
        self._system_prompt = "You are a helpful research assistant."
        self._model = MODEL
        self._client: Optional[OpenAI] = None

    def with_domains(self, domains: list[str]) -> "SearchBuilder":
        """Limit search to specific domains."""
        self._config.domain_filter = domains
        return self

    def add_domains(self, domains: list[str]) -> "SearchBuilder":
        """Add domains to existing filter."""
        self._config.domain_filter.extend(domains)
        return self

    def recent(self, period: Literal["day", "week", "month", "year"]) -> "SearchBuilder":
        """Filter by recency."""
        self._config.recency_filter = period
        return self

    def with_images(self) -> "SearchBuilder":
        """Include images in response."""
        self._config.return_images = True
        return self

    def with_related_questions(self) -> "SearchBuilder":
        """Include related questions."""
        self._config.return_related_questions = True
        return self

    def system(self, prompt: str) -> "SearchBuilder":
        """Set custom system prompt."""
        self._system_prompt = prompt
        return self

    def model(self, model: str) -> "SearchBuilder":
        """Set model to use."""
        self._model = model
        return self

    def client(self, client: OpenAI) -> "SearchBuilder":
        """Use pre-configured client."""
        self._client = client
        return self

    def search(self, query: str) -> SearchResponse:
        """Execute the search."""
        return search_with_config(
            query=query,
            config=self._config,
            client=self._client,
            system_prompt=self._system_prompt,
            model=self._model
        )


# =============================================================================
# Response Formatting
# =============================================================================

def format_response(
    response: SearchResponse,
    include_citations: bool = True,
    include_related: bool = True
) -> str:
    """
    Format response for display.

    Args:
        response: SearchResponse object
        include_citations: Whether to include citations
        include_related: Whether to include related questions

    Returns:
        Formatted string
    """
    output = response.content

    if include_citations and response.citations:
        output += "\n\n---\n**Sources:**\n"
        for i, url in enumerate(response.citations, 1):
            output += f"{i}. {url}\n"

    if include_related and response.related_questions:
        output += "\n**Related Questions:**\n"
        for q in response.related_questions:
            output += f"- {q}\n"

    return output


# =============================================================================
# Example Usage
# =============================================================================

if __name__ == "__main__":
    print("=== Academic Search ===")
    result = search_academic("What are the latest findings on CRISPR gene editing?")
    print(format_response(result))

    print("\n=== Tech News Search ===")
    result = search_tech_news("Latest AI startup funding rounds")
    print(format_response(result))

    print("\n=== Builder Pattern ===")
    result = (SearchBuilder()
        .with_domains(["nature.com", "science.org"])
        .recent("month")
        .with_related_questions()
        .system("You are a science journalist.")
        .search("Climate change impact on coral reefs"))
    print(format_response(result))

    print("\n=== Current Events ===")
    result = search_current_events("Major tech announcements today")
    print(format_response(result))
