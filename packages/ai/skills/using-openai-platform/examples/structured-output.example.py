#!/usr/bin/env python3
"""
Structured Output Example

This example demonstrates OpenAI's structured output capabilities:
- JSON mode for guaranteed JSON responses
- Pydantic models for type-safe extraction
- JSON Schema for complex structures
- Validation and error handling

Usage:
    python structured-output.example.py
"""

import os
import json
import logging
from typing import List, Optional
from dataclasses import dataclass

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Data Models (using dataclasses for portability)
# =============================================================================

@dataclass
class Person:
    """Person data model."""
    name: str
    age: int
    occupation: str
    skills: List[str]


@dataclass
class Product:
    """Product data model."""
    name: str
    price: float
    category: str
    in_stock: bool
    description: Optional[str] = None


@dataclass
class SentimentAnalysis:
    """Sentiment analysis result."""
    sentiment: str  # "positive", "negative", "neutral"
    confidence: float
    key_phrases: List[str]
    summary: str


# =============================================================================
# JSON Mode Examples
# =============================================================================

def json_mode_basic():
    """Basic JSON mode example."""
    print("\n=== JSON Mode (Basic) ===\n")

    client = OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that responds in JSON format. "
                          "Always include a 'result' key with your answer."
            },
            {
                "role": "user",
                "content": "List the 3 largest planets in our solar system with their diameters in km."
            }
        ],
        response_format={"type": "json_object"}
    )

    result = json.loads(response.choices[0].message.content)
    print("Raw JSON response:")
    print(json.dumps(result, indent=2))


def json_mode_list_extraction():
    """Extract structured list data."""
    print("\n=== JSON Mode (List Extraction) ===\n")

    client = OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": """You extract structured data and respond in JSON format.
Output format: {"items": [{"name": string, "category": string, "priority": "high"|"medium"|"low"}]}"""
            },
            {
                "role": "user",
                "content": """Extract tasks from this text:

"Need to urgently fix the login bug. Should also update the documentation when we have time.
The security audit is critical and needs to be done this week. Would be nice to refactor the utils module."
"""
            }
        ],
        response_format={"type": "json_object"}
    )

    result = json.loads(response.choices[0].message.content)
    print("Extracted tasks:")
    for item in result.get("items", []):
        print(f"  - [{item['priority'].upper()}] {item['name']} ({item['category']})")


# =============================================================================
# JSON Schema Examples
# =============================================================================

def json_schema_person_extraction():
    """Extract person information using JSON schema."""
    print("\n=== JSON Schema (Person Extraction) ===\n")

    client = OpenAI()

    person_schema = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The person's full name"
            },
            "age": {
                "type": "integer",
                "description": "The person's age in years"
            },
            "occupation": {
                "type": "string",
                "description": "The person's job or profession"
            },
            "skills": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of professional skills"
            }
        },
        "required": ["name", "age", "occupation", "skills"],
        "additionalProperties": False
    }

    text = """
    Meet Sarah Chen, a 32-year-old software architect based in Seattle.
    She specializes in distributed systems and has expertise in Python,
    Go, Kubernetes, and system design. She's been leading cloud migration
    projects for the past 5 years.
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "Extract person information from the provided text. "
                          "Respond with valid JSON matching the schema."
            },
            {"role": "user", "content": text}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "person_extraction",
                "strict": True,
                "schema": person_schema
            }
        }
    )

    person_data = json.loads(response.choices[0].message.content)
    print(f"Name: {person_data['name']}")
    print(f"Age: {person_data['age']}")
    print(f"Occupation: {person_data['occupation']}")
    print(f"Skills: {', '.join(person_data['skills'])}")


def json_schema_product_catalog():
    """Extract product information using JSON schema."""
    print("\n=== JSON Schema (Product Catalog) ===\n")

    client = OpenAI()

    product_schema = {
        "type": "object",
        "properties": {
            "products": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "price": {"type": "number"},
                        "category": {
                            "type": "string",
                            "enum": ["electronics", "clothing", "home", "sports", "other"]
                        },
                        "in_stock": {"type": "boolean"},
                        "description": {"type": "string"}
                    },
                    "required": ["name", "price", "category", "in_stock"],
                    "additionalProperties": False
                }
            }
        },
        "required": ["products"],
        "additionalProperties": False
    }

    catalog_text = """
    Our store has:
    - Wireless Bluetooth Headphones for $79.99 (available now) - Great for music lovers
    - Running Shoes size 10 at $129.99 - currently out of stock
    - Smart LED Desk Lamp $45.00 - in stock, perfect for home office
    - Cotton T-Shirt in blue for just $19.99 - limited availability
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "Extract product information from the text. "
                          "Categorize each product appropriately."
            },
            {"role": "user", "content": catalog_text}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "product_catalog",
                "strict": True,
                "schema": product_schema
            }
        }
    )

    catalog = json.loads(response.choices[0].message.content)
    print(f"Found {len(catalog['products'])} products:\n")

    for product in catalog["products"]:
        status = "In Stock" if product["in_stock"] else "Out of Stock"
        desc = f" - {product.get('description', '')}" if product.get("description") else ""
        print(f"  {product['name']}")
        print(f"    ${product['price']:.2f} | {product['category']} | {status}{desc}")
        print()


def json_schema_sentiment_analysis():
    """Perform sentiment analysis with structured output."""
    print("\n=== JSON Schema (Sentiment Analysis) ===\n")

    client = OpenAI()

    sentiment_schema = {
        "type": "object",
        "properties": {
            "sentiment": {
                "type": "string",
                "enum": ["positive", "negative", "neutral", "mixed"]
            },
            "confidence": {
                "type": "number",
                "description": "Confidence score from 0.0 to 1.0"
            },
            "key_phrases": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Key phrases that influenced the sentiment"
            },
            "summary": {
                "type": "string",
                "description": "Brief summary of the sentiment analysis"
            }
        },
        "required": ["sentiment", "confidence", "key_phrases", "summary"],
        "additionalProperties": False
    }

    reviews = [
        "This product exceeded my expectations! Great quality and fast shipping.",
        "Terrible experience. Product arrived broken and customer service was unhelpful.",
        "It's okay. Does what it says but nothing special. Price is fair.",
        "Love the design but hate the battery life. Mixed feelings overall."
    ]

    print("Sentiment Analysis Results:\n")

    for review in reviews:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "Analyze the sentiment of the given text. "
                              "Be precise with your confidence score."
                },
                {"role": "user", "content": review}
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "sentiment_analysis",
                    "strict": True,
                    "schema": sentiment_schema
                }
            }
        )

        result = json.loads(response.choices[0].message.content)

        emoji = {
            "positive": "+",
            "negative": "-",
            "neutral": "=",
            "mixed": "~"
        }.get(result["sentiment"], "?")

        print(f'[{emoji}] "{review[:50]}..."')
        print(f"    Sentiment: {result['sentiment']} ({result['confidence']:.0%} confidence)")
        print(f"    Key phrases: {', '.join(result['key_phrases'][:3])}")
        print()


def json_schema_complex_nested():
    """Extract complex nested data structures."""
    print("\n=== JSON Schema (Complex Nested) ===\n")

    client = OpenAI()

    event_schema = {
        "type": "object",
        "properties": {
            "event": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "date": {"type": "string", "description": "ISO 8601 date format"},
                    "location": {
                        "type": "object",
                        "properties": {
                            "venue": {"type": "string"},
                            "city": {"type": "string"},
                            "country": {"type": "string"}
                        },
                        "required": ["venue", "city", "country"],
                        "additionalProperties": False
                    },
                    "speakers": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "topic": {"type": "string"},
                                "bio": {"type": "string"}
                            },
                            "required": ["name", "topic"],
                            "additionalProperties": False
                        }
                    },
                    "capacity": {"type": "integer"},
                    "is_virtual": {"type": "boolean"}
                },
                "required": ["name", "date", "location", "speakers", "capacity", "is_virtual"],
                "additionalProperties": False
            }
        },
        "required": ["event"],
        "additionalProperties": False
    }

    event_description = """
    Join us for TechConf 2025 on March 15th, 2025 at the San Francisco Convention Center.

    Featured speakers include:
    - Dr. Jane Smith discussing "The Future of AI" - she's a Stanford professor
    - Mike Johnson on "Cloud-Native Architecture"
    - Sarah Lee presenting "Security Best Practices" - CISO at TechCorp

    The venue can accommodate 500 attendees. This will be a hybrid event with
    both in-person and virtual attendance options.
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "Extract event information into the specified structure. "
                          "Use ISO 8601 format for dates (YYYY-MM-DD)."
            },
            {"role": "user", "content": event_description}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "event_extraction",
                "strict": True,
                "schema": event_schema
            }
        }
    )

    event_data = json.loads(response.choices[0].message.content)
    event = event_data["event"]

    print(f"Event: {event['name']}")
    print(f"Date: {event['date']}")
    print(f"Location: {event['location']['venue']}, {event['location']['city']}, {event['location']['country']}")
    print(f"Capacity: {event['capacity']} attendees")
    print(f"Virtual: {'Yes' if event['is_virtual'] else 'No'}")
    print(f"\nSpeakers ({len(event['speakers'])}):")
    for speaker in event["speakers"]:
        bio = f" - {speaker.get('bio', '')}" if speaker.get("bio") else ""
        print(f"  - {speaker['name']}: \"{speaker['topic']}\"{bio}")


# =============================================================================
# Error Handling
# =============================================================================

def structured_output_error_handling():
    """Demonstrate error handling for structured outputs."""
    print("\n=== Error Handling ===\n")

    client = OpenAI()

    # Schema with strict constraints
    strict_schema = {
        "type": "object",
        "properties": {
            "temperature_celsius": {
                "type": "number",
                "description": "Temperature in Celsius"
            },
            "conditions": {
                "type": "string",
                "enum": ["sunny", "cloudy", "rainy", "snowy", "foggy"]
            }
        },
        "required": ["temperature_celsius", "conditions"],
        "additionalProperties": False
    }

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "Extract weather information from the text."
                },
                {
                    "role": "user",
                    "content": "It's a beautiful day at 72 degrees Fahrenheit with clear skies."
                }
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "weather",
                    "strict": True,
                    "schema": strict_schema
                }
            }
        )

        weather = json.loads(response.choices[0].message.content)
        print(f"Temperature: {weather['temperature_celsius']}C")
        print(f"Conditions: {weather['conditions']}")

        # Validate the response
        if weather["conditions"] not in ["sunny", "cloudy", "rainy", "snowy", "foggy"]:
            print("Warning: Unexpected conditions value!")

    except json.JSONDecodeError as e:
        print(f"JSON parsing error: {e}")

    except Exception as e:
        print(f"Error: {e}")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Structured Output Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        print("Set it with: export OPENAI_API_KEY='sk-...'")
        return

    try:
        # JSON mode examples
        json_mode_basic()
        json_mode_list_extraction()

        # JSON schema examples
        json_schema_person_extraction()
        json_schema_product_catalog()
        json_schema_sentiment_analysis()
        json_schema_complex_nested()

        # Error handling
        structured_output_error_handling()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All structured output examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
