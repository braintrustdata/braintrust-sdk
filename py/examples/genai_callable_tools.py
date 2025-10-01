#!/usr/bin/env python3
"""
Example demonstrating how to use callable functions as tools with the Braintrust
wrapper for Google Gemini API.

The Braintrust wrapper automatically converts Python callable functions to the
FunctionDeclaration format required by the Gemini API.
"""

import os
from typing import Dict, List

# Import Google Gemini SDK
import google.genai as genai

# Import Braintrust and set up the wrapper
from braintrust.wrappers import genai as genai_wrapper
from google.genai import types


# Define some callable functions that can be used as tools
def get_weather(location: str, unit: str = "celsius") -> Dict[str, str]:
    """Get the current weather for a location.

    Args:
        location: The city and state, e.g. San Francisco, CA
        unit: Temperature unit, either 'celsius' or 'fahrenheit'

    Returns:
        A dictionary with weather information
    """
    # This is a mock implementation - in real use, you'd call a weather API
    weather_data = {
        "San Francisco, CA": {"celsius": "15", "fahrenheit": "59", "condition": "foggy"},
        "New York, NY": {"celsius": "5", "fahrenheit": "41", "condition": "clear"},
        "London, UK": {"celsius": "10", "fahrenheit": "50", "condition": "rainy"},
    }

    data = weather_data.get(location, {"celsius": "20", "fahrenheit": "68", "condition": "unknown"})
    temp = data[unit]

    return {"location": location, "temperature": f"{temp}°{unit[0].upper()}", "condition": data["condition"]}


def calculate_tip(bill_amount: float, tip_percentage: float = 18.0) -> Dict[str, float]:
    """Calculate the tip amount for a bill.

    Args:
        bill_amount: The total bill amount in dollars
        tip_percentage: The tip percentage (default 18%)

    Returns:
        A dictionary with tip and total amounts
    """
    tip_amount = bill_amount * (tip_percentage / 100)
    total = bill_amount + tip_amount

    return {
        "bill_amount": bill_amount,
        "tip_percentage": tip_percentage,
        "tip_amount": round(tip_amount, 2),
        "total": round(total, 2),
    }


def search_products(query: str, category: str = None, max_results: int = 5) -> List[Dict]:
    """Search for products in an online store.

    Args:
        query: The search query
        category: Optional category to filter by
        max_results: Maximum number of results to return

    Returns:
        A list of product dictionaries
    """
    # Mock product database
    products = [
        {"name": "Laptop", "category": "electronics", "price": 999.99},
        {"name": "Wireless Mouse", "category": "electronics", "price": 29.99},
        {"name": "Coffee Maker", "category": "kitchen", "price": 79.99},
        {"name": "Running Shoes", "category": "sports", "price": 89.99},
        {"name": "Yoga Mat", "category": "sports", "price": 39.99},
    ]

    # Filter by query and category
    results = []
    for product in products:
        if query.lower() in product["name"].lower():
            if category is None or product["category"] == category:
                results.append(product)
                if len(results) >= max_results:
                    break

    return results


def main():
    """Main function demonstrating the use of callable tools with Gemini."""

    # Initialize Braintrust wrapper for Gemini
    # This will automatically wrap the Gemini client to handle callable tool conversion
    genai_wrapper.setup_genai(project_name="genai-callable-tools-example")

    # Get API key from environment
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Please set GEMINI_API_KEY environment variable")
        return

    # Create Gemini client
    client = genai.Client(api_key=api_key)

    # Example 1: Using a single callable tool
    print("=" * 60)
    print("Example 1: Weather Query with Callable Tool")
    print("=" * 60)

    # Create config with callable function as tool
    # The Braintrust wrapper will automatically convert this to FunctionDeclaration
    config = types.GenerateContentConfig(
        tools=[get_weather],  # Just pass the function directly!
        temperature=0.7,
    )

    # Generate content with tool usage
    response = client.models.generate_content(
        model="gemini-2.0-flash-exp", contents="What's the weather like in San Francisco?", config=config
    )

    print(f"Response: {response.text}")
    print()

    # Example 2: Multiple callable tools
    print("=" * 60)
    print("Example 2: Multiple Callable Tools")
    print("=" * 60)

    # Create config with multiple callable functions
    # Each will be converted to its own FunctionDeclaration automatically
    config_multi = types.GenerateContentConfig(
        tools=[get_weather, calculate_tip, search_products],
        temperature=0.7,
    )

    # Query that might use multiple tools
    response = client.models.generate_content(
        model="gemini-2.0-flash-exp",
        contents="I'm in New York and just had a $45 dinner. What's the weather like and how much should I tip?",
        config=config_multi,
    )

    print(f"Response: {response.text}")
    print()

    # Example 3: Mixing callable and pre-defined tools
    print("=" * 60)
    print("Example 3: Mixed Tool Types")
    print("=" * 60)

    # Create a manual FunctionDeclaration (the traditional way)
    manual_function = types.FunctionDeclaration(
        name="get_time",
        description="Get the current time",
        parameters=types.Schema(
            type="OBJECT",
            properties={
                "timezone": types.Schema(type="STRING", description="The timezone (e.g., 'UTC', 'EST', 'PST')")
            },
            required=["timezone"],
        ),
    )

    # Create a Tool with the manual declaration
    manual_tool = types.Tool(function_declarations=[manual_function])

    # Mix callable functions with pre-defined tools
    # The wrapper will convert callables and preserve existing Tools
    config_mixed = types.GenerateContentConfig(
        tools=[
            get_weather,  # Callable - will be converted
            calculate_tip,  # Callable - will be converted
            manual_tool,  # Already a Tool - preserved as-is
        ],
        temperature=0.7,
    )

    response = client.models.generate_content(
        model="gemini-2.0-flash-exp",
        contents="What time is it in UTC and what's the weather in London?",
        config=config_mixed,
    )

    print(f"Response: {response.text}")
    print()

    # Example 4: Demonstrating the conversion
    print("=" * 60)
    print("Example 4: Inspecting the Conversion")
    print("=" * 60)

    # Show how the callable is converted to FunctionDeclaration
    from braintrust.wrappers.genai import process_config_tools

    # Create a config with callables
    original_config = types.GenerateContentConfig(tools=[get_weather, calculate_tip])

    print("Original tools (callables):")
    for i, tool in enumerate(original_config.tools, 1):
        print(f"  {i}. {tool}")

    # Process the config (this happens automatically in the wrapper)
    args = ("model", "contents", original_config)
    processed_args, _ = process_config_tools(args, {}, 2)
    processed_config = processed_args[2]

    print("\nProcessed tools (FunctionDeclarations):")
    for i, tool in enumerate(processed_config.tools, 1):
        print(f"  {i}. {tool.__class__.__name__}")
        if hasattr(tool, "function_declarations"):
            for func_decl in tool.function_declarations:
                print(f"     - {func_decl.name}: {func_decl.description[:50]}...")

    print("\n" + "=" * 60)
    print("Benefits of using callable tools with Braintrust:")
    print("=" * 60)
    print("1. No need to manually create FunctionDeclaration objects")
    print("2. Type hints and docstrings are automatically parsed")
    print("3. Parameters with defaults are handled correctly")
    print("4. Clean, Pythonic interface for tool definitions")
    print("5. Full Braintrust logging and tracing support")


if __name__ == "__main__":
    main()
