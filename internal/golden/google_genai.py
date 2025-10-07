# pyright: reportUnknownMemberType=none
# pyright: reportUnknownVariableType=none
# pyright: reportUnknownParameterType=none
# pyright: reportUnknownArgumentType=none
import asyncio
import time
from pathlib import Path

from braintrust.wrappers.google_genai import setup_genai
from google.genai import types
from google.genai.client import Client

setup_genai(project_name="golden-py-genai")

FIXTURES_DIR = Path(__file__) / "fixtures"

client = Client()


# Test 1: Basic text completion
def test_basic_completion():
    print("\n=== Test 1: Basic Completion ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="What is the capital of France?",
        config=types.GenerateContentConfig(
            max_output_tokens=100,
        ),
    )
    print(response.text)
    return response


# Test 2: Multi-turn conversation
def test_multi_turn():
    print("\n=== Test 2: Multi-turn Conversation ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            types.Content(role="user", parts=[types.Part.from_text(text="Hi, my name is Alice.")]),
            types.Content(role="model", parts=[types.Part.from_text(text="Hello Alice! Nice to meet you.")]),
            types.Content(role="user", parts=[types.Part.from_text(text="What did I just tell you my name was?")]),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=200,
        ),
    )
    print(response.text)
    return response


# Test 3: System prompt
def test_system_prompt():
    print("\n=== Test 3: System Prompt ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="Tell me about the weather.",
        config=types.GenerateContentConfig(
            system_instruction="You are a pirate. Always respond in pirate speak.",
            max_output_tokens=150,
        ),
    )
    print(response.text)
    return response


# Test 4: Streaming response
def test_streaming():
    print("\n=== Test 4: Streaming ===")
    stream = client.models.generate_content_stream(
        model="gemini-2.0-flash-001",
        contents="Count from 1 to 10 slowly.",
        config=types.GenerateContentConfig(
            max_output_tokens=200,
        ),
    )

    full_text = ""
    for chunk in stream:
        if chunk.text:
            print(chunk.text, end="")
            full_text += chunk.text

    print("\n")
    return full_text


# Test 5: Image input (base64)
def test_image_input():
    print("\n=== Test 5: Image Input ===")
    image_path = FIXTURES_DIR / "test-image.png"

    with open(image_path, "rb") as f:
        image_data = f.read()

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            types.Part.from_bytes(data=image_data, mime_type="image/png"),
            types.Part.from_text(text="What color is this image?"),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=150,
        ),
    )
    print(response.text)
    return response


# Test 6: Document input (PDF)
def test_document_input():
    print("\n=== Test 6: Document Input ===")
    pdf_path = FIXTURES_DIR / "test-document.pdf"

    with open(pdf_path, "rb") as f:
        pdf_data = f.read()

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            types.Part.from_bytes(data=pdf_data, mime_type="application/pdf"),
            types.Part.from_text(text="What is in this document?"),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=150,
        ),
    )
    print(response.text)
    return response


# Test 7: Temperature and top_p variations
def test_temperature_variations():
    print("\n=== Test 7: Temperature Variations ===")
    configs = [
        {"temperature": 0.0, "top_p": 1.0},
        {"temperature": 1.0, "top_p": 0.9},
        {"temperature": 0.7, "top_p": 0.95},
    ]

    responses = []
    for config in configs:
        print(f"\nConfig: temp={config['temperature']}, top_p={config['top_p']}")
        response = client.models.generate_content(
            model="gemini-2.0-flash-001",
            contents="Say something creative.",
            config=types.GenerateContentConfig(
                temperature=config["temperature"],
                top_p=config["top_p"],
                max_output_tokens=50,
            ),
        )
        print(response.text)
        responses.append(response)

    return responses


# Test 8: Stop sequences
def test_stop_sequences():
    print("\n=== Test 8: Stop Sequences ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="Write a short story about a robot.",
        config=types.GenerateContentConfig(
            max_output_tokens=500,
            stop_sequences=["END", "\n\n"],
        ),
    )
    print(response.text)
    print(f"Stop reason: {response.candidates[0].finish_reason if response.candidates else 'unknown'}")
    return response


# Test 9: Metadata
# not supported by genai


# Test 10: Long context
def test_long_context():
    print("\n=== Test 10: Long Context ===")
    long_text = "The quick brown fox jumps over the lazy dog. " * 100
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=f"Here is a long text:\n\n{long_text}\n\nHow many times does the word 'fox' appear?",
        config=types.GenerateContentConfig(
            max_output_tokens=100,
        ),
    )
    print(response.text)
    return response


# Test 13: Mixed content types
def test_mixed_content():
    print("\n=== Test 13: Mixed Content Types ===")
    # Skip if image doesn't exist
    image_path = FIXTURES_DIR / "test-image.png"

    with open(image_path, "rb") as f:
        image_data = f.read()

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            types.Part.from_text(text="First, look at this image:"),
            types.Part.from_bytes(data=image_data, mime_type="image/png"),
            types.Part.from_text(text="Now describe what you see and explain why it matters."),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=200,
        ),
    )
    print(response.text)
    return response


# Test 14: Empty assistant message (prefill)
def test_prefill():
    print("\n=== Test 14: Prefill ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            types.Content(role="user", parts=[types.Part.from_text(text="Write a haiku about coding.")]),
            types.Content(role="model", parts=[types.Part.from_text(text="Here is a haiku:")]),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=200,
        ),
    )
    print(response.text)
    return response


# Test 15: Very short max_tokens
def test_short_max_tokens():
    print("\n=== Test 15: Very Short Max Tokens ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="What is AI?",
        config=types.GenerateContentConfig(
            max_output_tokens=5,
        ),
    )
    print(response.text)
    print(f"Stop reason: {response.candidates[0].finish_reason if response.candidates else 'unknown'}")
    return response


# Test 16: Tool use
def test_tool_use():
    print("\n=== Test 16: Tool Use ===")

    # Define a function for getting weather
    def get_weather(location: str, unit: str = "celsius") -> str:
        """Get the current weather for a location.

        Args:
            location: The city and state, e.g. San Francisco, CA
            unit: The unit of temperature (celsius or fahrenheit)
        """
        # Simulate weather API response
        return f"22 degrees {unit} and sunny in {location}"

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="What is the weather like in Paris, France?",
        config=types.GenerateContentConfig(
            tools=[get_weather],
            max_output_tokens=500,
        ),
    )

    print("Response content:")
    if response.text:
        print(f"Text: {response.text}")

    if hasattr(response, "function_calls") and response.function_calls:
        for i, call in enumerate(response.function_calls):
            print(f"Tool use block {i}:")
            print(f"  Tool: {call.name}")
            print(f"  Input: {call.args}")

    return response


# Test 17: Tool use with result (multi-turn)
def test_tool_use_with_result():
    print("\n=== Test 17: Tool Use With Result ===")
    # Manually declare function
    function = types.FunctionDeclaration(
        name="calculate",
        description="Perform a mathematical calculation",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["add", "subtract", "multiply", "divide"],
                    "description": "The mathematical operation",
                },
                "a": {
                    "type": "number",
                    "description": "First number",
                },
                "b": {
                    "type": "number",
                    "description": "Second number",
                },
            },
            "required": ["operation", "a", "b"],
        },
    )

    tool = types.Tool(function_declarations=[function])

    # First request - model will use the tool
    first_response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="What is 127 multiplied by 49?",
        config=types.GenerateContentConfig(
            tools=[tool],
            max_output_tokens=500,
        ),
    )

    print("First response:")
    tool_call = None
    if hasattr(first_response, "function_calls") and first_response.function_calls:
        tool_call = first_response.function_calls[0]
        print(f"Tool called: {tool_call.name}")
        print(f"Input: {tool_call.args}")

    # Simulate tool execution
    result = 127 * 49

    assert first_response.candidates
    assert tool_call and tool_call.name

    # Second request - provide tool result
    second_response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            types.Content(role="user", parts=[types.Part.from_text(text="What is 127 multiplied by 49?")]),
            first_response.candidates[0].content,
            types.Content(
                role="user",
                parts=[
                    types.Part.from_function_response(
                        name=tool_call.name,
                        response={"result": result},
                    )
                ],
            ),
        ],
        config=types.GenerateContentConfig(
            tools=[tool],
            max_output_tokens=500,
        ),
    )

    print("\nSecond response (with tool result):")
    print(second_response.text)
    return second_response


# Async test example
async def test_async_generation():
    print("\n=== Test 18: Async Generation ===")
    response = await client.aio.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="Tell me a joke about programming.",
        config=types.GenerateContentConfig(
            max_output_tokens=100,
        ),
    )
    print(response.text)
    return response


# Async streaming test
async def test_async_streaming():
    print("\n=== Test 19: Async Streaming ===")
    stream = await client.aio.models.generate_content_stream(
        model="gemini-2.0-flash-001",
        contents="List 5 programming languages and their main uses.",
        config=types.GenerateContentConfig(
            max_output_tokens=200,
        ),
    )

    full_text = ""
    async for chunk in stream:
        if chunk.text:
            print(chunk.text, end="")
            full_text += chunk.text

    print("\n")
    return full_text


def run_sync_tests():
    """Run all synchronous tests."""
    tests = [
        test_basic_completion,
        test_multi_turn,
        test_system_prompt,
        test_streaming,
        test_image_input,
        test_document_input,
        test_temperature_variations,
        test_stop_sequences,
        test_long_context,
        test_mixed_content,
        test_prefill,
        test_short_max_tokens,
        test_tool_use,
        test_tool_use_with_result,
    ]

    for test in tests:
        try:
            test()
            # Rate limiting
            time.sleep(1)
        except Exception as e:
            print(f"Test {test.__name__} failed: {e}")


async def run_async_tests():
    """Run all asynchronous tests."""
    tests = [
        test_async_generation,
        test_async_streaming,
    ]

    for test in tests:
        try:
            await test()
            # Rate limiting
            await asyncio.sleep(1)
        except Exception as e:
            print(f"Test {test.__name__} failed: {e}")


async def main():
    """Run all tests."""
    print("=" * 60)
    print("Google GenAI Golden Tests with Braintrust")
    print("=" * 60)

    # Run synchronous tests
    print("\n### Running Synchronous Tests ###")
    run_sync_tests()

    # Run asynchronous tests
    print("\n### Running Asynchronous Tests ###")
    await run_async_tests()

    # Clean up aiohttp session to prevent resource leak warnings
    # This is a workaround for https://github.com/googleapis/python-genai/issues/1388
    if hasattr(client, "_api_client") and hasattr(client._api_client, "_aiohttp_session"):
        if client._api_client._aiohttp_session:
            await client._api_client._aiohttp_session.close()

    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
