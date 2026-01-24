#!/usr/bin/env python3
"""
Anthropic Tool Use Example

This example demonstrates complete tool use (function calling) with the
Anthropic Claude API, including parallel tool calls and error handling.

Usage:
    python tool-use.example.py "What's the weather in London?"
    python tool-use.example.py "Calculate 15% tip on $85.50"
    python tool-use.example.py "Weather in NYC and Tokyo, then convert temps"

Requirements:
    pip install anthropic
    export ANTHROPIC_API_KEY="sk-ant-..."
"""

import json
import sys
import logging
from typing import Dict, Any, List, Callable

from anthropic import Anthropic, APIError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Tool Implementations (Replace with your actual implementations)
# =============================================================================

def get_weather(location: str, unit: str = "celsius") -> Dict[str, Any]:
    """Get current weather for a location.

    In production, this would call a weather API.
    """
    # Simulated weather data
    weather_data = {
        "london": {"temp": 12, "conditions": "cloudy", "humidity": 75},
        "new york": {"temp": 18, "conditions": "sunny", "humidity": 55},
        "tokyo": {"temp": 22, "conditions": "partly cloudy", "humidity": 60},
        "paris": {"temp": 15, "conditions": "rainy", "humidity": 80},
    }

    location_key = location.lower()
    data = weather_data.get(location_key, {"temp": 20, "conditions": "unknown", "humidity": 50})

    if unit == "fahrenheit":
        data["temp"] = round(data["temp"] * 9/5 + 32)

    return {
        "location": location,
        "temperature": data["temp"],
        "unit": unit,
        "conditions": data["conditions"],
        "humidity": data["humidity"]
    }


def calculate(expression: str) -> Dict[str, Any]:
    """Evaluate a mathematical expression safely."""
    try:
        # Only allow safe mathematical operations
        allowed_chars = set("0123456789+-*/.() %")
        if not all(c in allowed_chars for c in expression):
            return {"error": "Invalid characters in expression"}

        # Replace % with /100* for percentage calculations
        expr = expression.replace("%", "/100*")
        result = eval(expr)

        return {
            "expression": expression,
            "result": round(result, 2) if isinstance(result, float) else result
        }
    except Exception as e:
        return {"error": str(e)}


def convert_temperature(value: float, from_unit: str, to_unit: str) -> Dict[str, Any]:
    """Convert temperature between Celsius and Fahrenheit."""
    if from_unit == to_unit:
        return {"value": value, "unit": to_unit}

    if from_unit == "celsius" and to_unit == "fahrenheit":
        converted = round(value * 9/5 + 32, 1)
    elif from_unit == "fahrenheit" and to_unit == "celsius":
        converted = round((value - 32) * 5/9, 1)
    else:
        return {"error": f"Unknown conversion: {from_unit} to {to_unit}"}

    return {
        "original": {"value": value, "unit": from_unit},
        "converted": {"value": converted, "unit": to_unit}
    }


# =============================================================================
# Tool Definitions
# =============================================================================

TOOLS = [
    {
        "name": "get_weather",
        "description": "Get the current weather for a location. Returns temperature, conditions, and humidity.",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, e.g., 'London', 'New York', 'Tokyo'"
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Temperature unit. Default is celsius."
                }
            },
            "required": ["location"]
        }
    },
    {
        "name": "calculate",
        "description": "Perform a mathematical calculation. Supports basic operations (+, -, *, /) and percentages.",
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "Mathematical expression to evaluate, e.g., '15% * 85.50' or '(100 + 50) / 3'"
                }
            },
            "required": ["expression"]
        }
    },
    {
        "name": "convert_temperature",
        "description": "Convert temperature between Celsius and Fahrenheit.",
        "input_schema": {
            "type": "object",
            "properties": {
                "value": {
                    "type": "number",
                    "description": "Temperature value to convert"
                },
                "from_unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Original temperature unit"
                },
                "to_unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Target temperature unit"
                }
            },
            "required": ["value", "from_unit", "to_unit"]
        }
    }
]

# Map tool names to implementations
TOOL_HANDLERS: Dict[str, Callable] = {
    "get_weather": get_weather,
    "calculate": calculate,
    "convert_temperature": convert_temperature
}


# =============================================================================
# Tool Execution Loop
# =============================================================================

def process_tool_calls(
    client: Anthropic,
    user_message: str,
    max_iterations: int = 10
) -> str:
    """Process a user message, handling any tool calls.

    Args:
        client: Anthropic client
        user_message: User's input message
        max_iterations: Maximum tool call iterations

    Returns:
        Final text response from Claude
    """
    messages = [{"role": "user", "content": user_message}]

    for iteration in range(max_iterations):
        logger.info(f"Iteration {iteration + 1}/{max_iterations}")

        # Make API call
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=TOOLS,
            messages=messages
        )

        logger.info(f"Stop reason: {response.stop_reason}")

        # If end_turn, extract and return text
        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    return block.text
            return ""

        # Find tool_use blocks
        tool_uses = [b for b in response.content if b.type == "tool_use"]

        if not tool_uses:
            # No tool calls, return any text
            for block in response.content:
                if block.type == "text":
                    return block.text
            return ""

        logger.info(f"Processing {len(tool_uses)} tool call(s)")

        # Add assistant message to conversation
        messages.append({
            "role": "assistant",
            "content": response.content
        })

        # Execute tools and collect results
        tool_results = []
        for tool_use in tool_uses:
            logger.info(f"Calling tool: {tool_use.name}")
            logger.info(f"  Input: {tool_use.input}")

            handler = TOOL_HANDLERS.get(tool_use.name)
            if handler:
                try:
                    result = handler(**tool_use.input)
                except Exception as e:
                    result = {"error": str(e)}
            else:
                result = {"error": f"Unknown tool: {tool_use.name}"}

            logger.info(f"  Result: {result}")

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": json.dumps(result)
            })

        # Add tool results to conversation
        messages.append({
            "role": "user",
            "content": tool_results
        })

    raise RuntimeError(f"Exceeded max iterations ({max_iterations})")


# =============================================================================
# Interactive Examples
# =============================================================================

def run_examples():
    """Run a series of example queries."""
    client = Anthropic()

    examples = [
        "What's the weather like in London?",
        "Calculate a 15% tip on a $85.50 bill",
        "What's the weather in Tokyo in Fahrenheit?",
        "Get the weather in Paris and New York, then tell me which is warmer",
    ]

    for query in examples:
        print(f"\n{'='*60}")
        print(f"Query: {query}")
        print("=" * 60)

        try:
            result = process_tool_calls(client, query)
            print(f"\nResponse: {result}")
        except Exception as e:
            print(f"\nError: {e}")


def main():
    """Main entry point."""
    if len(sys.argv) > 1:
        # Process command line argument
        query = " ".join(sys.argv[1:])
        print(f"Query: {query}\n")

        try:
            client = Anthropic()
            result = process_tool_calls(client, query)
            print(f"\nResponse: {result}")
        except APIError as e:
            print(f"API Error: {e}")
            sys.exit(1)
    else:
        # Run examples
        print("Anthropic Tool Use Examples")
        print("=" * 60)
        print("\nUsage: python tool-use.example.py \"Your question here\"")
        print("\nAvailable tools:")
        print("  - get_weather: Get weather for a city")
        print("  - calculate: Math calculations")
        print("  - convert_temperature: Celsius/Fahrenheit conversion")
        print("\nRunning example queries...\n")

        try:
            run_examples()
        except Exception as e:
            print(f"\nError: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
