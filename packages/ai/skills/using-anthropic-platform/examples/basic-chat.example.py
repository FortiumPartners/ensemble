#!/usr/bin/env python3
"""
Anthropic Basic Chat Example

This example demonstrates basic chat completion with the Anthropic Claude API,
including single messages, multi-turn conversations, and proper error handling.

Usage:
    python basic-chat.example.py

Requirements:
    pip install anthropic
    export ANTHROPIC_API_KEY="sk-ant-..."
"""

import logging
from typing import List, Dict

from anthropic import Anthropic, APIError, RateLimitError, AuthenticationError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def single_message_example():
    """Demonstrate a single message exchange."""
    print("\n=== Single Message Example ===\n")

    client = Anthropic()

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[
            {"role": "user", "content": "What is the capital of France?"}
        ]
    )

    print(f"Response: {message.content[0].text}")
    print(f"Tokens - Input: {message.usage.input_tokens}, Output: {message.usage.output_tokens}")


def with_system_prompt_example():
    """Demonstrate using a system prompt."""
    print("\n=== System Prompt Example ===\n")

    client = Anthropic()

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="You are a helpful assistant that responds in haiku format.",
        messages=[
            {"role": "user", "content": "Tell me about Python programming."}
        ]
    )

    print(f"Response:\n{message.content[0].text}")


def multi_turn_example():
    """Demonstrate a multi-turn conversation."""
    print("\n=== Multi-Turn Conversation Example ===\n")

    client = Anthropic()
    messages: List[Dict[str, str]] = []

    # Turn 1
    messages.append({"role": "user", "content": "My name is Alice. Remember that."})

    response1 = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=messages
    )

    assistant_msg1 = response1.content[0].text
    messages.append({"role": "assistant", "content": assistant_msg1})
    print(f"User: My name is Alice. Remember that.")
    print(f"Claude: {assistant_msg1}")

    # Turn 2
    messages.append({"role": "user", "content": "What's my name?"})

    response2 = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=messages
    )

    assistant_msg2 = response2.content[0].text
    messages.append({"role": "assistant", "content": assistant_msg2})
    print(f"\nUser: What's my name?")
    print(f"Claude: {assistant_msg2}")

    # Turn 3
    messages.append({"role": "user", "content": "What did I tell you in my first message?"})

    response3 = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=messages
    )

    assistant_msg3 = response3.content[0].text
    print(f"\nUser: What did I tell you in my first message?")
    print(f"Claude: {assistant_msg3}")


class ConversationManager:
    """Manage multi-turn conversations with context."""

    def __init__(
        self,
        model: str = "claude-sonnet-4-20250514",
        system: str = None,
        max_tokens: int = 1024
    ):
        self.client = Anthropic()
        self.model = model
        self.system = system
        self.max_tokens = max_tokens
        self.messages: List[Dict[str, str]] = []

    def chat(self, user_message: str) -> str:
        """Send a message and get a response."""
        self.messages.append({"role": "user", "content": user_message})

        kwargs = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": self.messages
        }
        if self.system:
            kwargs["system"] = self.system

        response = self.client.messages.create(**kwargs)
        assistant_message = response.content[0].text

        self.messages.append({"role": "assistant", "content": assistant_message})

        logger.info(
            f"Tokens - Input: {response.usage.input_tokens}, "
            f"Output: {response.usage.output_tokens}"
        )

        return assistant_message

    def clear(self):
        """Clear conversation history."""
        self.messages = []


def conversation_class_example():
    """Demonstrate the ConversationManager class."""
    print("\n=== Conversation Manager Example ===\n")

    conv = ConversationManager(
        system="You are a helpful coding assistant. Be concise."
    )

    # Multiple turns
    response1 = conv.chat("How do I read a file in Python?")
    print(f"Q: How do I read a file in Python?")
    print(f"A: {response1}\n")

    response2 = conv.chat("How do I write to that file?")
    print(f"Q: How do I write to that file?")
    print(f"A: {response2}\n")

    response3 = conv.chat("What about handling errors?")
    print(f"Q: What about handling errors?")
    print(f"A: {response3}")


def error_handling_example():
    """Demonstrate proper error handling."""
    print("\n=== Error Handling Example ===\n")

    client = Anthropic()

    try:
        # This will work with a valid API key
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            messages=[{"role": "user", "content": "Hi!"}]
        )
        print(f"Success: {message.content[0].text}")

    except AuthenticationError as e:
        print(f"Authentication failed: Check your ANTHROPIC_API_KEY")
        logger.error(f"Auth error: {e}")

    except RateLimitError as e:
        print(f"Rate limited: Please wait and try again")
        logger.error(f"Rate limit: {e}")

    except APIError as e:
        print(f"API error: {e}")
        logger.error(f"API error: {e}")


def main():
    """Run all examples."""
    print("=" * 60)
    print("Anthropic Basic Chat Examples")
    print("=" * 60)

    try:
        single_message_example()
        with_system_prompt_example()
        multi_turn_example()
        conversation_class_example()
        error_handling_example()

        print("\n" + "=" * 60)
        print("All examples completed successfully!")
        print("=" * 60)

    except AuthenticationError:
        print("\nError: Invalid API key. Set ANTHROPIC_API_KEY environment variable.")

    except Exception as e:
        print(f"\nError: {e}")
        raise


if __name__ == "__main__":
    main()
