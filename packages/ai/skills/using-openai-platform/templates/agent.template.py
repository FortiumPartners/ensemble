#!/usr/bin/env python3
"""
OpenAI Agents SDK Template

This template provides a production-ready Agents SDK implementation
with thread management and tool integration.

Placeholders:
- {{agent_name}} - Agent display name
- {{agent_instructions}} - Agent behavior instructions
- {{model}} - Model ID (e.g., "gpt-5")

Usage:
    python agent.py "Analyze this data and create a chart"
"""

import sys
import time
import logging
from typing import List, Optional, Dict, Any

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
AGENT_NAME = "{{agent_name}}"
AGENT_INSTRUCTIONS = """{{agent_instructions}}"""
MODEL = "{{model}}"


class AgentClient:
    """OpenAI Agents SDK client with thread management."""

    def __init__(
        self,
        name: str = AGENT_NAME,
        instructions: str = AGENT_INSTRUCTIONS,
        model: str = MODEL,
        tools: Optional[List[Dict[str, Any]]] = None
    ):
        """Initialize the agent client.

        Args:
            name: Agent display name
            instructions: Agent behavior instructions
            model: OpenAI model ID
            tools: List of tool configurations
        """
        self.client = OpenAI()
        self.name = name
        self.instructions = instructions
        self.model = model
        self.tools = tools or [{"type": "code_interpreter"}]
        self.agent = None
        self.thread = None

    def create_agent(self) -> str:
        """Create a new agent.

        Returns:
            The agent ID
        """
        logger.info(f"Creating agent: {self.name}")

        self.agent = self.client.beta.assistants.create(
            name=self.name,
            instructions=self.instructions,
            model=self.model,
            tools=self.tools
        )

        logger.info(f"Agent created: {self.agent.id}")
        return self.agent.id

    def create_thread(self) -> str:
        """Create a new conversation thread.

        Returns:
            The thread ID
        """
        logger.info("Creating new thread")

        self.thread = self.client.beta.threads.create()

        logger.info(f"Thread created: {self.thread.id}")
        return self.thread.id

    def add_message(self, content: str, role: str = "user") -> str:
        """Add a message to the current thread.

        Args:
            content: Message content
            role: Message role (user or assistant)

        Returns:
            The message ID
        """
        if not self.thread:
            self.create_thread()

        message = self.client.beta.threads.messages.create(
            thread_id=self.thread.id,
            role=role,
            content=content
        )

        logger.info(f"Message added: {message.id}")
        return message.id

    def run(self, poll_interval: float = 1.0, timeout: float = 300.0) -> str:
        """Run the agent on the current thread.

        Args:
            poll_interval: Seconds between status checks
            timeout: Maximum seconds to wait

        Returns:
            The agent's response

        Raises:
            TimeoutError: If the run exceeds timeout
            RuntimeError: If the run fails
        """
        if not self.agent:
            self.create_agent()

        if not self.thread:
            raise RuntimeError("No thread available. Call add_message first.")

        logger.info("Starting agent run")

        run = self.client.beta.threads.runs.create(
            thread_id=self.thread.id,
            assistant_id=self.agent.id
        )

        # Poll for completion
        start_time = time.time()
        while run.status in ["queued", "in_progress", "requires_action"]:
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Run exceeded {timeout}s timeout")

            time.sleep(poll_interval)
            run = self.client.beta.threads.runs.retrieve(
                thread_id=self.thread.id,
                run_id=run.id
            )
            logger.debug(f"Run status: {run.status}")

        if run.status == "completed":
            logger.info("Run completed successfully")
            return self._get_latest_response()

        elif run.status == "failed":
            error_msg = run.last_error.message if run.last_error else "Unknown error"
            raise RuntimeError(f"Run failed: {error_msg}")

        else:
            raise RuntimeError(f"Unexpected run status: {run.status}")

    def _get_latest_response(self) -> str:
        """Get the latest assistant response from the thread.

        Returns:
            The assistant's response content
        """
        messages = self.client.beta.threads.messages.list(
            thread_id=self.thread.id,
            order="desc",
            limit=1
        )

        for message in messages.data:
            if message.role == "assistant":
                # Handle different content types
                for content in message.content:
                    if content.type == "text":
                        return content.text.value

        return ""

    def chat(self, user_message: str) -> str:
        """Send a message and get a response (convenience method).

        Args:
            user_message: The user's message

        Returns:
            The agent's response
        """
        self.add_message(user_message)
        return self.run()

    def get_messages(self) -> List[Dict[str, str]]:
        """Get all messages in the current thread.

        Returns:
            List of messages with role and content
        """
        if not self.thread:
            return []

        messages = self.client.beta.threads.messages.list(
            thread_id=self.thread.id,
            order="asc"
        )

        result = []
        for message in messages.data:
            content = ""
            for c in message.content:
                if c.type == "text":
                    content += c.text.value
            result.append({
                "role": message.role,
                "content": content
            })

        return result

    def cleanup(self) -> None:
        """Delete the agent and thread."""
        if self.agent:
            logger.info(f"Deleting agent: {self.agent.id}")
            self.client.beta.assistants.delete(self.agent.id)
            self.agent = None

        # Note: Threads are automatically cleaned up after 60 days
        self.thread = None


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print("Usage: python agent.py <message>")
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    agent = None
    try:
        agent = AgentClient()
        response = agent.chat(user_input)
        print(response)

    except TimeoutError as e:
        print(f"Timeout: {e}")
        sys.exit(1)

    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)

    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

    finally:
        # Cleanup agent (optional - uncomment if you want to delete after each run)
        # if agent:
        #     agent.cleanup()
        pass


if __name__ == "__main__":
    main()
