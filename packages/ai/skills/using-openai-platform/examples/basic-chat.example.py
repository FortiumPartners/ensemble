#!/usr/bin/env python3
"""
Basic Chat Completion Example

This example demonstrates the fundamentals of using the OpenAI Chat Completions API:
- Client initialization
- Single message completion
- Multi-turn conversation
- Response parsing
- Basic error handling

Usage:
    python basic-chat.example.py
"""

import os
import logging
from typing import List, Dict

from openai import OpenAI, APIError, RateLimitError, AuthenticationError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def simple_completion():
    """Demonstrate a simple single-turn completion."""
    print("\n=== Simple Completion ===\n")

    client = OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "What is the capital of France?"}
        ]
    )

    answer = response.choices[0].message.content
    print(f"Question: What is the capital of France?")
    print(f"Answer: {answer}")

    # Print usage stats
    print(f"\nTokens used: {response.usage.total_tokens}")


def completion_with_system_prompt():
    """Demonstrate using a system prompt to set behavior."""
    print("\n=== Completion with System Prompt ===\n")

    client = OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that responds in a concise, "
                          "professional manner. Keep responses under 50 words."
            },
            {
                "role": "user",
                "content": "Explain what machine learning is."
            }
        ],
        temperature=0.7,
        max_tokens=100
    )

    answer = response.choices[0].message.content
    print(f"Question: Explain what machine learning is.")
    print(f"Answer: {answer}")


def multi_turn_conversation():
    """Demonstrate a multi-turn conversation."""
    print("\n=== Multi-Turn Conversation ===\n")

    client = OpenAI()

    # Build conversation history
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": "You are a helpful math tutor."}
    ]

    # First turn
    messages.append({"role": "user", "content": "What is 15 + 27?"})

    response1 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )

    assistant_msg1 = response1.choices[0].message.content
    messages.append({"role": "assistant", "content": assistant_msg1})

    print(f"User: What is 15 + 27?")
    print(f"Assistant: {assistant_msg1}")

    # Second turn (follow-up)
    messages.append({"role": "user", "content": "Now multiply that by 2."})

    response2 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )

    assistant_msg2 = response2.choices[0].message.content
    print(f"\nUser: Now multiply that by 2.")
    print(f"Assistant: {assistant_msg2}")


def json_mode_example():
    """Demonstrate JSON mode for structured output."""
    print("\n=== JSON Mode Example ===\n")

    client = OpenAI()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that responds in JSON format."
            },
            {
                "role": "user",
                "content": "List 3 programming languages with their primary use cases."
            }
        ],
        response_format={"type": "json_object"}
    )

    import json
    result = json.loads(response.choices[0].message.content)
    print("Structured response:")
    print(json.dumps(result, indent=2))


def error_handling_example():
    """Demonstrate proper error handling."""
    print("\n=== Error Handling Example ===\n")

    client = OpenAI()

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "Hello!"}
            ]
        )
        print(f"Success: {response.choices[0].message.content}")

    except AuthenticationError:
        print("Error: Invalid API key. Please check OPENAI_API_KEY.")

    except RateLimitError:
        print("Error: Rate limit exceeded. Please wait and retry.")

    except APIError as e:
        print(f"API Error: {e.message}")

    except Exception as e:
        print(f"Unexpected error: {e}")


def temperature_comparison():
    """Compare different temperature settings."""
    print("\n=== Temperature Comparison ===\n")

    client = OpenAI()
    prompt = "Complete this sentence creatively: The robot walked into the bar and"

    for temp in [0.0, 0.5, 1.0]:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=temp,
            max_tokens=50
        )

        print(f"Temperature {temp}:")
        print(f"  {response.choices[0].message.content}")
        print()


def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Basic Chat Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        print("Set it with: export OPENAI_API_KEY='sk-...'")
        return

    try:
        simple_completion()
        completion_with_system_prompt()
        multi_turn_conversation()
        json_mode_example()
        error_handling_example()
        temperature_comparison()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All examples completed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
