#!/usr/bin/env python3
"""
OpenAI Tool Calling Template

This template provides a production-ready tool calling (function calling)
implementation with a complete execution loop and error handling.

Placeholders:
- {{model}} - Model ID (e.g., "gpt-5", "gpt-4o-mini")
- {{system_prompt}} - System message content (optional)
- {{max_iterations}} - Maximum tool call iterations (default: 10)

Usage:
    python tool-calling.py "What's the weather in London?"
"""

import json
import sys
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable

from openai import OpenAI, APIError, RateLimitError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
MODEL = "{{model}}"
SYSTEM_PROMPT = "{{system_prompt}}"
MAX_ITERATIONS = {{max_iterations}}


# =============================================================================
# Tool Definition Framework
# =============================================================================

@dataclass
class ToolParameter:
    """Definition for a tool parameter."""
    name: str
    type: str  # "string", "integer", "number", "boolean", "array", "object"
    description: str
    required: bool = True
    enum: Optional[List[str]] = None
    default: Any = None


@dataclass
class ToolDefinition:
    """Definition for a callable tool."""
    name: str
    description: str
    parameters: List[ToolParameter] = field(default_factory=list)
    handler: Optional[Callable[..., Any]] = None

    def to_openai_schema(self) -> Dict[str, Any]:
        """Convert to OpenAI tool schema format."""
        properties = {}
        required = []

        for param in self.parameters:
            prop = {
                "type": param.type,
                "description": param.description
            }
            if param.enum:
                prop["enum"] = param.enum
            if param.default is not None:
                prop["default"] = param.default

            properties[param.name] = prop

            if param.required:
                required.append(param.name)

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False
                }
            }
        }


@dataclass
class ToolResult:
    """Result of a tool execution."""
    tool_call_id: str
    name: str
    result: Any
    success: bool = True
    error: Optional[str] = None

    def to_message(self) -> Dict[str, Any]:
        """Convert to OpenAI message format."""
        if self.success:
            content = json.dumps(self.result) if not isinstance(self.result, str) else self.result
        else:
            content = json.dumps({"error": self.error})

        return {
            "role": "tool",
            "tool_call_id": self.tool_call_id,
            "content": content
        }


# =============================================================================
# Tool Registry
# =============================================================================

class ToolRegistry:
    """Registry for managing tools."""

    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, tool: ToolDefinition) -> None:
        """Register a tool."""
        if not tool.handler:
            raise ValueError(f"Tool '{tool.name}' must have a handler")
        self._tools[tool.name] = tool
        logger.info(f"Registered tool: {tool.name}")

    def register_function(
        self,
        name: str,
        description: str,
        parameters: List[ToolParameter],
        handler: Callable[..., Any]
    ) -> ToolDefinition:
        """Register a function as a tool."""
        tool = ToolDefinition(
            name=name,
            description=description,
            parameters=parameters,
            handler=handler
        )
        self.register(tool)
        return tool

    def get(self, name: str) -> Optional[ToolDefinition]:
        """Get a tool by name."""
        return self._tools.get(name)

    def get_all_schemas(self) -> List[Dict[str, Any]]:
        """Get OpenAI schemas for all registered tools."""
        return [tool.to_openai_schema() for tool in self._tools.values()]

    def execute(
        self,
        tool_call_id: str,
        name: str,
        arguments: Dict[str, Any]
    ) -> ToolResult:
        """Execute a tool and return the result."""
        tool = self.get(name)

        if not tool:
            logger.error(f"Unknown tool: {name}")
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                result=None,
                success=False,
                error=f"Unknown tool: {name}"
            )

        try:
            logger.info(f"Executing tool: {name} with args: {arguments}")
            result = tool.handler(**arguments)
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                result=result,
                success=True
            )

        except Exception as e:
            logger.error(f"Tool '{name}' failed: {e}")
            return ToolResult(
                tool_call_id=tool_call_id,
                name=name,
                result=None,
                success=False,
                error=str(e)
            )


# =============================================================================
# Tool Calling Client
# =============================================================================

class ToolCallingClient:
    """OpenAI client with tool calling support."""

    def __init__(
        self,
        model: str = MODEL,
        system_prompt: str = SYSTEM_PROMPT,
        max_iterations: int = MAX_ITERATIONS,
        registry: Optional[ToolRegistry] = None
    ):
        """Initialize the tool calling client.

        Args:
            model: OpenAI model ID
            system_prompt: System message for the conversation
            max_iterations: Maximum tool call iterations to prevent loops
            registry: Tool registry (creates new if None)
        """
        self.client = OpenAI()
        self.model = model
        self.system_prompt = system_prompt
        self.max_iterations = max_iterations
        self.registry = registry or ToolRegistry()
        self.messages: List[Dict[str, Any]] = []

        # Initialize with system prompt
        if self.system_prompt:
            self.messages.append({
                "role": "system",
                "content": self.system_prompt
            })

    def register_tool(
        self,
        name: str,
        description: str,
        parameters: List[ToolParameter],
        handler: Callable[..., Any]
    ) -> ToolDefinition:
        """Register a new tool.

        Args:
            name: Tool name
            description: Tool description for the model
            parameters: List of parameter definitions
            handler: Function to execute when tool is called

        Returns:
            The registered ToolDefinition
        """
        return self.registry.register_function(name, description, parameters, handler)

    def chat(
        self,
        user_message: str,
        tool_choice: str = "auto"
    ) -> str:
        """Send a message and handle any tool calls.

        Args:
            user_message: The user's message
            tool_choice: "auto", "none", "required", or specific tool name

        Returns:
            The assistant's final response

        Raises:
            RuntimeError: If max iterations exceeded
            APIError: On API errors
        """
        self.messages.append({
            "role": "user",
            "content": user_message
        })

        tools = self.registry.get_all_schemas()
        iteration = 0

        while iteration < self.max_iterations:
            iteration += 1
            logger.info(f"Iteration {iteration}/{self.max_iterations}")

            try:
                # Make API call
                kwargs = {
                    "model": self.model,
                    "messages": self.messages,
                }

                # Only include tools if we have any registered
                if tools:
                    kwargs["tools"] = tools
                    kwargs["tool_choice"] = tool_choice

                response = self.client.chat.completions.create(**kwargs)
                message = response.choices[0].message

                # Add assistant message to history
                self.messages.append(message.model_dump())

                # Check for tool calls
                if not message.tool_calls:
                    # No tool calls, return the response
                    logger.info("No tool calls, returning response")
                    return message.content or ""

                # Process tool calls
                logger.info(f"Processing {len(message.tool_calls)} tool call(s)")

                for tool_call in message.tool_calls:
                    # Parse arguments
                    try:
                        arguments = json.loads(tool_call.function.arguments)
                    except json.JSONDecodeError as e:
                        arguments = {}
                        logger.error(f"Failed to parse arguments: {e}")

                    # Execute tool
                    result = self.registry.execute(
                        tool_call_id=tool_call.id,
                        name=tool_call.function.name,
                        arguments=arguments
                    )

                    # Add result to messages
                    self.messages.append(result.to_message())

            except RateLimitError:
                logger.error("Rate limit exceeded")
                raise

            except APIError as e:
                logger.error(f"API error: {e}")
                raise

        raise RuntimeError(f"Exceeded maximum iterations ({self.max_iterations})")

    def clear_history(self) -> None:
        """Clear conversation history, keeping system prompt."""
        self.messages = []
        if self.system_prompt:
            self.messages.append({
                "role": "system",
                "content": self.system_prompt
            })

    def get_history(self) -> List[Dict[str, Any]]:
        """Get the current conversation history."""
        return self.messages.copy()


# =============================================================================
# Example Tools (Replace with your own)
# =============================================================================

def get_weather(location: str, unit: str = "celsius") -> Dict[str, Any]:
    """Example: Get weather for a location.

    Replace this with your actual weather API integration.
    """
    # Simulated response - replace with actual API call
    return {
        "location": location,
        "temperature": 22 if unit == "celsius" else 72,
        "unit": unit,
        "conditions": "partly cloudy",
        "humidity": 65
    }


def calculate(expression: str) -> Dict[str, Any]:
    """Example: Evaluate a mathematical expression.

    Warning: Uses eval() - replace with a proper math parser in production.
    """
    try:
        # Basic safety check - only allow safe characters
        allowed = set("0123456789+-*/.() ")
        if not all(c in allowed for c in expression):
            return {"error": "Invalid characters in expression"}

        result = eval(expression)
        return {"expression": expression, "result": result}
    except Exception as e:
        return {"error": str(e)}


def create_example_client() -> ToolCallingClient:
    """Create a client with example tools registered.

    Modify this function to register your own tools.
    """
    client = ToolCallingClient()

    # Register weather tool
    client.register_tool(
        name="get_weather",
        description="Get the current weather in a given location",
        parameters=[
            ToolParameter(
                name="location",
                type="string",
                description="The city name, e.g., 'London', 'New York'"
            ),
            ToolParameter(
                name="unit",
                type="string",
                description="Temperature unit",
                required=False,
                enum=["celsius", "fahrenheit"],
                default="celsius"
            )
        ],
        handler=get_weather
    )

    # Register calculator tool
    client.register_tool(
        name="calculate",
        description="Perform a mathematical calculation",
        parameters=[
            ToolParameter(
                name="expression",
                type="string",
                description="The mathematical expression to evaluate, e.g., '2 + 2'"
            )
        ],
        handler=calculate
    )

    return client


# =============================================================================
# CLI Entry Point
# =============================================================================

def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print("Usage: python tool-calling.py <message>")
        print("\nExample tools registered:")
        print("  - get_weather: Get weather for a location")
        print("  - calculate: Evaluate a math expression")
        print("\nExamples:")
        print('  python tool-calling.py "What\'s the weather in Tokyo?"')
        print('  python tool-calling.py "Calculate 15% of 250"')
        sys.exit(1)

    user_input = " ".join(sys.argv[1:])

    try:
        client = create_example_client()
        response = client.chat(user_input)
        print(response)

    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)

    except APIError as e:
        print(f"API Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
