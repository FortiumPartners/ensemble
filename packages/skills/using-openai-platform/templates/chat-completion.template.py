#!/usr/bin/env python3
"""
OpenAI Chat Completions Template

This template provides a production-ready chat completion implementation
with proper error handling and configuration.

Placeholders:
- {{model}} - Model ID (e.g., "gpt-5")
- {{system_prompt}} - System message content
- {{max_tokens}} - Maximum response tokens

Usage:
    python chat-completion.py "What is Python?"
"""

import os
import sys
import logging
from typing import List, Dict, Optional

from openai import OpenAI, APIError, RateLimitError, AuthenticationError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{model}}"
SYSTEM_PROMPT = "{{system_prompt}}"
MAX_TOKENS = {{max_tokens}}
TEMPERATURE = 0.7


class ChatClient:
    """OpenAI Chat Completions client with error handling."""

    def __init__(
        self,
        model: str = MODEL,
        system_prompt: str = SYSTEM_PROMPT,
        max_tokens: int = MAX_TOKENS,
        temperature: float = TEMPERATURE
    ):
        """Initialize the chat client.

        Args:
            model: OpenAI model ID
            system_prompt: System message for the conversation
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature (0-2)
        """
        self.client = OpenAI()
        self.model = model
        self.system_prompt = system_prompt
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.messages: List[Dict[str, str]] = []

        # Initialize with system prompt
        if self.system_prompt:
            self.messages.append({
                "role": "system",
                "content": self.system_prompt
            })

    def chat(self, user_message: str) -> str:
        """Send a message and get a response.

        Args:
            user_message: The user's message

        Returns:
            The assistant's response

        Raises:
            AuthenticationError: Invalid API key
            RateLimitError: Rate limit exceeded
            APIError: Other API errors
        """
        # Add user message to history
        self.messages.append({
            "role": "user",
            "content": user_message
        })

        try:
            logger.info(f"Sending request to {self.model}")

            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                max_tokens=self.max_tokens,
                temperature=self.temperature
            )

            # Extract response content
            assistant_message = response.choices[0].message.content

            # Add to history
            self.messages.append({
                "role": "assistant",
                "content": assistant_message
            })

            # Log usage
            logger.info(
                f"Tokens used - Prompt: {response.usage.prompt_tokens}, "
                f"Completion: {response.usage.completion_tokens}"
            )

            return assistant_message

        except AuthenticationError as e:
            logger.error("Authentication failed - check your API key")
            raise

        except RateLimitError as e:
            logger.error("Rate limit exceeded - implement backoff")
            raise

        except APIError as e:
            logger.error(f"API error: {e}")
            raise

    def clear_history(self) -> None:
        """Clear conversation history, keeping system prompt."""
        self.messages = []
        if self.system_prompt:
            self.messages.append({
                "role": "system",
                "content": self.system_prompt
            })

    def get_history(self) -> List[Dict[str, str]]:
        """Get the current conversation history."""
        return self.messages.copy()


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print("Usage: python chat-completion.py <message>")
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    try:
        client = ChatClient()
        response = client.chat(user_input)
        print(response)

    except AuthenticationError:
        print("Error: Invalid API key. Set OPENAI_API_KEY environment variable.")
        sys.exit(1)

    except RateLimitError:
        print("Error: Rate limit exceeded. Please try again later.")
        sys.exit(1)

    except APIError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
