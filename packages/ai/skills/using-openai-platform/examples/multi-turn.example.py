#!/usr/bin/env python3
"""
Multi-Turn Conversation Example

This example demonstrates multi-turn conversation management:
- Conversation history tracking
- Context window management
- Message summarization for long conversations
- System prompt strategies
- Conversation persistence patterns

Usage:
    python multi-turn.example.py
"""

import os
import json
import logging
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Conversation Manager Classes
# =============================================================================

@dataclass
class Message:
    """A single message in a conversation."""
    role: str  # "system", "user", "assistant"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    tokens: int = 0

    def to_dict(self) -> Dict[str, str]:
        """Convert to OpenAI message format."""
        return {"role": self.role, "content": self.content}


@dataclass
class Conversation:
    """A conversation with history management."""
    id: str
    system_prompt: str
    messages: List[Message] = field(default_factory=list)
    max_tokens: int = 8000  # Reserve tokens for context
    model: str = "gpt-4o-mini"

    def add_message(self, role: str, content: str, tokens: int = 0):
        """Add a message to the conversation."""
        self.messages.append(Message(role=role, content=content, tokens=tokens))

    def get_messages_for_api(self) -> List[Dict[str, str]]:
        """Get messages formatted for the API."""
        result = [{"role": "system", "content": self.system_prompt}]
        result.extend([m.to_dict() for m in self.messages])
        return result

    def estimate_tokens(self) -> int:
        """Estimate total tokens in conversation."""
        # Rough estimate: 4 chars per token
        total_chars = len(self.system_prompt)
        total_chars += sum(len(m.content) for m in self.messages)
        return total_chars // 4

    def clear(self):
        """Clear conversation history."""
        self.messages = []


class ConversationManager:
    """Manages multiple conversations with context handling."""

    def __init__(self, model: str = "gpt-4o-mini"):
        self.client = OpenAI()
        self.model = model
        self.conversations: Dict[str, Conversation] = {}

    def create_conversation(
        self,
        conversation_id: str,
        system_prompt: str = "You are a helpful assistant."
    ) -> Conversation:
        """Create a new conversation."""
        conv = Conversation(
            id=conversation_id,
            system_prompt=system_prompt,
            model=self.model
        )
        self.conversations[conversation_id] = conv
        return conv

    def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        """Get an existing conversation."""
        return self.conversations.get(conversation_id)

    def chat(self, conversation_id: str, user_message: str) -> str:
        """Send a message in a conversation and get a response."""
        conv = self.conversations.get(conversation_id)
        if not conv:
            raise ValueError(f"Conversation {conversation_id} not found")

        # Add user message
        conv.add_message("user", user_message)

        # Get response
        response = self.client.chat.completions.create(
            model=self.model,
            messages=conv.get_messages_for_api()
        )

        assistant_message = response.choices[0].message.content
        tokens = response.usage.total_tokens

        # Add assistant response
        conv.add_message("assistant", assistant_message, tokens)

        return assistant_message

    def summarize_conversation(self, conversation_id: str) -> str:
        """Summarize a conversation to reduce token count."""
        conv = self.conversations.get(conversation_id)
        if not conv or len(conv.messages) < 4:
            return "Conversation too short to summarize."

        # Get summary from GPT
        summary_prompt = """Summarize the following conversation in a concise paragraph.
Focus on key topics, decisions made, and important information exchanged.

Conversation:
"""
        for msg in conv.messages:
            summary_prompt += f"\n{msg.role.upper()}: {msg.content}"

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are a conversation summarizer."},
                {"role": "user", "content": summary_prompt}
            ]
        )

        return response.choices[0].message.content


# =============================================================================
# Basic Multi-Turn Examples
# =============================================================================

def basic_multi_turn():
    """Basic multi-turn conversation."""
    print("\n=== Basic Multi-Turn Conversation ===\n")

    client = OpenAI()

    # Maintain message history
    messages = [
        {"role": "system", "content": "You are a helpful math tutor. Be concise."}
    ]

    exchanges = [
        "What is 15 + 27?",
        "Now multiply that by 2.",
        "What's the square root of that result?",
        "Round that to the nearest integer."
    ]

    for user_input in exchanges:
        # Add user message
        messages.append({"role": "user", "content": user_input})

        # Get response
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages
        )

        assistant_message = response.choices[0].message.content

        # Add assistant response to history
        messages.append({"role": "assistant", "content": assistant_message})

        print(f"User: {user_input}")
        print(f"Assistant: {assistant_message}\n")

    print(f"Total messages in history: {len(messages)}")


def conversation_with_context_injection():
    """Inject context mid-conversation."""
    print("\n=== Context Injection ===\n")

    client = OpenAI()

    messages = [
        {"role": "system", "content": "You are a customer service agent for TechCorp."}
    ]

    # First exchange - initial query
    messages.append({"role": "user", "content": "I have a problem with my order."})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )
    messages.append({"role": "assistant", "content": response.choices[0].message.content})
    print(f"User: I have a problem with my order.")
    print(f"Assistant: {response.choices[0].message.content}\n")

    # Inject context (simulating database lookup)
    order_context = """[SYSTEM CONTEXT: Customer Order #12345
- Product: Laptop Pro X
- Status: Shipped
- Tracking: ABC123
- Expected Delivery: Tomorrow]"""

    messages.append({"role": "system", "content": order_context})

    # Continue conversation with context
    messages.append({"role": "user", "content": "Order number 12345"})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )
    messages.append({"role": "assistant", "content": response.choices[0].message.content})
    print(f"User: Order number 12345")
    print(f"Assistant: {response.choices[0].message.content}\n")


def conversation_with_persona():
    """Different personas for different contexts."""
    print("\n=== Persona-Based Conversations ===\n")

    client = OpenAI()

    personas = {
        "teacher": "You are a patient, encouraging teacher. Explain concepts step by step.",
        "expert": "You are a technical expert. Be precise and use technical terminology.",
        "friend": "You are a casual, friendly assistant. Keep responses brief and conversational."
    }

    question = "Explain how a computer works."

    for name, system_prompt in personas.items():
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question}
        ]

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=100
        )

        print(f"[{name.upper()}]")
        print(f"{response.choices[0].message.content}\n")


# =============================================================================
# Advanced Context Management
# =============================================================================

def sliding_window_context():
    """Manage context with a sliding window."""
    print("\n=== Sliding Window Context ===\n")

    client = OpenAI()

    # Keep only the last N messages (plus system prompt)
    MAX_HISTORY = 4

    messages = [
        {"role": "system", "content": "You are a helpful assistant. Keep track of our conversation."}
    ]

    conversation = [
        "My name is Alice.",
        "I live in Seattle.",
        "I work as a software engineer.",
        "My favorite language is Python.",
        "I have a cat named Whiskers.",
        "What do you remember about me?",
    ]

    for user_input in conversation:
        messages.append({"role": "user", "content": user_input})

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages
        )

        assistant_message = response.choices[0].message.content
        messages.append({"role": "assistant", "content": assistant_message})

        print(f"User: {user_input}")
        print(f"Assistant: {assistant_message}\n")

        # Apply sliding window (keep system + last N pairs)
        if len(messages) > 1 + (MAX_HISTORY * 2):
            # Keep system message and last MAX_HISTORY exchanges
            system_msg = messages[0]
            recent_msgs = messages[-(MAX_HISTORY * 2):]
            messages = [system_msg] + recent_msgs
            print(f"  [Trimmed to {len(messages)} messages]\n")


def summarization_for_long_context():
    """Summarize older messages to maintain context."""
    print("\n=== Context Summarization ===\n")

    client = OpenAI()

    # Simulate a long conversation
    old_messages = [
        {"role": "user", "content": "I'm planning a trip to Japan."},
        {"role": "assistant", "content": "Great choice! Japan offers amazing culture, food, and scenery."},
        {"role": "user", "content": "I want to visit Tokyo and Kyoto."},
        {"role": "assistant", "content": "Those are the two most popular destinations. Tokyo for modern city life, Kyoto for traditional temples."},
        {"role": "user", "content": "I'll be there for 2 weeks in April."},
        {"role": "assistant", "content": "Perfect timing for cherry blossom season! I recommend splitting your time evenly."},
        {"role": "user", "content": "My budget is around $5000."},
        {"role": "assistant", "content": "That's a good budget for 2 weeks. You can stay in nice hotels and enjoy quality experiences."},
    ]

    # Summarize the old conversation
    summary_prompt = "Summarize this conversation in 2-3 sentences, focusing on key details:\n\n"
    for msg in old_messages:
        summary_prompt += f"{msg['role'].upper()}: {msg['content']}\n"

    summary_response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You create concise conversation summaries."},
            {"role": "user", "content": summary_prompt}
        ]
    )

    summary = summary_response.choices[0].message.content
    print(f"Conversation Summary: {summary}\n")

    # Start new context with summary
    new_messages = [
        {
            "role": "system",
            "content": f"""You are a travel planning assistant.

Previous conversation summary: {summary}

Continue helping the user with their trip."""
        },
        {"role": "user", "content": "What restaurants do you recommend in Tokyo?"}
    ]

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=new_messages
    )

    print(f"User: What restaurants do you recommend in Tokyo?")
    print(f"Assistant: {response.choices[0].message.content}")


def branching_conversations():
    """Handle conversation branching/forking."""
    print("\n=== Branching Conversations ===\n")

    client = OpenAI()

    # Base conversation
    base_messages = [
        {"role": "system", "content": "You are a creative writing assistant."},
        {"role": "user", "content": "Start a story about a detective."},
        {"role": "assistant", "content": "Detective Sarah Chen stood in the rain outside the old warehouse..."}
    ]

    # Branch 1: Mystery direction
    branch1 = base_messages.copy()
    branch1.append({"role": "user", "content": "Make it a supernatural mystery."})

    response1 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=branch1,
        max_tokens=100
    )

    # Branch 2: Action direction
    branch2 = base_messages.copy()
    branch2.append({"role": "user", "content": "Make it an action thriller."})

    response2 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=branch2,
        max_tokens=100
    )

    print("Original: Detective Sarah Chen stood in the rain...\n")
    print("[BRANCH 1 - Supernatural Mystery]")
    print(f"{response1.choices[0].message.content}\n")
    print("[BRANCH 2 - Action Thriller]")
    print(f"{response2.choices[0].message.content}")


# =============================================================================
# Conversation Manager Demo
# =============================================================================

def conversation_manager_demo():
    """Demonstrate the ConversationManager class."""
    print("\n=== Conversation Manager Demo ===\n")

    manager = ConversationManager()

    # Create a support conversation
    manager.create_conversation(
        "support_123",
        "You are a helpful tech support agent. Be friendly and solution-oriented."
    )

    # Simulate support interaction
    exchanges = [
        "Hi, my internet isn't working.",
        "I've tried that already.",
        "It's a wireless connection.",
        "Okay, that worked! Thanks!"
    ]

    for user_input in exchanges:
        response = manager.chat("support_123", user_input)
        print(f"Customer: {user_input}")
        print(f"Support: {response}\n")

    # Get conversation summary
    summary = manager.summarize_conversation("support_123")
    print(f"[Conversation Summary]\n{summary}")


def multi_conversation_demo():
    """Handle multiple concurrent conversations."""
    print("\n=== Multiple Concurrent Conversations ===\n")

    client = OpenAI()

    # Multiple users with separate histories
    users = {
        "alice": {
            "messages": [{"role": "system", "content": "You are helping Alice plan a birthday party."}],
            "context": "birthday planning"
        },
        "bob": {
            "messages": [{"role": "system", "content": "You are helping Bob with coding questions."}],
            "context": "coding help"
        }
    }

    # Interleaved messages from different users
    interactions = [
        ("alice", "I need to plan a party for 20 people."),
        ("bob", "How do I reverse a string in Python?"),
        ("alice", "What about food for the party?"),
        ("bob", "What about lists, how do I reverse those?"),
    ]

    for user_id, message in interactions:
        user_data = users[user_id]
        user_data["messages"].append({"role": "user", "content": message})

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=user_data["messages"],
            max_tokens=80
        )

        assistant_msg = response.choices[0].message.content
        user_data["messages"].append({"role": "assistant", "content": assistant_msg})

        print(f"[{user_id.upper()} - {user_data['context']}]")
        print(f"  User: {message}")
        print(f"  Assistant: {assistant_msg}\n")


def conversation_persistence_demo():
    """Demonstrate saving and loading conversations."""
    print("\n=== Conversation Persistence ===\n")

    client = OpenAI()

    # Create and save a conversation
    conversation = {
        "id": "conv_001",
        "created_at": datetime.now().isoformat(),
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Remember that my favorite color is blue."},
            {"role": "assistant", "content": "I'll remember that your favorite color is blue!"}
        ]
    }

    # Save to JSON (simulated file save)
    saved_json = json.dumps(conversation, indent=2)
    print("Saved conversation:")
    print(saved_json[:200] + "...\n")

    # Load and continue conversation
    loaded = json.loads(saved_json)
    messages = loaded["messages"]
    messages.append({"role": "user", "content": "What's my favorite color?"})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )

    print("Continued from saved state:")
    print(f"User: What's my favorite color?")
    print(f"Assistant: {response.choices[0].message.content}")


# =============================================================================
# Main
# =============================================================================

def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Multi-Turn Conversation Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        print("Set it with: export OPENAI_API_KEY='sk-...'")
        return

    try:
        # Basic examples
        basic_multi_turn()
        conversation_with_context_injection()
        conversation_with_persona()

        # Advanced context management
        sliding_window_context()
        summarization_for_long_context()
        branching_conversations()

        # Conversation manager patterns
        conversation_manager_demo()
        multi_conversation_demo()
        conversation_persistence_demo()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All multi-turn examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
