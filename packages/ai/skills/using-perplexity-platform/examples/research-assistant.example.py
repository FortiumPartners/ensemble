#!/usr/bin/env python3
"""
Perplexity Sonar Research Assistant Example

Demonstrates a complete research assistant workflow with Perplexity's Sonar API.

Requirements:
    pip install openai

Environment:
    export PERPLEXITY_API_KEY="pplx-..."
"""

import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from openai import OpenAI


@dataclass
class Citation:
    """Structured citation."""
    url: str
    domain: str
    query: str
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class ResearchFinding:
    """Individual research finding with citations."""
    query: str
    answer: str
    citations: list[Citation]
    model: str
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class ResearchReport:
    """Complete research report."""
    topic: str
    findings: list[ResearchFinding]
    summary: str
    all_citations: list[Citation]
    created_at: datetime = field(default_factory=datetime.now)


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
# Research Assistant Class
# =============================================================================

class ResearchAssistant:
    """
    AI-powered research assistant using Perplexity Sonar.

    Conducts multi-step research, aggregates findings,
    and generates comprehensive reports with citations.
    """

    def __init__(
        self,
        focus_area: str = "general",
        model: str = "sonar-pro"
    ):
        """
        Initialize research assistant.

        Args:
            focus_area: Research focus (e.g., 'technology', 'science', 'business')
            model: Perplexity model to use
        """
        self.client = create_client()
        self.focus_area = focus_area
        self.model = model
        self.findings: list[ResearchFinding] = []
        self.conversation_history: list[dict] = []

        # Set up system prompt based on focus area
        self.system_prompt = self._get_system_prompt()

    def _get_system_prompt(self) -> str:
        """Get system prompt based on focus area."""
        base = "You are an expert research assistant. "

        focus_prompts = {
            "technology": base + "Focus on technology trends, innovations, and industry analysis. Cite authoritative tech sources.",
            "science": base + "Focus on scientific research and peer-reviewed findings. Prioritize academic sources like journals and research institutions.",
            "business": base + "Focus on business analysis, market trends, and financial data. Cite reputable business publications.",
            "medical": base + "Focus on medical and health research. Prioritize peer-reviewed medical journals and official health organizations.",
            "general": base + "Provide comprehensive, well-sourced information. Balance depth with clarity."
        }

        return focus_prompts.get(self.focus_area, focus_prompts["general"])

    def research(
        self,
        query: str,
        depth: str = "standard"
    ) -> ResearchFinding:
        """
        Conduct research on a specific query.

        Args:
            query: Research question
            depth: 'quick', 'standard', or 'deep'

        Returns:
            ResearchFinding with answer and citations
        """
        # Adjust tokens based on depth
        max_tokens = {"quick": 500, "standard": 1000, "deep": 2000}.get(depth, 1000)

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": query}
            ],
            max_tokens=max_tokens,
            temperature=0.2
        )

        content = response.choices[0].message.content

        # Extract citations
        raw_urls = getattr(response, 'citations', []) or []
        citations = [
            Citation(
                url=url,
                domain=urlparse(url).netloc,
                query=query
            )
            for url in raw_urls
        ]

        finding = ResearchFinding(
            query=query,
            answer=content,
            citations=citations,
            model=response.model
        )

        self.findings.append(finding)
        return finding

    def follow_up(self, question: str) -> ResearchFinding:
        """
        Ask a follow-up question based on previous research.

        Args:
            question: Follow-up question

        Returns:
            ResearchFinding with answer and citations
        """
        # Build context from previous findings
        context = "Based on our previous research:\n\n"
        for i, finding in enumerate(self.findings[-3:], 1):  # Last 3 findings
            context += f"{i}. Q: {finding.query}\n"
            context += f"   A: {finding.answer[:200]}...\n\n"

        full_query = f"{context}\nFollow-up question: {question}"

        return self.research(full_query, depth="standard")

    def generate_summary(self) -> str:
        """
        Generate a summary of all research findings.

        Returns:
            Summary text
        """
        if not self.findings:
            return "No research has been conducted yet."

        # Create summary prompt
        findings_text = "\n\n".join([
            f"Q: {f.query}\nA: {f.answer[:500]}..."
            for f in self.findings
        ])

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a research summarizer. Create concise, informative summaries."},
                {"role": "user", "content": f"Summarize these research findings:\n\n{findings_text}"}
            ],
            max_tokens=800,
            temperature=0.3
        )

        return response.choices[0].message.content

    def get_all_citations(self) -> list[Citation]:
        """Get all unique citations from research."""
        all_citations = []
        seen_urls = set()

        for finding in self.findings:
            for citation in finding.citations:
                if citation.url not in seen_urls:
                    seen_urls.add(citation.url)
                    all_citations.append(citation)

        return all_citations

    def generate_report(self, topic: str) -> ResearchReport:
        """
        Generate a complete research report.

        Args:
            topic: Report topic/title

        Returns:
            ResearchReport object
        """
        summary = self.generate_summary()
        all_citations = self.get_all_citations()

        return ResearchReport(
            topic=topic,
            findings=self.findings.copy(),
            summary=summary,
            all_citations=all_citations
        )

    def clear(self) -> None:
        """Clear all research findings."""
        self.findings = []
        self.conversation_history = []


# =============================================================================
# Report Formatting
# =============================================================================

def format_report_text(report: ResearchReport) -> str:
    """Format report as plain text."""
    lines = [
        "=" * 60,
        f"RESEARCH REPORT: {report.topic}",
        "=" * 60,
        f"Generated: {report.created_at.strftime('%Y-%m-%d %H:%M')}",
        f"Findings: {len(report.findings)}",
        f"Sources: {len(report.all_citations)}",
        "",
        "-" * 60,
        "EXECUTIVE SUMMARY",
        "-" * 60,
        report.summary,
        "",
        "-" * 60,
        "DETAILED FINDINGS",
        "-" * 60,
    ]

    for i, finding in enumerate(report.findings, 1):
        lines.extend([
            f"\n{i}. {finding.query}",
            "-" * 40,
            finding.answer[:500] + ("..." if len(finding.answer) > 500 else ""),
            f"[{len(finding.citations)} sources]",
        ])

    lines.extend([
        "",
        "-" * 60,
        "ALL SOURCES",
        "-" * 60,
    ])

    for i, citation in enumerate(report.all_citations, 1):
        lines.append(f"[{i}] {citation.url}")

    return "\n".join(lines)


def format_report_markdown(report: ResearchReport) -> str:
    """Format report as markdown."""
    lines = [
        f"# Research Report: {report.topic}",
        "",
        f"*Generated: {report.created_at.strftime('%Y-%m-%d %H:%M')}*",
        "",
        "## Executive Summary",
        "",
        report.summary,
        "",
        "## Detailed Findings",
        "",
    ]

    for i, finding in enumerate(report.findings, 1):
        lines.extend([
            f"### {i}. {finding.query}",
            "",
            finding.answer,
            "",
            f"*Sources: {len(finding.citations)}*",
            "",
        ])

    lines.extend([
        "## References",
        "",
    ])

    for i, citation in enumerate(report.all_citations, 1):
        lines.append(f"{i}. [{citation.domain}]({citation.url})")

    return "\n".join(lines)


# =============================================================================
# Example 1: Basic Research Session
# =============================================================================

def example_basic_research() -> None:
    """Demonstrate basic research session."""
    print_subheader("Basic Research Session")

    assistant = ResearchAssistant(focus_area="technology")

    # Conduct research
    print("Researching: AI trends in 2024...")
    finding = assistant.research(
        "What are the major AI trends and breakthroughs in 2024?",
        depth="standard"
    )

    print(f"\nAnswer (preview):")
    print(finding.answer[:400] + "...")
    print(f"\nSources: {len(finding.citations)}")
    for c in finding.citations[:3]:
        print(f"  - {c.domain}")


# =============================================================================
# Example 2: Multi-Step Research
# =============================================================================

def example_multi_step_research() -> None:
    """Demonstrate multi-step research with follow-ups."""
    print_subheader("Multi-Step Research")

    assistant = ResearchAssistant(focus_area="science")

    queries = [
        "What is CRISPR gene editing?",
        "What are the latest applications of CRISPR in medicine?",
        "What are the ethical concerns around CRISPR?"
    ]

    for query in queries:
        print(f"\nResearching: {query}")
        finding = assistant.research(query, depth="standard")
        print(f"  Found {len(finding.citations)} sources")
        print(f"  Preview: {finding.answer[:150]}...")

    # Generate summary
    print("\n" + "-" * 40)
    print("Generating research summary...")
    summary = assistant.generate_summary()
    print(f"\nSummary:\n{summary}")


# =============================================================================
# Example 3: Complete Research Report
# =============================================================================

def example_full_report() -> None:
    """Demonstrate generating a complete research report."""
    print_subheader("Full Research Report")

    assistant = ResearchAssistant(focus_area="business", model="sonar-pro")

    # Research topic
    topic = "The Future of Electric Vehicles"

    research_questions = [
        "What is the current market share of electric vehicles globally?",
        "Who are the leading EV manufacturers and what are their strategies?",
        "What are the main challenges facing EV adoption?"
    ]

    print(f"Researching: {topic}\n")

    for query in research_questions:
        print(f"  Querying: {query[:50]}...")
        assistant.research(query, depth="standard")

    # Generate report
    print("\nGenerating full report...")
    report = assistant.generate_report(topic)

    # Display report
    print("\n" + format_report_text(report))


# =============================================================================
# Example 4: Specialized Research Focus
# =============================================================================

def example_specialized_focus() -> None:
    """Demonstrate specialized research focus areas."""
    print_subheader("Specialized Research Focus")

    focus_areas = ["technology", "science", "medical"]

    query = "What are the latest breakthroughs in artificial intelligence?"

    for focus in focus_areas:
        print(f"\n--- Focus: {focus.upper()} ---")

        assistant = ResearchAssistant(focus_area=focus, model="sonar")
        finding = assistant.research(query, depth="quick")

        print(f"Answer preview: {finding.answer[:200]}...")
        print(f"Sources: {[c.domain for c in finding.citations[:3]]}")


# =============================================================================
# Example 5: Research with Follow-ups
# =============================================================================

def example_follow_up_research() -> None:
    """Demonstrate follow-up questions in research."""
    print_subheader("Research with Follow-ups")

    assistant = ResearchAssistant(focus_area="technology")

    # Initial research
    print("Initial query: What is quantum computing?")
    finding1 = assistant.research("What is quantum computing?", depth="standard")
    print(f"  Answer: {finding1.answer[:200]}...")

    # Follow-up questions
    follow_ups = [
        "What are its practical applications?",
        "Which companies are leading in this field?",
        "What are the current limitations?"
    ]

    for follow_up in follow_ups:
        print(f"\nFollow-up: {follow_up}")
        finding = assistant.follow_up(follow_up)
        print(f"  Answer: {finding.answer[:150]}...")

    # Summary
    all_citations = assistant.get_all_citations()
    print(f"\n--- Session Summary ---")
    print(f"Total queries: {len(assistant.findings)}")
    print(f"Unique sources: {len(all_citations)}")


# =============================================================================
# Example 6: Interactive Research Session
# =============================================================================

def example_interactive_session() -> None:
    """Demonstrate an interactive-style research session."""
    print_subheader("Interactive Research Session (Simulated)")

    assistant = ResearchAssistant(focus_area="general", model="sonar")

    # Simulate an interactive session
    session = [
        ("user", "I'm researching renewable energy. What are the main types?"),
        ("assistant", None),  # Will be filled
        ("user", "Which one is growing the fastest?"),
        ("assistant", None),
        ("user", "What are the main challenges for solar energy specifically?"),
        ("assistant", None),
    ]

    print("Simulating interactive research session...\n")

    for role, content in session:
        if role == "user":
            print(f"User: {content}")
            finding = assistant.research(content, depth="quick")
            print(f"Assistant: {finding.answer[:300]}...")
            print(f"[{len(finding.citations)} sources]\n")

    # Final summary
    report = assistant.generate_report("Renewable Energy Research")
    print(f"\n--- Session Complete ---")
    print(f"Questions answered: {len(report.findings)}")
    print(f"Total sources: {len(report.all_citations)}")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all research assistant examples."""
    print_header("Perplexity Sonar Research Assistant Examples")

    try:
        example_basic_research()
        example_multi_step_research()
        example_specialized_focus()
        example_follow_up_research()
        example_interactive_session()

        # Full report takes longer, run last
        example_full_report()

        print_header("All Research Examples Complete")

    except ValueError as e:
        print(f"\nConfiguration Error: {e}")
        print("Please set PERPLEXITY_API_KEY environment variable")
    except Exception as e:
        print(f"\nError: {e}")
        raise


if __name__ == "__main__":
    main()
