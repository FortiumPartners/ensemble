#!/usr/bin/env python3
"""
Embeddings Example

This example demonstrates OpenAI's Embeddings API:
- Generating text embeddings
- Batch processing
- Cosine similarity calculation
- Semantic search

Usage:
    python embeddings.example.py
"""

import os
import logging
from typing import List, Tuple

import numpy as np
from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Helper Functions
# =============================================================================

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    a_arr = np.array(a)
    b_arr = np.array(b)

    dot_product = np.dot(a_arr, b_arr)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return float(dot_product / (norm_a * norm_b))


def euclidean_distance(a: List[float], b: List[float]) -> float:
    """Calculate Euclidean distance between two vectors."""
    a_arr = np.array(a)
    b_arr = np.array(b)
    return float(np.linalg.norm(a_arr - b_arr))


# =============================================================================
# Embeddings Examples
# =============================================================================

def single_embedding_example():
    """Generate embedding for a single text."""
    print("\n=== Single Embedding ===\n")

    client = OpenAI()

    text = "Machine learning is a subset of artificial intelligence."

    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )

    embedding = response.data[0].embedding

    print(f"Text: {text}")
    print(f"Embedding dimensions: {len(embedding)}")
    print(f"First 5 values: {embedding[:5]}")
    print(f"Usage: {response.usage.total_tokens} tokens")


def batch_embedding_example():
    """Generate embeddings for multiple texts."""
    print("\n=== Batch Embeddings ===\n")

    client = OpenAI()

    texts = [
        "Python is a programming language.",
        "JavaScript runs in web browsers.",
        "Machine learning uses statistical methods.",
        "Cloud computing provides on-demand resources.",
    ]

    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )

    print(f"Generated {len(response.data)} embeddings")
    print(f"Total tokens used: {response.usage.total_tokens}")

    for i, item in enumerate(response.data):
        print(f"  Text {i + 1}: {len(item.embedding)} dimensions")


def dimension_reduction_example():
    """Demonstrate dimension reduction with v3 models."""
    print("\n=== Dimension Reduction ===\n")

    client = OpenAI()

    text = "Artificial intelligence is transforming industries."

    # Full dimensions
    response_full = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    full_dims = len(response_full.data[0].embedding)

    # Reduced dimensions
    response_reduced = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
        dimensions=256
    )
    reduced_dims = len(response_reduced.data[0].embedding)

    print(f"Full dimensions: {full_dims}")
    print(f"Reduced dimensions: {reduced_dims}")
    print(f"Reduction: {100 * (1 - reduced_dims / full_dims):.1f}%")


def similarity_example():
    """Compare similarity between texts."""
    print("\n=== Similarity Comparison ===\n")

    client = OpenAI()

    texts = [
        "I love programming in Python.",
        "Python is my favorite programming language.",
        "I enjoy cooking Italian food.",
        "The weather is nice today.",
    ]

    # Generate embeddings for all texts
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )

    embeddings = [item.embedding for item in response.data]

    # Compare first text with all others
    base_text = texts[0]
    base_embedding = embeddings[0]

    print(f"Comparing similarities to: \"{base_text}\"\n")

    for i in range(1, len(texts)):
        similarity = cosine_similarity(base_embedding, embeddings[i])
        print(f"  \"{texts[i]}\"")
        print(f"  Similarity: {similarity:.4f}\n")


def semantic_search_example():
    """Demonstrate semantic search."""
    print("\n=== Semantic Search ===\n")

    client = OpenAI()

    # Document corpus
    documents = [
        "Python is a high-level programming language known for its readability.",
        "Machine learning algorithms can learn patterns from data.",
        "Web development involves creating websites and web applications.",
        "Data science combines statistics, programming, and domain expertise.",
        "Cloud computing delivers computing services over the internet.",
        "Artificial intelligence simulates human intelligence in machines.",
        "Cybersecurity protects systems and networks from digital attacks.",
        "DevOps combines software development and IT operations.",
    ]

    # Generate document embeddings
    print("Indexing documents...")
    doc_response = client.embeddings.create(
        model="text-embedding-3-small",
        input=documents
    )
    doc_embeddings = [item.embedding for item in doc_response.data]

    # Search queries
    queries = [
        "How do computers learn from data?",
        "What is Python used for?",
        "How to protect against hackers?",
    ]

    for query in queries:
        print(f"\nQuery: \"{query}\"")
        print("-" * 50)

        # Generate query embedding
        query_response = client.embeddings.create(
            model="text-embedding-3-small",
            input=query
        )
        query_embedding = query_response.data[0].embedding

        # Calculate similarities
        similarities: List[Tuple[int, float]] = []
        for i, doc_embedding in enumerate(doc_embeddings):
            score = cosine_similarity(query_embedding, doc_embedding)
            similarities.append((i, score))

        # Sort by similarity
        similarities.sort(key=lambda x: x[1], reverse=True)

        # Show top 3 results
        print("Top 3 results:")
        for rank, (idx, score) in enumerate(similarities[:3], 1):
            print(f"  {rank}. (score: {score:.4f}) {documents[idx]}")


def clustering_example():
    """Demonstrate simple clustering with embeddings."""
    print("\n=== Embedding Clustering ===\n")

    client = OpenAI()

    # Texts in different categories
    texts = [
        # Programming
        "Python is great for data analysis.",
        "JavaScript powers interactive websites.",
        "Rust provides memory safety.",
        # Food
        "Pizza is a popular Italian dish.",
        "Sushi originated in Japan.",
        "Tacos are a Mexican favorite.",
        # Sports
        "Soccer is the world's most popular sport.",
        "Basketball was invented in 1891.",
        "Tennis requires agility and precision.",
    ]

    categories = ["Programming"] * 3 + ["Food"] * 3 + ["Sports"] * 3

    # Generate embeddings
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    embeddings = [item.embedding for item in response.data]

    print("Cross-category similarities:\n")

    # Calculate average similarity within and across categories
    for i in range(3):  # 3 categories
        for j in range(i, 3):
            cat_i_texts = range(i * 3, i * 3 + 3)
            cat_j_texts = range(j * 3, j * 3 + 3)

            similarities = []
            for ti in cat_i_texts:
                for tj in cat_j_texts:
                    if ti != tj:
                        sim = cosine_similarity(embeddings[ti], embeddings[tj])
                        similarities.append(sim)

            avg_sim = np.mean(similarities) if similarities else 0
            cat_names = [categories[i * 3], categories[j * 3]]

            if i == j:
                print(f"  Within {cat_names[0]}: {avg_sim:.4f}")
            else:
                print(f"  {cat_names[0]} <-> {cat_names[1]}: {avg_sim:.4f}")


def model_comparison_example():
    """Compare different embedding models."""
    print("\n=== Model Comparison ===\n")

    client = OpenAI()

    text = "Deep learning is revolutionizing computer vision."

    models = [
        ("text-embedding-3-small", None),
        ("text-embedding-3-large", None),
        ("text-embedding-3-large", 256),  # With dimension reduction
    ]

    for model, dims in models:
        kwargs = {"model": model, "input": text}
        if dims:
            kwargs["dimensions"] = dims

        response = client.embeddings.create(**kwargs)
        embedding = response.data[0].embedding

        model_name = f"{model}" + (f" (dims={dims})" if dims else "")
        print(f"{model_name}")
        print(f"  Dimensions: {len(embedding)}")
        print(f"  Tokens used: {response.usage.total_tokens}")
        print()


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Embeddings Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        return

    try:
        single_embedding_example()
        batch_embedding_example()
        dimension_reduction_example()
        similarity_example()
        semantic_search_example()
        clustering_example()
        model_comparison_example()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All embedding examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
