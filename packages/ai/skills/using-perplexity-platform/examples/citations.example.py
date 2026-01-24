#!/usr/bin/env python3
"""
Perplexity Sonar Citations Example

Demonstrates comprehensive citation handling with Perplexity's Sonar API.

Requirements:
    pip install openai

Environment:
    export PERPLEXITY_API_KEY="pplx-..."
"""

import os
import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

from openai import OpenAI


@dataclass
class Citation:
    """Structured citation information."""
    url: str
    domain: str
    title: Optional[str] = None
    index: int = 0

    @classmethod
    def from_url(cls, url: str, index: int = 0) -> "Citation":
        """Create citation from URL."""
        domain = urlparse(url).netloc
        return cls(url=url, domain=domain, index=index)


@dataclass
class SearchResult:
    """Search result with content and structured citations."""
    content: str
    citations: list[Citation]
    raw_urls: list[str]
    inline_refs: list[tuple[int, int]]  # (citation_index, position)


def create_client() -> OpenAI:
    """Create configured Perplexity client."""
    api_key = os.environ.get("PERPLEXITY_API_KEY") or os.environ.get("PPLX_API_KEY")
    if not api_key:
        raise ValueError("PERPLEXITY_API_KEY environment variable required")

    return OpenAI(api_key=api_key, base_url="https://api.perplexity.ai")


def print_header(title: str) -> None:
    """Print formatted section header."""
    print(f"\n{'=' * 60}")
    print(f"{title}")
    print('=' * 60)


def print_subheader(title: str) -> None:
    """Print formatted subsection header."""
    print(f"\n=== {title} ===\n")


# =============================================================================
# Citation Extraction Functions
# =============================================================================

def extract_citations(response) -> list[str]:
    """
    Extract citation URLs from API response.

    Args:
        response: OpenAI API response object

    Returns:
        List of citation URLs
    """
    if hasattr(response, 'citations') and response.citations:
        return response.citations
    return []


def parse_inline_citations(content: str) -> list[tuple[int, int]]:
    """
    Parse inline citation references like [1], [2] from content.

    Args:
        content: Response content text

    Returns:
        List of (citation_index, position) tuples
    """
    pattern = r'\[(\d+)\]'
    results = []

    for match in re.finditer(pattern, content):
        index = int(match.group(1))
        position = match.start()
        results.append((index, position))

    return results


def create_structured_citations(urls: list[str]) -> list[Citation]:
    """
    Create structured Citation objects from URLs.

    Args:
        urls: List of citation URLs

    Returns:
        List of Citation objects
    """
    return [Citation.from_url(url, i + 1) for i, url in enumerate(urls)]


# =============================================================================
# Citation Filtering Functions
# =============================================================================

def filter_by_domain_type(
    citations: list[Citation],
    domain_type: str
) -> list[Citation]:
    """
    Filter citations by domain type.

    Args:
        citations: List of Citation objects
        domain_type: One of 'academic', 'news', 'official', 'all'

    Returns:
        Filtered list of citations
    """
    academic_indicators = ['.edu', 'arxiv.org', 'pubmed', 'nature.com',
                          'science.org', 'ieee.org', 'acm.org', 'springer']
    news_indicators = ['techcrunch', 'theverge', 'wired', 'cnn', 'bbc',
                      'reuters', 'bloomberg', 'nytimes']
    official_indicators = ['.gov', '.mil', 'who.int', 'un.org']

    if domain_type == 'all':
        return citations

    filtered = []
    for citation in citations:
        domain_lower = citation.domain.lower()

        if domain_type == 'academic':
            if any(ind in domain_lower for ind in academic_indicators):
                filtered.append(citation)
        elif domain_type == 'news':
            if any(ind in domain_lower for ind in news_indicators):
                filtered.append(citation)
        elif domain_type == 'official':
            if any(ind in domain_lower for ind in official_indicators):
                filtered.append(citation)

    return filtered


def filter_by_domains(
    citations: list[Citation],
    allowed_domains: list[str] = None,
    blocked_domains: list[str] = None
) -> list[Citation]:
    """
    Filter citations by specific domain lists.

    Args:
        citations: List of Citation objects
        allowed_domains: Only include these domains (if provided)
        blocked_domains: Exclude these domains

    Returns:
        Filtered list of citations
    """
    allowed = allowed_domains or []
    blocked = blocked_domains or []

    filtered = []
    for citation in citations:
        domain_lower = citation.domain.lower()

        # Skip blocked domains
        if any(bd.lower() in domain_lower for bd in blocked):
            continue

        # If allowed list provided, check it
        if allowed:
            if any(ad.lower() in domain_lower for ad in allowed):
                filtered.append(citation)
        else:
            filtered.append(citation)

    return filtered


# =============================================================================
# Citation Formatting Functions
# =============================================================================

def format_citations_numbered(citations: list[Citation]) -> str:
    """Format citations as numbered list."""
    if not citations:
        return "No citations available."

    lines = ["Sources:"]
    for citation in citations:
        lines.append(f"  [{citation.index}] {citation.url}")

    return "\n".join(lines)


def format_citations_markdown(citations: list[Citation]) -> str:
    """Format citations as markdown list."""
    if not citations:
        return "*No citations available.*"

    lines = ["## Sources\n"]
    for citation in citations:
        domain = citation.domain
        lines.append(f"- [{domain}]({citation.url})")

    return "\n".join(lines)


def format_citations_academic(citations: list[Citation]) -> str:
    """Format citations in academic style."""
    if not citations:
        return "No references."

    lines = ["References:\n"]
    for citation in citations:
        lines.append(f"  [{citation.index}] Retrieved from {citation.url}")

    return "\n".join(lines)


def format_response_with_footnotes(content: str, citations: list[Citation]) -> str:
    """
    Format response with footnote-style citations at the end.

    Args:
        content: Response content
        citations: List of Citation objects

    Returns:
        Formatted string with content and footnotes
    """
    output = content

    if citations:
        output += "\n\n" + "-" * 40 + "\n"
        output += format_citations_numbered(citations)

    return output


# =============================================================================
# Main Search Function with Citations
# =============================================================================

def search_with_citations(
    query: str,
    client: Optional[OpenAI] = None,
    model: str = "sonar-pro"
) -> SearchResult:
    """
    Perform search and return structured result with citations.

    Args:
        query: Search query
        client: Optional pre-configured client
        model: Model to use (sonar-pro recommended for better citations)

    Returns:
        SearchResult with content and structured citations
    """
    if client is None:
        client = create_client()

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "Provide well-sourced answers. Cite your sources."},
            {"role": "user", "content": query}
        ],
        max_tokens=1500,
        temperature=0.2
    )

    content = response.choices[0].message.content
    raw_urls = extract_citations(response)
    structured_citations = create_structured_citations(raw_urls)
    inline_refs = parse_inline_citations(content)

    return SearchResult(
        content=content,
        citations=structured_citations,
        raw_urls=raw_urls,
        inline_refs=inline_refs
    )


# =============================================================================
# Example 1: Basic Citation Extraction
# =============================================================================

def example_basic_citations() -> None:
    """Demonstrate basic citation extraction."""
    print_subheader("Basic Citation Extraction")

    client = create_client()
    query = "What are the health benefits of green tea?"

    print(f"Query: {query}\n")

    result = search_with_citations(query, client)

    print("Response:")
    print(result.content)

    print(f"\n{format_citations_numbered(result.citations)}")
    print(f"\nInline references found: {len(result.inline_refs)}")


# =============================================================================
# Example 2: Citation Filtering by Type
# =============================================================================

def example_citation_filtering() -> None:
    """Demonstrate filtering citations by domain type."""
    print_subheader("Citation Filtering by Type")

    client = create_client()
    query = "What does research say about sleep and cognitive function?"

    print(f"Query: {query}\n")

    result = search_with_citations(query, client)

    print(f"Total citations: {len(result.citations)}")

    # Filter by type
    academic = filter_by_domain_type(result.citations, 'academic')
    news = filter_by_domain_type(result.citations, 'news')
    official = filter_by_domain_type(result.citations, 'official')

    print(f"\nAcademic sources: {len(academic)}")
    for c in academic:
        print(f"  - {c.domain}")

    print(f"\nNews sources: {len(news)}")
    for c in news:
        print(f"  - {c.domain}")

    print(f"\nOfficial sources: {len(official)}")
    for c in official:
        print(f"  - {c.domain}")


# =============================================================================
# Example 3: Custom Domain Filtering
# =============================================================================

def example_custom_domain_filter() -> None:
    """Demonstrate custom domain filtering."""
    print_subheader("Custom Domain Filtering")

    client = create_client()
    query = "Latest developments in AI research"

    print(f"Query: {query}\n")

    result = search_with_citations(query, client)

    # Filter to specific trusted domains
    trusted = filter_by_domains(
        result.citations,
        allowed_domains=['arxiv.org', 'openai.com', 'anthropic.com', 'deepmind.com']
    )

    # Filter out certain domains
    no_social = filter_by_domains(
        result.citations,
        blocked_domains=['twitter.com', 'reddit.com', 'facebook.com']
    )

    print(f"All citations: {len(result.citations)}")
    print(f"Trusted AI sources only: {len(trusted)}")
    print(f"Excluding social media: {len(no_social)}")

    if trusted:
        print("\nTrusted sources:")
        for c in trusted:
            print(f"  [{c.index}] {c.url}")


# =============================================================================
# Example 4: Format Styles
# =============================================================================

def example_format_styles() -> None:
    """Demonstrate different citation format styles."""
    print_subheader("Citation Format Styles")

    client = create_client()
    query = "What is CRISPR gene editing?"

    result = search_with_citations(query, client)

    print("Response (truncated):")
    print(result.content[:300] + "...\n")

    print("=" * 40)
    print("Numbered Format:")
    print("=" * 40)
    print(format_citations_numbered(result.citations))

    print("\n" + "=" * 40)
    print("Markdown Format:")
    print("=" * 40)
    print(format_citations_markdown(result.citations))

    print("\n" + "=" * 40)
    print("Academic Format:")
    print("=" * 40)
    print(format_citations_academic(result.citations))


# =============================================================================
# Example 5: Citation Aggregation
# =============================================================================

class CitationAggregator:
    """Aggregate citations across multiple searches."""

    def __init__(self):
        self.all_citations: dict[str, Citation] = {}  # URL -> Citation
        self.queries: list[str] = []

    def add_result(self, result: SearchResult, query: str) -> None:
        """Add citations from a search result."""
        self.queries.append(query)
        for citation in result.citations:
            if citation.url not in self.all_citations:
                self.all_citations[citation.url] = citation

    def get_unique_citations(self) -> list[Citation]:
        """Get all unique citations."""
        return list(self.all_citations.values())

    def get_domain_summary(self) -> dict[str, int]:
        """Get count of citations by domain."""
        summary: dict[str, int] = {}
        for citation in self.all_citations.values():
            domain = citation.domain
            summary[domain] = summary.get(domain, 0) + 1
        return dict(sorted(summary.items(), key=lambda x: x[1], reverse=True))


def example_citation_aggregation() -> None:
    """Demonstrate aggregating citations across searches."""
    print_subheader("Citation Aggregation")

    client = create_client()
    aggregator = CitationAggregator()

    queries = [
        "What is machine learning?",
        "What is deep learning?",
        "How do neural networks work?"
    ]

    print("Running multiple related queries...\n")

    for query in queries:
        print(f"Query: {query}")
        result = search_with_citations(query, client, model="sonar")
        aggregator.add_result(result, query)
        print(f"  Found {len(result.citations)} citations")

    unique = aggregator.get_unique_citations()
    domain_summary = aggregator.get_domain_summary()

    print(f"\n--- Aggregation Summary ---")
    print(f"Queries: {len(aggregator.queries)}")
    print(f"Unique citations: {len(unique)}")
    print(f"Unique domains: {len(domain_summary)}")

    print("\nTop domains:")
    for domain, count in list(domain_summary.items())[:5]:
        print(f"  {domain}: {count}")


# =============================================================================
# Example 6: Inline Citation Mapping
# =============================================================================

def example_inline_citation_mapping() -> None:
    """Demonstrate mapping inline references to URLs."""
    print_subheader("Inline Citation Mapping")

    client = create_client()
    query = "What are the environmental impacts of electric vehicles?"

    result = search_with_citations(query, client)

    print("Response with inline citations:")
    print(result.content[:500] + "...\n")

    if result.inline_refs:
        print(f"Found {len(result.inline_refs)} inline references:")
        for ref_idx, position in result.inline_refs[:5]:
            # Find the citation URL
            if ref_idx <= len(result.citations):
                citation = result.citations[ref_idx - 1]
                print(f"  [{ref_idx}] at position {position} -> {citation.domain}")
    else:
        print("No inline references found in response text.")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all citation examples."""
    print_header("Perplexity Sonar Citations Examples")

    try:
        example_basic_citations()
        example_citation_filtering()
        example_custom_domain_filter()
        example_format_styles()
        example_citation_aggregation()
        example_inline_citation_mapping()

        print_header("All Citation Examples Complete")

    except ValueError as e:
        print(f"\nConfiguration Error: {e}")
        print("Please set PERPLEXITY_API_KEY environment variable")
    except Exception as e:
        print(f"\nError: {e}")
        raise


if __name__ == "__main__":
    main()
