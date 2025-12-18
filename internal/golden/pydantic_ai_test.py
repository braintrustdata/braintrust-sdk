# pyright: reportUnknownMemberType=none
# pyright: reportUnknownVariableType=none
# pyright: reportUnknownParameterType=none
# pyright: reportUnknownArgumentType=none
import asyncio
from pathlib import Path
from typing import Any

from braintrust.otel import BraintrustSpanProcessor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from pydantic import BaseModel
from pydantic_ai import Agent, BinaryContent, ModelSettings
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings

# Configure the global OTel tracer provider
provider = TracerProvider()
trace.set_tracer_provider(provider)

# Send spans to Braintrust
provider.add_span_processor(BraintrustSpanProcessor(parent='project_name:golden-py-pydantic_ai'))

# Enable instrumentation on all agents
Agent.instrument_all()

# Get a tracer for creating spans
tracer = trace.get_tracer(__name__)

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# Test 1: Basic completion
async def test_basic_completion():
    with tracer.start_as_current_span("test_basic_completion"):
        print("\n=== Test 1: Basic Completion ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=100),
        )

        result = await agent.run("What is the capital of France?")
        print(result.output)
        return result


# Test 2: Multi-turn conversation
async def test_multi_turn():
    with tracer.start_as_current_span("test_multi_turn"):
        print("\n=== Test 2: Multi-turn Conversation ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=200),
        )

        # Simulate a multi-turn conversation by passing message history
        message_history = [
            ModelRequest(parts=[UserPromptPart(content="Hi, my name is Alice.")]),
            ModelResponse(parts=[TextPart(content="Hello Alice! Nice to meet you.")]),
        ]

        result = await agent.run(
            "What did I just tell you my name was?",
            message_history=message_history,
        )
        print(result.output)
        return result


# Test 3: System prompt
async def test_system_prompt():
    with tracer.start_as_current_span("test_system_prompt"):
        print("\n=== Test 3: System Prompt ===")
        agent = Agent(
            "openai:gpt-4o",
            system_prompt="You are a pirate. Always respond in pirate speak.",
            model_settings=ModelSettings(max_tokens=150),
        )

        result = await agent.run("Tell me about the weather.")
        print(result.output)
        return result


# Test 4: Streaming response
async def test_streaming():
    with tracer.start_as_current_span("test_streaming"):
        print("\n=== Test 4: Streaming ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=200),
        )

        full_text = ""
        async with agent.run_stream("Count from 1 to 10 slowly.") as result:
            async for text in result.stream_text(delta=True):
                print(text, end="", flush=True)
                full_text += text

        print("\n")
        return full_text


# Test 5: Image input
async def test_image_input():
    with tracer.start_as_current_span("test_image_input"):
        print("\n=== Test 5: Image Input ===")
        image_path = FIXTURES_DIR / "test-image.png"

        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=150),
        )

        with open(image_path, "rb") as f:
            image_data = f.read()

        result = await agent.run(
            [
                BinaryContent(data=image_data, media_type="image/png"),
                "What color is this image?",
            ]
        )
        print(result.output)
        return result


# Test 6: Document input
async def test_document_input():
    with tracer.start_as_current_span("test_document_input"):
        print("\n=== Test 6: Document Input ===")
        pdf_path = FIXTURES_DIR / "test-document.pdf"

        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=150),
        )

        with open(pdf_path, "rb") as f:
            pdf_data = f.read()

        result = await agent.run(
            [
                BinaryContent(data=pdf_data, media_type="application/pdf"),
                "What is in this document?",
            ]
        )
        print(result.output)
        return result


# Test 7: Temperature variations
async def test_temperature_variations():
    with tracer.start_as_current_span("test_temperature_variations"):
        print("\n=== Test 7: Temperature Variations ===")

        configs = [
            {"temperature": 0.0, "top_p": 1.0},
            {"temperature": 1.0, "top_p": 0.9},
            {"temperature": 0.7, "top_p": 0.95},
        ]

        results = []
        for config in configs:
            print(f"\nConfig: temp={config['temperature']}, top_p={config['top_p']}")

            agent = Agent(
                "openai:gpt-4o",
            )

            result = await agent.run(
                "Say something creative.",
                model_settings=ModelSettings(
                    max_tokens=50,
                    temperature=config["temperature"],
                    top_p=config["top_p"],
                ),
            )
            print(result.output)
            results.append(result)

        return results


# Test 8: Stop sequences
async def test_stop_sequences():
    with tracer.start_as_current_span("test_stop_sequences"):
        print("\n=== Test 8: Stop Sequences ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(
                max_tokens=500,
                stop_sequences=["END", "\n\n"],
            ),
        )

        result = await agent.run("Write a short story about a robot.")
        print(result.output)
        return result


# Test 9: Metadata
async def test_metadata():
    with tracer.start_as_current_span("test_metadata"):
        print("\n=== Test 9: Metadata ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=100),
        )

        result = await agent.run("Hello!", deps="test_user_123")
        print(result.output)
        return result


# Test 10: Long context
async def test_long_context():
    with tracer.start_as_current_span("test_long_context"):
        print("\n=== Test 10: Long Context ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=100),
        )

        long_text = "The quick brown fox jumps over the lazy dog. " * 100
        result = await agent.run(
            f"Here is a long text:\n\n{long_text}\n\nHow many times does the word 'fox' appear?"
        )
        print(result.output)
        return result


# Test 11: Mixed content types
async def test_mixed_content():
    with tracer.start_as_current_span("test_mixed_content"):
        print("\n=== Test 11: Mixed Content Types ===")
        image_path = FIXTURES_DIR / "test-image.png"

        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=200),
        )

        with open(image_path, "rb") as f:
            image_data = f.read()

        result = await agent.run(
            [
                "First, look at this image:",
                BinaryContent(data=image_data, media_type="image/png"),
                "Now describe what you see and explain why it matters.",
            ]
        )
        print(result.output)
        return result


# Test 12: Prefill
async def test_prefill():
    with tracer.start_as_current_span("test_prefill"):
        print("\n=== Test 12: Prefill ===")
        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=200),
        )

        result = await agent.run("Write a haiku about coding.")
        print(f"Response: {result.output}")
        return result


# Test 13: Very short max_tokens
async def test_short_max_tokens():
    with tracer.start_as_current_span("test_short_max_tokens"):
        print("\n=== Test 13: Very Short Max Tokens ===")
        agent = Agent(
            "openai:gpt-4o",
        )

        result = await agent.run(
            "What is AI?",
            model_settings=ModelSettings(max_tokens=5),
        )
        print(result.output)
        return result


# Test 14: Tool use
async def test_tool_use():
    with tracer.start_as_current_span("test_tool_use"):
        print("\n=== Test 14: Tool Use ===")

        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=500),
        )

        @agent.tool_plain
        def get_weather(city_and_state: str, unit: str = "celsius") -> str:
            """Get the current weather for a location.

            Args:
                city_and_state: The city and state, e.g. San Francisco, CA
                unit: The unit of temperature (celsius or fahrenheit). Default to celsius.
            """
            return f"22 degrees {unit} and sunny in {city_and_state}"

        result = await agent.run("What is the weather like in Paris, France?")
        print("Response content:")
        print(result.output)
        return result


# Test 15: Tool use with result (multi-turn)
async def test_tool_use_with_result():
    with tracer.start_as_current_span("test_tool_use_with_result"):
        print("\n=== Test 15: Tool Use With Result ===")

        agent = Agent(
            "openai:gpt-4o",
            model_settings=ModelSettings(max_tokens=500),
        )

        @agent.tool_plain
        def calculate(operation: str, a: float, b: float) -> str:
            """Perform a mathematical calculation.

            Args:
                operation: The mathematical operation (add, subtract, multiply, divide)
                a: First number
                b: Second number
            """
            ops = {
                "add": a + b,
                "subtract": a - b,
                "multiply": a * b,
                "divide": a / b if b != 0 else "Error: Division by zero",
            }
            return str(ops.get(operation, "Invalid operation"))

        result = await agent.run("What is 127 multiplied by 49?")
        print("Response (with tool result):")
        print(result.output)
        return result


# Test 16: Reasoning tokens generation and follow-up
async def test_reasoning():
    with tracer.start_as_current_span("test_reasoning"):
        print("\n=== Test 16: Reasoning Tokens & Follow-up ===")

        # First request: Analyze pattern and derive formula
        print("\n--- First request (generate reasoning) ---")
        model = OpenAIResponsesModel("gpt-5-codex")
        agent = Agent(
            model,
            model_settings=OpenAIResponsesModelSettings(
                openai_reasoning_effort="high",
                openai_reasoning_summary="detailed",
            ),
        )

        first_result = await agent.run(
            "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?"
        )
        print("First response:")
        print(first_result.output)

        # Second request: Apply the discovered pattern to solve a new problem
        # Use all_messages() to get the complete message history including reasoning
        print("\n--- Follow-up request (using reasoning context) ---")
        message_history = first_result.all_messages()

        follow_up_result = await agent.run(
            "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
            message_history=message_history,
        )
        print("Follow-up response:")
        print(follow_up_result.output)

        return {"first_result": first_result, "follow_up_result": follow_up_result}


# Test 17: Embeddings
# Skipped - Pydantic AI focuses on agent/chat interactions and doesn't wrap the embeddings API.
# The OpenAI test includes embeddings because it tests the full OpenAI client wrapper.


# Test 18: Response format (JSON schema)
# Skipped - Pydantic AI handles structured output through result_type with Pydantic models,
# which is more type-safe than the OpenAI response_format parameter. We test this approach
# in Tests 18-20 (structured output tests).


# Test 19: Multiple completions (n > 1)
# Skipped - Pydantic AI is designed for agent-based workflows and doesn't support the OpenAI
# 'n' parameter for generating multiple completions in a single request.


# Test 20: Structured output
async def test_structured_output():
    with tracer.start_as_current_span("test_structured_output"):
        print("\n=== Test 20: Structured Output ===")

        class Recipe(BaseModel):
            name: str
            ingredients: list[dict[str, str]]
            steps: list[str]

        agent = Agent(
            "openai:gpt-4o",
            system_prompt="You extract structured information from user queries.",
            result_type=Recipe,
            model_settings=ModelSettings(max_tokens=500),
        )

        result = await agent.run("Generate a simple recipe for chocolate chip cookies.")
        recipe = result.output
        print("Parsed recipe:")
        print(f"Name: {recipe.name}")
        print(f"Ingredients: {len(recipe.ingredients)}")
        print(f"Steps: {len(recipe.steps)}")
        return result


# Test 21: Streaming structured output
async def test_streaming_structured_output():
    with tracer.start_as_current_span("test_streaming_structured_output"):
        print("\n=== Test 21: Streaming Structured Output ===")

        class Product(BaseModel):
            name: str
            description: str
            price: float
            features: list[str]

        agent = Agent(
            "openai:gpt-4o",
            result_type=Product,
            model_settings=ModelSettings(max_tokens=500),
        )

        full_text = ""
        async with agent.run_stream(
            "Generate a product description for a wireless bluetooth headphone."
        ) as result:
            async for text in result.stream_text(delta=True):
                full_text += text

        print("Streaming completed")
        return full_text


# Test 22: Structured output with context
async def test_structured_output_with_context():
    with tracer.start_as_current_span("test_structured_output_with_context"):
        print("\n=== Test 22: Structured Output with Context ===")

        class Comparison(BaseModel):
            recommendation: str
            reasoning: str
            price_comparison: dict[str, Any]
            overall_rating: dict[str, float]

        agent = Agent(
            "openai:gpt-4o",
            system_prompt="You are a helpful shopping assistant. Use the provided product information to make recommendations.",
            result_type=Comparison,
            model_settings=ModelSettings(max_tokens=500),
        )

        product_info = {
            "phone-123": {
                "name": "SuperPhone X",
                "price": 999,
                "specs": "6.5 inch display, 128GB storage, 12MP camera",
            },
            "laptop-456": {
                "name": "ProBook Ultra",
                "price": 1499,
                "specs": "15 inch display, 512GB SSD, 16GB RAM",
            },
        }

        reviews = {
            "phone-123": {
                "rating": 4.5,
                "comments": ["Great camera!", "Battery lasts all day", "A bit pricey"],
            },
            "laptop-456": {
                "rating": 4.2,
                "comments": ["Fast performance", "Good display", "Heavy to carry"],
            },
        }

        result = await agent.run(
            f"""Compare phone-123 and laptop-456. Here is the product info and reviews:

Product Info:
- phone-123: {product_info['phone-123']}
- laptop-456: {product_info['laptop-456']}

Reviews:
- phone-123: {reviews['phone-123']}
- laptop-456: {reviews['laptop-456']}

Give me a structured comparison with your recommendation."""
        )

        comparison = result.output
        print("Product comparison:")
        print(f"Recommendation: {comparison.recommendation}")
        print(f"Reasoning: {comparison.reasoning}")
        return result


# Test 23: Error handling
async def test_error_handling():
    with tracer.start_as_current_span("test_error_handling"):
        print("\n=== Test 23: Error Handling ===")

        # Test 1: Invalid image URL (404)
        with tracer.start_as_current_span("test_error_invalid_image_url"):
            print("\n--- Test 1: Invalid Image URL ---")
            try:
                agent = Agent(
                    "openai:gpt-4o",
                    model_settings=ModelSettings(max_tokens=100),
                )
                await agent.run(
                    [
                        BinaryContent.from_url(
                            "https://example.com/nonexistent-image-404.jpg"
                        ),
                        "What's in this image?",
                    ],
                )
                raise Exception("Should have thrown an error")
            except Exception as e:
                print(f"Caught image URL error:")
                print(f"  Type: {type(e).__name__}")
                print(f"  Message: {e}")

        # Test 2: Tool choice for non-existent function
        # Skipped - Pydantic AI doesn't expose low-level tool_choice parameter like OpenAI.
        # Tool selection is handled automatically by the agent.

        # Test 3: Tool call ID mismatch
        # Skipped - Pydantic AI abstracts away tool call IDs. This low-level OpenAI API
        # detail is not exposed in Pydantic AI's agent interface.

        # Test 4: Corrupted base64 image data
        with tracer.start_as_current_span("test_error_corrupted_base64_image"):
            print("\n--- Test 4: Corrupted Base64 Image ---")
            try:
                agent = Agent(
                    "openai:gpt-4o",
                    model_settings=ModelSettings(max_tokens=100),
                )
                await agent.run(
                    [
                        BinaryContent(
                            data=b"INVALID_BASE64_DATA!!!",
                            media_type="image/png",
                        ),
                        "What's in this image?",
                    ],
                )
                raise Exception("Should have thrown an error")
            except Exception as e:
                print(f"Caught corrupted image error:")
                print(f"  Type: {type(e).__name__}")
                print(f"  Message: {e}")

        # Test 5: Invalid JSON schema in response_format
        # Skipped - Pydantic AI uses Pydantic models for structured output, not JSON schemas.
        # Schema validation errors would occur at the Pydantic model level, which is tested
        # in the structured output tests (20-22).

        print("\nError handling tests completed")


async def run_async_tests():
    """Run all asynchronous tests."""
    tests = [
        test_basic_completion,
        test_multi_turn,
        test_system_prompt,
        test_streaming,
        test_image_input,
        test_document_input,
        test_temperature_variations,
        test_stop_sequences,
        test_metadata,
        test_long_context,
        test_mixed_content,
        test_prefill,
        test_short_max_tokens,
        test_tool_use,
        test_tool_use_with_result,
        test_reasoning,
        test_structured_output,
        test_streaming_structured_output,
        test_structured_output_with_context,
        test_error_handling,
    ]

    for test in tests:
        try:
            await test()
            # Rate limiting
            await asyncio.sleep(1)
        except Exception as e:
            print(f"Test {test.__name__} failed: {e}")
            import traceback

            traceback.print_exc()


async def main():
    """Run all tests."""
    print("=" * 60)
    print("Pydantic AI Golden Tests with Braintrust")
    print("=" * 60)

    # Run all async tests
    print("\n### Running Pydantic AI Agent Tests ###")
    await run_async_tests()

    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
