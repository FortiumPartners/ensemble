#!/usr/bin/env python3
"""
OpenAI Embeddings Template

This template provides embeddings generation and similarity search
implementations for semantic applications.

Placeholders:
- {{model}} - Embedding model (e.g., "text-embedding-3-small")
- {{dimensions}} - Optional dimension count for reduction

Usage:
    python embeddings.py "search query" --documents docs.json
"""

import json
import sys
import logging
from typing import List, Optional, Tuple
from dataclasses import dataclass

import numpy as np
from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{model}}"
DIMENSIONS = {{dimensions}}  # Set to None for default dimensions


@dataclass
class EmbeddingResult:
    """Result of an embedding operation."""
    text: str
    embedding: List[float]
    model: str
    dimensions: int


@dataclass
class SearchResult:
    """Result of a similarity search."""
    text: str
    score: float
    index: int


class EmbeddingsClient:
    """OpenAI Embeddings client with similarity search."""

    def __init__(
        self,
        model: str = MODEL,
        dimensions: Optional[int] = DIMENSIONS
    ):
        """Initialize the embeddings client.

        Args:
            model: OpenAI embedding model ID
            dimensions: Optional dimension reduction (for v3 models)
        """
        self.client = OpenAI()
        self.model = model
        self.dimensions = dimensions

    def embed(self, text: str) -> EmbeddingResult:
        """Generate embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            EmbeddingResult with embedding vector
        """
        logger.info(f"Generating embedding for text ({len(text)} chars)")

        kwargs = {
            "model": self.model,
            "input": text
        }

        if self.dimensions:
            kwargs["dimensions"] = self.dimensions

        response = self.client.embeddings.create(**kwargs)

        embedding = response.data[0].embedding

        logger.info(f"Generated embedding with {len(embedding)} dimensions")

        return EmbeddingResult(
            text=text,
            embedding=embedding,
            model=self.model,
            dimensions=len(embedding)
        )

    def embed_batch(self, texts: List[str]) -> List[EmbeddingResult]:
        """Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed

        Returns:
            List of EmbeddingResults
        """
        logger.info(f"Generating embeddings for {len(texts)} texts")

        kwargs = {
            "model": self.model,
            "input": texts
        }

        if self.dimensions:
            kwargs["dimensions"] = self.dimensions

        response = self.client.embeddings.create(**kwargs)

        results = []
        for i, item in enumerate(response.data):
            results.append(EmbeddingResult(
                text=texts[i],
                embedding=item.embedding,
                model=self.model,
                dimensions=len(item.embedding)
            ))

        logger.info(f"Generated {len(results)} embeddings")

        return results

    @staticmethod
    def cosine_similarity(a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity between two vectors.

        Args:
            a: First vector
            b: Second vector

        Returns:
            Cosine similarity score (-1 to 1)
        """
        a_arr = np.array(a)
        b_arr = np.array(b)

        dot_product = np.dot(a_arr, b_arr)
        norm_a = np.linalg.norm(a_arr)
        norm_b = np.linalg.norm(b_arr)

        if norm_a == 0 or norm_b == 0:
            return 0.0

        return float(dot_product / (norm_a * norm_b))

    def search(
        self,
        query: str,
        documents: List[str],
        document_embeddings: Optional[List[List[float]]] = None,
        top_k: int = 5
    ) -> List[SearchResult]:
        """Search for similar documents.

        Args:
            query: Search query
            documents: List of document texts
            document_embeddings: Pre-computed embeddings (optional)
            top_k: Number of results to return

        Returns:
            List of SearchResults sorted by similarity
        """
        # Generate query embedding
        query_result = self.embed(query)

        # Generate document embeddings if not provided
        if document_embeddings is None:
            doc_results = self.embed_batch(documents)
            document_embeddings = [r.embedding for r in doc_results]

        # Calculate similarities
        similarities: List[Tuple[int, float]] = []
        for i, doc_embedding in enumerate(document_embeddings):
            score = self.cosine_similarity(query_result.embedding, doc_embedding)
            similarities.append((i, score))

        # Sort by similarity (descending)
        similarities.sort(key=lambda x: x[1], reverse=True)

        # Return top-k results
        results = []
        for i, score in similarities[:top_k]:
            results.append(SearchResult(
                text=documents[i],
                score=score,
                index=i
            ))

        return results


class EmbeddingsStore:
    """Simple in-memory embeddings store for semantic search."""

    def __init__(self, client: Optional[EmbeddingsClient] = None):
        """Initialize the store.

        Args:
            client: EmbeddingsClient instance (creates new if None)
        """
        self.client = client or EmbeddingsClient()
        self.documents: List[str] = []
        self.embeddings: List[List[float]] = []

    def add(self, text: str) -> int:
        """Add a document to the store.

        Args:
            text: Document text

        Returns:
            Index of the added document
        """
        result = self.client.embed(text)
        self.documents.append(text)
        self.embeddings.append(result.embedding)
        return len(self.documents) - 1

    def add_batch(self, texts: List[str]) -> List[int]:
        """Add multiple documents to the store.

        Args:
            texts: List of document texts

        Returns:
            List of indices for added documents
        """
        results = self.client.embed_batch(texts)
        start_index = len(self.documents)

        for result in results:
            self.documents.append(result.text)
            self.embeddings.append(result.embedding)

        return list(range(start_index, len(self.documents)))

    def search(self, query: str, top_k: int = 5) -> List[SearchResult]:
        """Search for similar documents.

        Args:
            query: Search query
            top_k: Number of results

        Returns:
            List of SearchResults
        """
        return self.client.search(
            query=query,
            documents=self.documents,
            document_embeddings=self.embeddings,
            top_k=top_k
        )

    def save(self, filepath: str) -> None:
        """Save store to JSON file.

        Args:
            filepath: Output file path
        """
        data = {
            "documents": self.documents,
            "embeddings": self.embeddings
        }
        with open(filepath, "w") as f:
            json.dump(data, f)
        logger.info(f"Saved {len(self.documents)} documents to {filepath}")

    def load(self, filepath: str) -> None:
        """Load store from JSON file.

        Args:
            filepath: Input file path
        """
        with open(filepath, "r") as f:
            data = json.load(f)
        self.documents = data["documents"]
        self.embeddings = data["embeddings"]
        logger.info(f"Loaded {len(self.documents)} documents from {filepath}")


def main():
    """Main entry point for CLI usage."""
    import argparse

    parser = argparse.ArgumentParser(description="OpenAI Embeddings CLI")
    parser.add_argument("query", help="Search query or text to embed")
    parser.add_argument(
        "--documents",
        help="JSON file with documents array",
        default=None
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of results to return"
    )
    parser.add_argument(
        "--embed-only",
        action="store_true",
        help="Only generate embedding, don't search"
    )

    args = parser.parse_args()

    client = EmbeddingsClient()

    if args.embed_only:
        # Just generate embedding
        result = client.embed(args.query)
        print(f"Dimensions: {result.dimensions}")
        print(f"Embedding (first 10): {result.embedding[:10]}")
        return

    if args.documents:
        # Load documents and search
        with open(args.documents, "r") as f:
            documents = json.load(f)

        results = client.search(args.query, documents, top_k=args.top_k)

        print(f"\nTop {len(results)} results for: '{args.query}'\n")
        for i, result in enumerate(results, 1):
            print(f"{i}. (score: {result.score:.4f})")
            print(f"   {result.text[:100]}...")
            print()
    else:
        print("No documents provided. Use --documents to specify a JSON file.")
        print("Or use --embed-only to just generate an embedding.")


if __name__ == "__main__":
    main()
