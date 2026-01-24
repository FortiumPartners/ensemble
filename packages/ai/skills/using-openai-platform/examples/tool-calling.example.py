#!/usr/bin/env python3
"""
Tool Calling (Function Calling) Example

This example demonstrates OpenAI's tool calling capabilities:
- Defining tools with JSON schemas
- Handling tool call requests
- Executing tools and returning results
- Parallel tool calls
- Complete tool execution loop

Usage:
    python tool-calling.example.py
"""

import os
import json
import logging
from typing import List, Dict, Any, Callable
from datetime import datetime

from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Tool Implementations
# =============================================================================

def get_current_weather(location: str, unit: str = "celsius") -> Dict[str, Any]:
    """Get the current weather for a location.

    In a real application, this would call a weather API.
    """
    # Simulated weather data
    weather_data = {
        "new york": {"temp": 22, "conditions": "partly cloudy", "humidity": 65},
        "london": {"temp": 15, "conditions": "rainy", "humidity": 80},
        "tokyo": {"temp": 28, "conditions": "sunny", "humidity": 70},
        "paris": {"temp": 18, "conditions": "cloudy", "humidity": 75},
    }

    location_lower = location.lower()
    data = weather_data.get(location_lower, {"temp": 20, "conditions": "unknown", "humidity": 50})

    temp = data["temp"]
    if unit == "fahrenheit":
        temp = (temp * 9/5) + 32

    return {
        "location": location,
        "temperature": temp,
        "unit": unit,
        "conditions": data["conditions"],
        "humidity": data["humidity"]
    }


def get_current_time(timezone: str = "UTC") -> Dict[str, str]:
    """Get the current time in a timezone.

    In a real application, this would use proper timezone handling.
    """
    now = datetime.now()
    return {
        "timezone": timezone,
        "time": now.strftime("%H:%M:%S"),
        "date": now.strftime("%Y-%m-%d"),
        "day_of_week": now.strftime("%A")
    }


def calculate(expression: str) -> Dict[str, Any]:
    """Safely evaluate a mathematical expression."""
    try:
        # Only allow safe mathematical operations
        allowed_chars = set("0123456789+-*/.() ")
        if not all(c in allowed_chars for c in expression):
            return {"error": "Invalid characters in expression"}

        result = eval(expression)
        return {
            "expression": expression,
            "result": result
        }
    except Exception as e:
        return {"error": str(e)}


def search_products(query: str, category: str = None, limit: int = 5) -> Dict[str, Any]:
    """Search for products in a catalog.

    In a real application, this would query a database.
    """
    # Simulated product data
    products = [
        {"id": 1, "name": "Laptop Pro", "category": "electronics", "price": 1299},
        {"id": 2, "name": "Wireless Mouse", "category": "electronics", "price": 49},
        {"id": 3, "name": "Coffee Maker", "category": "kitchen", "price": 89},
        {"id": 4, "name": "Running Shoes", "category": "sports", "price": 129},
        {"id": 5, "name": "Desk Lamp", "category": "office", "price": 45},
    ]

    # Filter by query (simple substring match)
    results = [p for p in products if query.lower() in p["name"].lower()]

    # Filter by category if specified
    if category:
        results = [p for p in results if p["category"] == category.lower()]

    return {
        "query": query,
        "category": category,
        "count": len(results[:limit]),
        "products": results[:limit]
    }


# =============================================================================
# Tool Definitions
# =============================================================================

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city name, e.g., 'New York', 'London'"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "The temperature unit to use"
                    }
                },
                "required": ["location"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current time in a timezone",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "The timezone, e.g., 'UTC', 'EST', 'PST'"
                    }
                },
                "required": [],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Perform a mathematical calculation",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "The mathematical expression to evaluate, e.g., '2 + 2'"
                    }
                },
                "required": ["expression"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": "Search for products in the catalog",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for product names"
                    },
                    "category": {
                        "type": "string",
                        "enum": ["electronics", "kitchen", "sports", "office"],
                        "description": "Optional category filter"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return",
                        "default": 5
                    }
                },
                "required": ["query"],
                "additionalProperties": False
            }
        }
    }
]

# Map function names to implementations
AVAILABLE_FUNCTIONS: Dict[str, Callable] = {
    "get_current_weather": get_current_weather,
    "get_current_time": get_current_time,
    "calculate": calculate,
    "search_products": search_products
}


# =============================================================================
# Tool Execution Engine
# =============================================================================

class ToolCallingAgent:
    """Agent that handles tool calling with OpenAI."""

    def __init__(self, model: str = "gpt-4o-mini"):
        self.client = OpenAI()
        self.model = model
        self.messages: List[Dict] = []

    def reset(self):
        """Reset conversation history."""
        self.messages = []

    def chat(self, user_message: str) -> str:
        """Process a user message, handling any tool calls.

        Args:
            user_message: The user's message

        Returns:
            The final response from the assistant
        """
        self.messages.append({"role": "user", "content": user_message})

        while True:
            # Get response from model
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=TOOLS,
                tool_choice="auto"
            )

            message = response.choices[0].message
            self.messages.append(message)

            # If no tool calls, we're done
            if not message.tool_calls:
                return message.content

            # Process each tool call
            logger.info(f"Processing {len(message.tool_calls)} tool call(s)")

            for tool_call in message.tool_calls:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)

                logger.info(f"Calling {function_name} with {function_args}")

                # Execute the function
                if function_name in AVAILABLE_FUNCTIONS:
                    result = AVAILABLE_FUNCTIONS[function_name](**function_args)
                else:
                    result = {"error": f"Unknown function: {function_name}"}

                # Add result to messages
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })

            # Continue the loop to get the final response


# =============================================================================
# Examples
# =============================================================================

def single_tool_example():
    """Demonstrate a single tool call."""
    print("\n=== Single Tool Call ===\n")

    agent = ToolCallingAgent()
    response = agent.chat("What's the weather like in Tokyo?")
    print(f"User: What's the weather like in Tokyo?")
    print(f"Assistant: {response}")


def parallel_tool_example():
    """Demonstrate parallel tool calls."""
    print("\n=== Parallel Tool Calls ===\n")

    agent = ToolCallingAgent()
    response = agent.chat(
        "What's the weather in London and Paris? Also, what time is it?"
    )
    print(f"User: What's the weather in London and Paris? Also, what time is it?")
    print(f"Assistant: {response}")


def calculation_example():
    """Demonstrate the calculation tool."""
    print("\n=== Calculation Tool ===\n")

    agent = ToolCallingAgent()
    response = agent.chat("What is 15% of 250?")
    print(f"User: What is 15% of 250?")
    print(f"Assistant: {response}")


def product_search_example():
    """Demonstrate the product search tool."""
    print("\n=== Product Search Tool ===\n")

    agent = ToolCallingAgent()
    response = agent.chat("Find me some electronics products")
    print(f"User: Find me some electronics products")
    print(f"Assistant: {response}")


def multi_turn_with_tools():
    """Demonstrate multi-turn conversation with tools."""
    print("\n=== Multi-Turn with Tools ===\n")

    agent = ToolCallingAgent()

    # First turn
    response1 = agent.chat("What's the weather in New York?")
    print(f"User: What's the weather in New York?")
    print(f"Assistant: {response1}\n")

    # Second turn (follow-up)
    response2 = agent.chat("How about in celsius?")
    print(f"User: How about in celsius?")
    print(f"Assistant: {response2}")


def main():
    """Run all examples."""
    print("=" * 60)
    print("OpenAI Tool Calling Examples")
    print("=" * 60)

    # Check for API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("\nError: OPENAI_API_KEY environment variable not set.")
        return

    try:
        single_tool_example()
        parallel_tool_example()
        calculation_example()
        product_search_example()
        multi_turn_with_tools()

    except Exception as e:
        logger.error(f"Example failed: {e}")
        raise

    print("\n" + "=" * 60)
    print("All examples completed successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
