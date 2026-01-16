# Weaviate Reference Documentation

**Comprehensive API reference, advanced patterns, and production configuration**

> This file complements SKILL.md with detailed documentation. Load when you need:
> - All vectorizer and generative modules
> - Index configuration and compression
> - Production deployment patterns
> - Advanced query patterns and aggregations
> - Complete error handling

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Deployment Options](#deployment-options)
3. [Property Data Types](#property-data-types)
4. [Vectorizer Modules](#vectorizer-modules)
5. [Index Configuration](#index-configuration)
6. [Vector Compression](#vector-compression)
7. [Advanced Data Operations](#advanced-data-operations)
8. [Advanced Search Patterns](#advanced-search-patterns)
9. [Aggregations](#aggregations)
10. [Generative Modules](#generative-modules)
11. [Reranking](#reranking)
12. [Multi-Tenancy Management](#multi-tenancy-management)
13. [Docker Configuration](#docker-configuration)
14. [Production Configuration](#production-configuration)
15. [Comprehensive Error Handling](#comprehensive-error-handling)
16. [Context7 Integration](#context7-integration)
17. [Integration Checklists](#integration-checklists)

---

## Platform Overview

### Platform Differentiators

| Feature | Weaviate | Description |
|---------|----------|-------------|
| Hybrid Search | Native | Combines vector + BM25 keyword search |
| Multi-tenancy | Built-in | Isolated tenant data with efficient storage |
| Vectorizer Modules | Pluggable | OpenAI, Cohere, Hugging Face, custom |
| Generative Modules | Built-in | RAG with GPT-4, Claude, etc. |
| Reranking | Native | Cross-encoder reranking for precision |
| GraphQL API | Primary | Flexible querying with filters |
| REST API | Full | CRUD operations, batch imports |
| gRPC API | Beta | High-performance streaming |
| HNSW Index | Default | Fast approximate nearest neighbor |
| Flat Index | Optional | Exact search for small datasets |
| Dynamic Index | Auto | Switches flat to HNSW as data grows |
| Product Quantization | Supported | Compress vectors for memory efficiency |
| Binary Quantization | Supported | 32x compression with minor recall loss |

### Pricing (Weaviate Cloud)

| Tier | Price | Description |
|------|-------|-------------|
| **Sandbox** | Free | 14-day trial, limited resources |
| **Serverless** | Pay-as-you-go | $0.095/1M dimensions stored |
| **Enterprise** | Custom | Dedicated resources, SLA, support |
| **Self-hosted** | Free | Open source, bring your own infra |

**Note**: Vectorization costs (OpenAI, Cohere) are separate from Weaviate storage costs.

**Disclaimer**: Pricing subject to change. Verify at [weaviate.io/pricing](https://weaviate.io/pricing) for current rates.

---

## Deployment Options

| Option | Description | Best For |
|--------|-------------|----------|
| **Weaviate Cloud (WCD)** | Fully managed service | Production, no ops overhead |
| **Docker** | Self-hosted single node | Development, small deployments |
| **Kubernetes** | Self-hosted cluster | Large scale, custom requirements |
| **Embedded** | In-process (Python only) | Testing, prototyping |

---

## Property Data Types

| Type | Python | Description |
|------|--------|-------------|
| `TEXT` | str | Tokenized text, searchable |
| `TEXT_ARRAY` | list[str] | Array of text values |
| `INT` | int | Integer numbers |
| `NUMBER` | float | Floating point |
| `BOOLEAN` | bool | True/False |
| `DATE` | datetime | ISO 8601 date |
| `UUID` | str | UUID reference |
| `BLOB` | bytes | Binary data (base64) |
| `GEO_COORDINATES` | dict | Latitude/longitude |
| `OBJECT` | dict | Nested object |
| `OBJECT_ARRAY` | list[dict] | Array of nested objects |

---

## Vectorizer Modules

```python
from weaviate.classes.config import Configure

# OpenAI (most common)
vectorizer = Configure.Vectorizer.text2vec_openai(
    model="text-embedding-3-small",  # or "text-embedding-3-large"
    dimensions=1536  # Optional: reduce dimensions
)

# Cohere
vectorizer = Configure.Vectorizer.text2vec_cohere(
    model="embed-english-v3.0"
)

# Hugging Face
vectorizer = Configure.Vectorizer.text2vec_huggingface(
    model="sentence-transformers/all-MiniLM-L6-v2"
)

# Local transformers (no API calls)
vectorizer = Configure.Vectorizer.text2vec_transformers()

# AWS Bedrock
vectorizer = Configure.Vectorizer.text2vec_aws(
    model="amazon.titan-embed-text-v1",
    region="us-east-1"
)

# Google Vertex AI
vectorizer = Configure.Vectorizer.text2vec_palm(
    project_id="your-project",
    model_id="textembedding-gecko"
)

# No vectorizer (bring your own vectors)
vectorizer = Configure.Vectorizer.none()
```

---

## Index Configuration

### HNSW Index (Default)

```python
from weaviate.classes.config import Configure, VectorDistances

client.collections.create(
    name="FastSearch",
    vectorizer_config=Configure.Vectorizer.text2vec_openai(),
    vector_index_config=Configure.VectorIndex.hnsw(
        distance_metric=VectorDistances.COSINE,  # or DOT, L2
        ef_construction=128,  # Build-time accuracy (default: 128)
        ef=64,                # Query-time accuracy (default: -1 = auto)
        max_connections=32    # Graph connectivity (default: 32)
    ),
    properties=[...]
)
```

### Flat Index (Small Datasets)

```python
# For small datasets (< 10K objects) - exact search
vector_index_config=Configure.VectorIndex.flat(
    distance_metric=VectorDistances.COSINE
)
```

### Dynamic Index

```python
# Starts flat, switches to HNSW at threshold
vector_index_config=Configure.VectorIndex.dynamic(
    threshold=10000,  # Switch to HNSW at this count
    hnsw=Configure.VectorIndex.hnsw(),
    flat=Configure.VectorIndex.flat()
)
```

---

## Vector Compression

### Binary Quantization (32x compression)

```python
from weaviate.classes.config import Configure

vector_index_config=Configure.VectorIndex.hnsw(
    quantizer=Configure.VectorIndex.Quantizer.bq()
)
```

### Product Quantization

```python
vector_index_config=Configure.VectorIndex.hnsw(
    quantizer=Configure.VectorIndex.Quantizer.pq(
        segments=128,
        centroids=256
    )
)
```

---

## Advanced Data Operations

### Insert with Custom Vector

```python
from weaviate.util import generate_uuid5

articles = client.collections.get("Article")

# With custom vector (BYOV)
uuid = articles.data.insert(
    properties={"title": "Custom Vector Example"},
    vector=[0.1, 0.2, 0.3, ...]  # Your embedding
)

# With specific UUID
uuid = articles.data.insert(
    uuid=generate_uuid5("unique-identifier"),
    properties={"title": "Deterministic UUID"}
)
```

### Insert Many (Simpler Alternative)

```python
articles = client.collections.get("Article")

data = [
    {"title": "Article 1", "content": "Content 1..."},
    {"title": "Article 2", "content": "Content 2..."},
]

response = articles.data.insert_many(data)

if response.has_errors:
    print(response.errors)
else:
    print("Insert complete.")
```

### Batch Insert with Custom Vectors

```python
from weaviate.classes.data import DataObject

documents = client.collections.get("Document")

items = [
    DataObject(
        properties={"text": "Document 1"},
        vector=[0.1, 0.2, ...]
    ),
    DataObject(
        properties={"text": "Document 2"},
        vector=[0.3, 0.4, ...]
    )
]

with documents.batch.dynamic() as batch:
    for item in items:
        batch.add_object(
            properties=item.properties,
            vector=item.vector
        )
```

### Replace Entire Object

```python
articles.data.replace(
    uuid="12345678-1234-1234-1234-123456789012",
    properties={
        "title": "New Title",
        "content": "New content...",
        "category": "Technology",
        "view_count": 0
    }
)
```

---

## Advanced Search Patterns

### Search with Custom Vector

```python
# Use your own query embedding
query_vector = [0.1, 0.2, 0.3, ...]  # From your embedding model

response = articles.query.near_vector(
    near_vector=query_vector,
    limit=10,
    return_metadata=MetadataQuery(distance=True)
)
```

### Keyword Search (BM25)

```python
response = articles.query.bm25(
    query="vector database performance",
    limit=10,
    return_metadata=MetadataQuery(score=True)
)
```

### Complex Filter Combinations

```python
from weaviate.classes.query import Filter

response = articles.query.hybrid(
    query="cloud computing",
    filters=(
        (Filter.by_property("category").equal("Technology") |
         Filter.by_property("category").equal("Business")) &
        Filter.by_property("published_at").greater_than("2024-01-01T00:00:00Z")
    ),
    limit=10
)
```

### All Filter Operators

| Operator | Usage | Description |
|----------|-------|-------------|
| `equal` | `.equal(value)` | Exact match |
| `not_equal` | `.not_equal(value)` | Not equal |
| `greater_than` | `.greater_than(value)` | > comparison |
| `greater_or_equal` | `.greater_or_equal(value)` | >= comparison |
| `less_than` | `.less_than(value)` | < comparison |
| `less_or_equal` | `.less_or_equal(value)` | <= comparison |
| `like` | `.like("pattern*")` | Wildcard match |
| `contains_any` | `.contains_any([...])` | Array contains any |
| `contains_all` | `.contains_all([...])` | Array contains all |
| `is_none` | `.is_none(True)` | Null check |

### Specify Return Properties

```python
response = collection.query.near_text(
    query="...",
    limit=100,
    return_properties=["title", "summary"]  # Only what you need
)
```

---

## Aggregations

```python
from weaviate.classes.aggregate import GroupByAggregate
from weaviate.classes.query import Filter

articles = client.collections.get("Article")

# Count by category
response = articles.aggregate.over_all(
    group_by=GroupByAggregate(prop="category")
)

for group in response.groups:
    print(f"{group.grouped_by.value}: {group.total_count}")

# With filters
response = articles.aggregate.over_all(
    filters=Filter.by_property("view_count").greater_than(100),
    total_count=True
)
print(f"Total: {response.total_count}")
```

---

## Generative Modules

### Available Modules

```python
from weaviate.classes.config import Configure

# OpenAI
generative = Configure.Generative.openai(model="gpt-4o")

# Anthropic
generative = Configure.Generative.anthropic(model="claude-3-5-sonnet-20241022")

# Cohere
generative = Configure.Generative.cohere(model="command-r-plus")

# AWS Bedrock
generative = Configure.Generative.aws(model="anthropic.claude-3-sonnet")

# Google Vertex AI
generative = Configure.Generative.palm(model_id="gemini-1.5-pro")

# Ollama (local)
generative = Configure.Generative.ollama(model="llama3.2")
```

### Generation Patterns

```python
from weaviate.classes.generate import GenerateConfig

kb = client.collections.get("KnowledgeBase")

# Single object generation
response = kb.generate.near_text(
    query="quantum computing basics",
    single_prompt="Summarize this article in 2 sentences: {content}",
    limit=1
)
print(response.objects[0].generated)

# Grouped generation (RAG)
response = kb.generate.near_text(
    query="machine learning best practices",
    grouped_task="Based on these articles, provide 5 key recommendations:",
    limit=5
)
print(response.generated)
```

---

## Reranking

### Configure Reranker

```python
from weaviate.classes.config import Configure

client.collections.create(
    name="SearchResults",
    vectorizer_config=Configure.Vectorizer.text2vec_openai(),
    reranker_config=Configure.Reranker.cohere(
        model="rerank-english-v3.0"
    ),
    properties=[...]
)
```

### Search with Reranking

```python
from weaviate.classes.query import Rerank

results = client.collections.get("SearchResults")

response = results.query.near_text(
    query="best programming languages for AI",
    limit=20,  # Fetch more candidates
    rerank=Rerank(
        prop="content",
        query="programming languages machine learning"
    ),
    return_metadata=MetadataQuery(score=True)
)
```

---

## Multi-Tenancy Management

### Manage Tenants

```python
from weaviate.classes.tenants import Tenant, TenantActivityStatus

collection = client.collections.get("CustomerData")

# Create tenants
collection.tenants.create([
    Tenant(name="customer_123"),
    Tenant(name="customer_456")
])

# List tenants
tenants = collection.tenants.get()
for name, tenant in tenants.items():
    print(f"{name}: {tenant.activity_status}")

# Deactivate tenant (offload from memory)
collection.tenants.update([
    Tenant(name="customer_123", activity_status=TenantActivityStatus.INACTIVE)
])

# Delete tenant
collection.tenants.remove(["customer_456"])
```

---

## Docker Configuration

### With Multiple Modules

```yaml
environment:
  ENABLE_MODULES: >-
    text2vec-openai,
    text2vec-cohere,
    text2vec-huggingface,
    generative-openai,
    generative-cohere,
    reranker-cohere,
    qna-openai
  OPENAI_APIKEY: ${OPENAI_API_KEY}
  COHERE_APIKEY: ${COHERE_API_KEY}
  HUGGINGFACE_APIKEY: ${HUGGINGFACE_API_KEY}
```

---

## Production Configuration

### Authentication and Authorization

```yaml
environment:
  AUTHENTICATION_APIKEY_ENABLED: 'true'
  AUTHENTICATION_APIKEY_ALLOWED_KEYS: 'admin-key,readonly-key'
  AUTHENTICATION_APIKEY_USERS: 'admin,reader'
  AUTHORIZATION_ADMINLIST_ENABLED: 'true'
  AUTHORIZATION_ADMINLIST_USERS: 'admin'
  QUERY_MAXIMUM_RESULTS: 10000
  PERSISTENCE_DATA_PATH: '/var/lib/weaviate'
  BACKUP_FILESYSTEM_PATH: '/var/lib/weaviate/backups'
  LOG_LEVEL: 'info'
```

---

## Comprehensive Error Handling

### All Exception Types

```python
from weaviate.exceptions import (
    WeaviateConnectionError,
    WeaviateQueryError,
    UnexpectedStatusCodeError,
    ObjectAlreadyExistsException,
    WeaviateInvalidInputError
)

def safe_insert(collection, properties, vector=None):
    """Insert with comprehensive error handling."""
    try:
        uuid = collection.data.insert(
            properties=properties,
            vector=vector
        )
        return uuid
    except ObjectAlreadyExistsException:
        logging.warning("Object already exists, updating instead")
        # Handle duplicate
    except WeaviateInvalidInputError as e:
        logging.error(f"Invalid input: {e}")
        raise
    except UnexpectedStatusCodeError as e:
        if e.status_code == 429:
            logging.warning("Rate limited, backing off...")
            time.sleep(5)
            return safe_insert(collection, properties, vector)
        raise
    except WeaviateConnectionError:
        logging.error("Connection lost, attempting reconnect...")
        raise
```

### Retry Pattern

```python
import time
from functools import wraps

def retry_on_rate_limit(max_retries=3, base_delay=1.0):
    """Decorator for rate limit handling."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except UnexpectedStatusCodeError as e:
                    if e.status_code == 429 and attempt < max_retries - 1:
                        delay = base_delay * (2 ** attempt)
                        time.sleep(delay)
                    else:
                        raise
            return None
        return wrapper
    return decorator
```

---

## Context7 Integration

For up-to-date documentation beyond this skill's scope, use Context7 MCP when available:

### When to Use Context7

| Scenario | Context7 Query |
|----------|----------------|
| Python client latest | `resolve-library-id: weaviate-client` then `query-docs` |
| TypeScript client | `resolve-library-id: weaviate-ts-client` then query |
| Core concepts | Query `/weaviate/weaviate-io` for official docs |
| Module configuration | Query "weaviate vectorizer modules" |

### Context7 Query Pattern

```python
# When you need current documentation:
# 1. Resolve the library ID
mcp__context7__resolve-library-id(libraryName="weaviate", query="hybrid search")

# 2. Query the docs with the resolved ID
mcp__context7__query-docs(libraryId="/weaviate/weaviate-io", query="collection schema")
```

**Use Context7 when**:
- SDK version-specific features needed
- Module configuration options
- New features (reranking, generative search)
- Multi-tenancy patterns

---

## Integration Checklists

### Pre-Flight Checklist

- [ ] Weaviate instance accessible (Docker/WCD)
- [ ] API keys configured (WEAVIATE_API_KEY if WCD)
- [ ] Vectorizer API keys set (OPENAI_API_KEY, etc.)
- [ ] Collection schema defined
- [ ] Index type appropriate for data size
- [ ] Batch import for bulk data
- [ ] Error handling implemented
- [ ] Connection cleanup (context manager)

### Production Readiness

- [ ] Authentication enabled (API keys)
- [ ] Authorization configured (admin vs read-only)
- [ ] Backup strategy implemented
- [ ] Monitoring/alerting configured
- [ ] Rate limiting handled
- [ ] Multi-tenancy if multi-customer
- [ ] Vector compression if memory-constrained
- [ ] Query timeouts configured
- [ ] Logging for debugging

---

## Anti-Patterns

### Avoid Blocking Client in Async Code

```python
# BAD: Blocking in async context
async def search():
    client = weaviate.connect_to_local()  # Blocking!
    results = collection.query.near_text(...)  # Blocking!
    return results

# GOOD: Use thread pool executor for now
# (Weaviate Python client v4 doesn't have native async yet)
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor()

async def search():
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        executor,
        lambda: collection.query.near_text(query="...", limit=10)
    )
    return results
```

### Avoid Over-fetching

```python
# BAD: Fetching all properties when you need one
response = collection.query.near_text(query="...", limit=100)

# GOOD: Specify only needed properties
response = collection.query.near_text(
    query="...",
    limit=100,
    return_properties=["title", "summary"]
)
```

### Avoid Missing Error Handling on Batch

```python
# BAD: Ignoring batch errors
with collection.batch.dynamic() as batch:
    for item in data:
        batch.add_object(properties=item)
# Errors silently ignored!

# GOOD: Check for failures INSIDE context manager
with collection.batch.dynamic() as batch:
    for item in data:
        batch.add_object(properties=item)

    # Must check inside the context manager
    if batch.number_errors > 0:
        for failed in batch.failed_objects:
            logging.error(f"Failed: {failed.message}")
```

---

## CLI Commands

### Installation

```bash
# Python
pip install weaviate-client

# With all extras
pip install "weaviate-client[all]"

# Node.js
npm install weaviate-client
yarn add weaviate-client
pnpm add weaviate-client
```

### Docker Commands

```bash
# Start Weaviate
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f weaviate

# Stop
docker-compose down

# Stop and remove data
docker-compose down -v
```

### Quick Testing

```bash
# Check Weaviate is running
curl http://localhost:8080/v1/.well-known/ready

# Get schema
curl http://localhost:8080/v1/schema

# Get nodes status
curl http://localhost:8080/v1/nodes
```

### Python Testing

```python
# Quick connection test
import weaviate
client = weaviate.connect_to_local()
print(f"Ready: {client.is_ready()}")
print(f"Version: {client.get_meta()['version']}")
client.close()
```

---

## See Also

- [SKILL.md](SKILL.md) - Quick reference for common operations
- [Weaviate Docs](https://weaviate.io/developers/weaviate)
- [Weaviate Academy](https://weaviate.io/developers/academy)
- [Weaviate Recipes](https://github.com/weaviate/recipes)

---

**Last Updated**: 2026-01-01 | **Version**: 1.0.0
