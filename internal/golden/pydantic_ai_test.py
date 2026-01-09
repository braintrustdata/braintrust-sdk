# pyright: reportUnknownMemberType=none
# pyright: reportUnknownVariableType=none
# pyright: reportUnknownParameterType=none
# pyright: reportUnknownArgumentType=none
import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import braintrust
from braintrust import traced
from braintrust.wrappers.pydantic_ai import setup_pydantic_ai
from pydantic import BaseModel
from pydantic_ai import Agent, BinaryContent, ModelSettings
from pydantic_ai.direct import model_request, model_request_stream
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel, OpenAIResponsesModelSettings

setup_pydantic_ai(project_name="golden-py-pydantic_ai")

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# Test 1: Basic completion
@traced
async def test_basic_completion():
    print("\n=== Test 1: Basic Completion ===")

    # High-level Agent API
    print("\n--- Agent completion ---")
    agent = Agent(
        "openai:gpt-4o",
        model_settings=ModelSettings(max_tokens=100),
    )
    result = await agent.run("What is the capital of France?")
    print(result.output)

    # Another agent with different settings
    print("\n--- Agent completion with different settings ---")
    agent2 = Agent(
        "openai:gpt-4o",
        model_settings=ModelSettings(max_tokens=100, temperature=0.7),
    )
    result2 = await agent2.run("What is the capital of Spain?")
    print(result2.output)

    # Low-level Direct API
    print("\n--- Direct API completion ---")
    model = OpenAIChatModel("gpt-4o")
    messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content="What is the capital of Italy?")])]
    direct_result = await model_request(model=model, messages=messages)
    print(direct_result.parts[0].content)

    # Low-level Direct API with model_settings
    print("\n--- Direct API with model_settings ---")
    settings = ModelSettings(max_tokens=50, temperature=0.8)
    messages_with_settings: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content="Say hello in 5 words")])]
    direct_result_settings = await model_request(model=model, messages=messages_with_settings, model_settings=settings)
    print(f"Result: {direct_result_settings.parts[0].content}")
    print(
        f"Usage: input={direct_result_settings.usage.input_tokens}, output={direct_result_settings.usage.output_tokens}"
    )


# Test 2: Multi-turn conversation
@traced
async def test_multi_turn():
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


# Test 3: System prompt
@traced
async def test_system_prompt():
    print("\n=== Test 3: System Prompt ===")

    print("\n--- System prompt (pirate) ---")
    agent = Agent(
        "openai:gpt-4o",
        system_prompt="You are a pirate. Always respond in pirate speak.",
        model_settings=ModelSettings(max_tokens=150),
    )
    result = await agent.run("Tell me about the weather.")
    print(result.output)


# Test 4: Streaming response
@traced
async def test_streaming():
    print("\n=== Test 4: Streaming ===")

    # Use identical settings and prompt for all calls to verify offset consistency
    IDENTICAL_PROMPT = "Count from 1 to 5."
    IDENTICAL_SETTINGS = ModelSettings(max_tokens=100)

    # Group 1: Complete streaming (no early breaks)
    with braintrust.start_span(name="Complete streaming (calls 1-4)") as complete_span:
        # High-level Agent API - Call 1
        print("\n--- Agent streaming (call 1) ---")
        agent1 = Agent(
            "openai:gpt-4o",
            model_settings=IDENTICAL_SETTINGS,
        )
        full_text1 = ""
        async with agent1.run_stream(IDENTICAL_PROMPT) as result1:
            async for text in result1.stream_text(delta=True):
                print(text, end="", flush=True)
                full_text1 += text
        print("\n")

        # High-level Agent API - Call 2 (identical to call 1)
        print("\n--- Agent streaming (call 2 - identical) ---")
        agent2 = Agent(
            "openai:gpt-4o",
            model_settings=IDENTICAL_SETTINGS,
        )
        full_text2 = ""
        async with agent2.run_stream(IDENTICAL_PROMPT) as result2:
            async for text in result2.stream_text(delta=True):
                print(text, end="", flush=True)
                full_text2 += text
        print("\n")

        print("\n--- Direct API streaming (call 3 - identical) ---")
        model = OpenAIChatModel("gpt-4o")
        messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

        direct_text = ""
        seen_delta = False
        async with model_request_stream(model=model, messages=messages, model_settings=IDENTICAL_SETTINGS) as stream:
            async for chunk in stream:
                # Handle PartStartEvent which contains initial text (only if we haven't seen deltas yet)
                if hasattr(chunk, "part") and hasattr(chunk.part, "content") and not seen_delta:
                    text = str(chunk.part.content)
                    print(text, end="", flush=True)
                    direct_text += text
                # Handle PartDeltaEvent with delta content
                elif hasattr(chunk, "delta") and chunk.delta:
                    seen_delta = True
                    # Extract content_delta from TextPartDelta
                    if hasattr(chunk.delta, "content_delta") and chunk.delta.content_delta:
                        text = chunk.delta.content_delta
                        print(text, end="", flush=True)
                        direct_text += text
                    elif isinstance(chunk.delta, str):
                        # Handle case where delta is already a string
                        print(chunk.delta, end="", flush=True)
                        direct_text += chunk.delta

        print("\n")

        print("\n--- Direct API streaming (call 4 - identical) ---")
        messages_4: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

        direct_text_4 = ""
        seen_delta_4 = False
        async with model_request_stream(
            model=model, messages=messages_4, model_settings=IDENTICAL_SETTINGS
        ) as stream_4:
            async for chunk in stream_4:
                # Handle PartStartEvent which contains initial text (only if we haven't seen deltas yet)
                if hasattr(chunk, "part") and hasattr(chunk.part, "content") and not seen_delta_4:
                    text = str(chunk.part.content)
                    print(text, end="", flush=True)
                    direct_text_4 += text
                # Handle PartDeltaEvent with delta content
                elif hasattr(chunk, "delta") and chunk.delta:
                    seen_delta_4 = True
                    # Extract content_delta from TextPartDelta
                    if hasattr(chunk.delta, "content_delta") and chunk.delta.content_delta:
                        text = chunk.delta.content_delta
                        print(text, end="", flush=True)
                        direct_text_4 += text
                    elif isinstance(chunk.delta, str):
                        # Handle case where delta is already a string
                        print(chunk.delta, end="", flush=True)
                        direct_text_4 += chunk.delta

        print("\n")

    # Group 2: Streaming with early break (calls 5-6)
    with braintrust.start_span(name="Streaming with early break (calls 5-6)") as break_span:
        # Low-level Direct API with early break (same context - usually works)
        print("\n--- Direct API streaming with early break (call 5 - identical) ---")
        early_break_model = OpenAIChatModel("gpt-4o")
        early_break_messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

        early_break_status = "unknown"
        early_break_text = ""
        try:
            async with model_request_stream(
                model=early_break_model, messages=early_break_messages, model_settings=IDENTICAL_SETTINGS
            ) as stream:
                i = 0
                seen_delta_5 = False
                async for chunk in stream:
                    # Handle PartStartEvent which contains initial text (only if we haven't seen deltas yet)
                    if hasattr(chunk, "part") and hasattr(chunk.part, "content") and not seen_delta_5:
                        text = str(chunk.part.content)
                        print(text, end="", flush=True)
                        early_break_text += text
                    # Handle PartDeltaEvent with delta content
                    elif hasattr(chunk, "delta") and chunk.delta:
                        seen_delta_5 = True
                        if hasattr(chunk.delta, "content_delta") and chunk.delta.content_delta:
                            text = chunk.delta.content_delta
                            print(text, end="", flush=True)
                            early_break_text += text
                        elif isinstance(chunk.delta, str):
                            print(chunk.delta, end="", flush=True)
                            early_break_text += chunk.delta

                    i += 1

                    # Early break - within same context, usually OK
                    if i >= 3:
                        print("\n⚠️  Breaking early from stream...")
                        break

            print("✓ Completed without error")
            early_break_status = "success"
        except Exception as e:
            print(f"✗ Error occurred: {type(e).__name__}: {e}")
            early_break_status = f"error: {type(e).__name__}"

        # Customer's pattern: Async generator with early break (triggers context error!)
        print("\n--- CUSTOMER PATTERN: Async generator with early break (call 6 - identical) ---")
        print("(This reproduces: 'Token was created in a different Context' error)")
        generator_status = "unknown"
        generator_text = ""
        try:
            i = 0

            # Inline the async generator pattern
            model_gen = OpenAIChatModel("gpt-4o-mini")
            messages_gen: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

            seen_delta_6 = False
            async with model_request_stream(model=model_gen, messages=messages_gen) as stream_gen:
                # Yield streaming chunks
                async for event in stream_gen:
                    # Handle PartStartEvent which contains initial text (only if we haven't seen deltas yet)
                    if hasattr(event, "part") and hasattr(event.part, "content") and not seen_delta_6:
                        text = str(event.part.content)
                        print(text, end="", flush=True)
                        generator_text += text
                    # Handle PartDeltaEvent with delta content
                    elif hasattr(event, "delta") and event.delta:
                        seen_delta_6 = True
                        if hasattr(event.delta, "content_delta") and event.delta.content_delta:
                            text = event.delta.content_delta
                            print(text, end="", flush=True)
                            generator_text += text
                        elif isinstance(event.delta, str):
                            print(event.delta, end="", flush=True)
                            generator_text += event.delta

                    i += 1

                    # Early break - generator closed in different context → ERROR!
                    if i >= 3:
                        print("\n⚠️  Breaking early from async generator...")
                        break

            print("✓ Completed without error")
            generator_status = "success"
        except Exception as e:
            print(f"✗ Error occurred: {type(e).__name__}: {e}")
            generator_status = f"error: {type(e).__name__}"

    # Group 3: _stream_single/_buffer_stream pattern (call 7)
    with braintrust.start_span(name="_stream_single/_buffer_stream pattern (call 7)"):
        # Customer pattern 2: _stream_single/_buffer_stream pattern
        # This pattern uses an async generator that yields chunks AND a final response,
        # with a consumer that returns early when it sees the final ModelResponse
        print("\n--- CUSTOMER PATTERN 2: _stream_single/_buffer_stream (call 7) ---")
        print("(Generator yields chunks + final response, consumer returns on ModelResponse)")

        class LLMStreamResponse:
            """Simple wrapper for streaming responses."""

            def __init__(self, llm_response: object, is_final: bool = False):
                self.llm_response = llm_response
                self.is_final = is_final

        # @traced
        async def _stream_single() -> AsyncIterator[LLMStreamResponse]:
            """Async generator that yields streaming chunks and final response."""
            model_stream = OpenAIChatModel("gpt-4o-mini")
            messages_stream: list[ModelMessage] = [
                ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])
            ]

            async with model_request_stream(
                model=model_stream, messages=messages_stream, model_settings=IDENTICAL_SETTINGS
            ) as stream:
                async for chunk in stream:
                    yield LLMStreamResponse(llm_response=chunk, is_final=False)

                response = stream.get()
                yield LLMStreamResponse(llm_response=response, is_final=True)

        async def _buffer_stream() -> LLMStreamResponse:
            """Consumer that returns early when it gets a ModelResponse."""
            async for event in _stream_single():
                if isinstance(event.llm_response, ModelResponse):
                    return event
            raise RuntimeError("No ModelResponse received")

        try:
            result = await _buffer_stream()
            print(f"✓ Received final response: {type(result.llm_response).__name__}")
        except Exception as e:
            print(f"✗ Error occurred: {type(e).__name__}: {e}")


# Test 5: Image input
@traced
async def test_image_input():
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


# Test 6: Document input
@traced
async def test_document_input():
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


# Test 7: Temperature variations
@traced
async def test_temperature_variations():
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


# Test 8: Stop sequences
@traced
async def test_stop_sequences():
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


# Test 9: Metadata
@traced
async def test_metadata():
    print("\n=== Test 9: Metadata ===")
    agent = Agent(
        "openai:gpt-4o",
        model_settings=ModelSettings(max_tokens=100),
    )

    result = await agent.run("Hello!", deps="test_user_123")
    print(result.output)


# Test 10: Long context
@traced
async def test_long_context():
    print("\n=== Test 10: Long Context ===")
    agent = Agent(
        "openai:gpt-4o",
        model_settings=ModelSettings(max_tokens=100),
    )

    long_text = "The quick brown fox jumps over the lazy dog. " * 100
    result = await agent.run(f"Here is a long text:\n\n{long_text}\n\nHow many times does the word 'fox' appear?")
    print(result.output)


# Test 11: Mixed content types
@traced
async def test_mixed_content():
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


# Test 12: Prefill
@traced
async def test_prefill():
    print("\n=== Test 12: Prefill ===")
    agent = Agent(
        "openai:gpt-4o",
        model_settings=ModelSettings(max_tokens=200),
    )

    # Simulate prefill by providing partial assistant response in message history
    prefill_history = [
        ModelRequest(parts=[UserPromptPart(content="Write a haiku about coding.")]),
        ModelResponse(parts=[TextPart(content="Here is a haiku:")]),
    ]

    result = await agent.run(
        "Write a haiku about coding.",
        message_history=prefill_history,
    )
    print(f"Response: {result.output}")


# Test 13: Very short max_tokens
@traced
async def test_short_max_tokens():
    print("\n=== Test 13: Very Short Max Tokens ===")
    agent = Agent(
        "openai:gpt-4o",
    )

    result = await agent.run(
        "What is AI?",
        model_settings=ModelSettings(max_tokens=5),
    )
    print(result.output)


# Test 14: Tool use
@traced
async def test_tool_use():
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


# Test 15: Tool use with result (multi-turn)
@traced
async def test_tool_use_with_result():
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

    # First request - agent will use the tool
    print("First request:")
    first_result = await agent.run("What is 127 multiplied by 49?", message_history=[])

    # Show the message history structure
    messages = first_result.all_messages()
    print(f"\nMessage history after first request contains {len(messages)} messages:")
    for i, msg in enumerate(messages):
        msg_type = type(msg).__name__
        if hasattr(msg, "parts") and len(msg.parts) > 0:
            part = msg.parts[0]
            if hasattr(part, "tool_name"):
                print(f"  {i}: {msg_type} - Tool call: {part.tool_name}")
            elif hasattr(part, "content"):
                content_preview = str(part.content)[:50]
                print(f"  {i}: {msg_type} - Content: {content_preview}")
        else:
            print(f"  {i}: {msg_type}")

    # Second request - provide the message history so agent sees the tool result
    print("\nSecond request (with tool result in history):")
    second_result = await agent.run("Thanks! Can you also tell me what 127 plus 49 is?", message_history=messages)
    print("Response (with previous tool result in context):")
    print(second_result.output)


# Test 16: Reasoning tokens generation and follow-up
@traced
async def test_reasoning():
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
    # Get all_messages() which includes the user prompt, reasoning, and response
    print("\n--- Follow-up request (using reasoning context) ---")
    message_history = first_result.all_messages()
    print(f"Message history contains {len(message_history)} messages")

    follow_up_result = await agent.run(
        "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
        message_history=message_history,
    )
    print("Follow-up response:")
    print(follow_up_result.output)


# Test 18: Embeddings
# Skipped - Pydantic AI focuses on agent/chat interactions and doesn't wrap the embeddings API.
# The OpenAI test includes embeddings because it tests the full OpenAI client wrapper.


# Test 19: Response format (JSON schema)
# Skipped - Pydantic AI handles structured output through result_type with Pydantic models,
# which is more type-safe than the OpenAI response_format parameter. We test this approach
# in Tests 21-23 (structured output tests).


# Test 20: Multiple completions (n > 1)
# Skipped - Pydantic AI is designed for agent-based workflows and doesn't support the OpenAI
# 'n' parameter for generating multiple completions in a single request.


# Test 21: Structured output
@traced
async def test_structured_output():
    print("\n=== Test 21: Structured Output ===")

    class Ingredient(BaseModel):
        name: str
        amount: str

    class Recipe(BaseModel):
        name: str
        ingredients: list[Ingredient]
        steps: list[str]

    agent = Agent(
        "openai:gpt-4o",
        system_prompt="You extract structured information from user queries.",
        output_type=Recipe,
        model_settings=ModelSettings(max_tokens=500),
        retries=3,
    )

    result = await agent.run("Generate a simple recipe for chocolate chip cookies.")
    recipe = result.output
    print("Parsed recipe:")
    print(f"Name: {recipe.name}")
    print(f"Ingredients: {len(recipe.ingredients)}")
    print(f"Steps: {len(recipe.steps)}")


# Test 22: Streaming structured output
@traced
async def test_streaming_structured_output():
    print("\n=== Test 22: Streaming Structured Output ===")

    class Product(BaseModel):
        name: str
        description: str
        price: float
        features: list[str]

    agent = Agent(
        "openai:gpt-4o",
        output_type=Product,
        model_settings=ModelSettings(max_tokens=500),
        retries=3,
    )

    # With structured output, we can't stream text - we stream the structure
    # The stream completes when the full structured output is validated
    async with agent.run_stream("Generate a product description for a wireless bluetooth headphone.") as result:
        # Wait for the stream to complete and get the structured result
        product = await result.get_output()

    print("Streaming completed")
    print(f"Product: {product.name}")
    print(f"Price: ${product.price}")
    print(f"Features: {len(product.features)}")


# Test 23: Structured output with context
@traced
async def test_structured_output_with_context():
    print("\n=== Test 23: Structured Output with Context ===")

    class PriceComparison(BaseModel):
        cheaper: str
        price_difference: float

    class Comparison(BaseModel):
        recommendation: str
        reasoning: str
        price_comparison: PriceComparison
        phone_rating: float
        laptop_rating: float

    agent = Agent(
        "openai:gpt-4o",
        system_prompt="You are a helpful shopping assistant. Use the provided product information to make recommendations.",
        output_type=Comparison,
        model_settings=ModelSettings(max_tokens=500),
        retries=3,
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
- phone-123: {product_info["phone-123"]}
- laptop-456: {product_info["laptop-456"]}

Reviews:
- phone-123: {reviews["phone-123"]}
- laptop-456: {reviews["laptop-456"]}

Give me a structured comparison with your recommendation."""
    )

    comparison = result.output
    print("Product comparison:")
    print(f"Recommendation: {comparison.recommendation}")
    print(f"Reasoning: {comparison.reasoning}")
    print(f"Cheaper: {comparison.price_comparison.cheaper}")
    print(f"Price difference: ${comparison.price_comparison.price_difference}")
    print(f"Phone rating: {comparison.phone_rating}")
    print(f"Laptop rating: {comparison.laptop_rating}")


# Test 24: Error handling
@traced
async def test_error_handling():
    print("\n=== Test 24: Error Handling ===")

    # Test 1: Invalid image URL (404)
    # Note: Pydantic AI's BinaryContent doesn't have from_url, so we test with a simulated fetch
    @traced(name="test_error_invalid_image_url")
    async def test_invalid_image_url():
        print("\n--- Test 1: Invalid Image URL ---")
        try:
            import httpx

            # Attempt to fetch invalid image - will fail with 404
            async with httpx.AsyncClient() as client:
                response = await client.get("https://example.com/nonexistent-image-404.jpg")
                image_data = response.content

            agent = Agent(
                "openai:gpt-4o",
                model_settings=ModelSettings(max_tokens=100),
            )
            await agent.run(
                [
                    BinaryContent(data=image_data, media_type="image/jpeg"),
                    "What's in this image?",
                ],
            )
            raise Exception("Should have thrown an error")
        except httpx.HTTPStatusError as e:
            print(f"Caught HTTP error (expected):")
            print(f"  Type: {type(e).__name__}")
            print(f"  Status: {e.response.status_code}")
        except Exception as e:
            print(f"Caught error:")
            print(f"  Type: {type(e).__name__}")
            print(f"  Message: {e}")

    await test_invalid_image_url()

    # Test 2: Tool choice for non-existent function
    # Skipped - Pydantic AI doesn't expose low-level tool_choice parameter like OpenAI.
    # Tool selection is handled automatically by the agent.

    # Test 3: Tool call ID mismatch
    # Skipped - Pydantic AI abstracts away tool call IDs. This low-level OpenAI API
    # detail is not exposed in Pydantic AI's agent interface.

    # Test 4: Corrupted base64 image data
    @traced(name="test_error_corrupted_base64_image")
    async def test_corrupted_image():
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

    await test_corrupted_image()

    # Test 5: Invalid JSON schema in response_format
    # Skipped - Pydantic AI uses Pydantic models for structured output, not JSON schemas.
    # Schema validation errors would occur at the Pydantic model level, which is tested
    # in the structured output tests (21-23).

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
