# pyright: reportUnknownMemberType=none
# pyright: reportUnknownVariableType=none
# pyright: reportUnknownParameterType=none
# pyright: reportUnknownArgumentType=none
import asyncio
import base64
import json
import time
from enum import Enum
from pathlib import Path
from typing import Optional

from braintrust.wrappers.genai import setup_genai
from google import genai
from google.genai import types
from pydantic import BaseModel

setup_genai(project_name="golden-py-genai")

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures"

client = genai.Client()


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
    chat = client.chats.create(model="gemini-2.0-flash-001")

    response1 = chat.send_message("Hi, my name is Alice.")
    print(f"Assistant: {response1.text}")

    response2 = chat.send_message("What did I just tell you my name was?")
    print(f"Assistant: {response2.text}")

    return response2


# Test 3: System instructions
def test_system_instructions():
    print("\n=== Test 3: System Instructions ===")
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
    # Create a simple test image if it doesn't exist
    image_path = FIXTURES_DIR / "test-image.png"
    if not image_path.exists():
        print(f"Warning: {image_path} does not exist. Skipping image test.")
        return None

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents=[
            "What color is this image?",
            types.Part.from_bytes(
                data=base64.b64decode(image_data),
                mime_type="image/png",
            ),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=150,
        ),
    )
    print(response.text)
    return response


# Test 6: Temperature and top_p variations
def test_temperature_variations():
    print("\n=== Test 6: Temperature Variations ===")
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


# Test 7: Stop sequences
def test_stop_sequences():
    print("\n=== Test 7: Stop Sequences ===")
    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="Write a short story about a robot. END the story when done.",
        config=types.GenerateContentConfig(
            max_output_tokens=500,
            stop_sequences=["END", "\n\n"],
        ),
    )
    print(response.text)
    print(f"Stop reason: {response.candidates[0].finish_reason if response.candidates else 'unknown'}")
    return response


# Test 8: Long context
def test_long_context():
    print("\n=== Test 8: Long Context ===")
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


# Test 9: Mixed content types
def test_mixed_content():
    print("\n=== Test 9: Mixed Content Types ===")
    # Skip if image doesn't exist
    image_path = FIXTURES_DIR / "test-image.png"
    if not image_path.exists():
        print(f"Warning: {image_path} does not exist. Skipping mixed content test.")
        return None

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


# Test 10: Very short max_tokens
def test_short_max_tokens():
    print("\n=== Test 10: Very Short Max Tokens ===")
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


# Test 11: Function calling
def test_function_calling():
    print("\n=== Test 11: Function Calling ===")

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

    print("Response:")
    print(response.text)

    # Check if there were any function calls
    if hasattr(response, "function_calls") and response.function_calls:
        print("\nFunction calls made:")
        for call in response.function_calls:
            print(f"  Function: {call.name}")
            print(f"  Args: {call.args}")

    return response


# Test 12: Manual function calling with tool declaration
def test_manual_function_calling():
    print("\n=== Test 12: Manual Function Calling ===")
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
    response1 = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="What is 127 multiplied by 49?",
        config=types.GenerateContentConfig(
            tools=[tool],
            max_output_tokens=500,
        ),
    )

    print("First response:")
    if hasattr(response1, "function_calls") and response1.function_calls:
        for call in response1.function_calls:
            print(f"Tool called: {call.name}")
            print(f"Args: {call.args}")

            # Simulate tool execution
            if call.name == "calculate" and call.args and call.args.get("operation") == "multiply":
                result = call.args["a"] * call.args["b"]
                print(f"Result: {result}")
    else:
        print(response1.text)

    return response1


# Test 13: JSON response schema with Pydantic
def test_json_response_schema():
    print("\n=== Test 13: JSON Response Schema ===")

    class UserProfile(BaseModel):
        username: str
        age: Optional[int]
        email: Optional[str]
        interests: list[str]

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="Give me a random user profile with username, age, email, and interests.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=UserProfile,
            max_output_tokens=200,
        ),
    )

    print("JSON Response:")
    print(response.text)

    # Try to parse the response
    try:
        user_data = json.loads(response.text or "")
        print("\nParsed data:")
        print(f"  Username: {user_data.get('username')}")
        print(f"  Age: {user_data.get('age')}")
        print(f"  Email: {user_data.get('email')}")
        print(f"  Interests: {user_data.get('interests')}")
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON: {e}")

    return response


# Test 14: Enum response schema
def test_enum_response():
    print("\n=== Test 14: Enum Response ===")

    class InstrumentEnum(str, Enum):
        PERCUSSION = "Percussion"
        STRING = "String"
        WOODWIND = "Woodwind"
        BRASS = "Brass"
        KEYBOARD = "Keyboard"

    response = client.models.generate_content(
        model="gemini-2.0-flash-001",
        contents="What type of instrument is a piano?",
        config=types.GenerateContentConfig(
            response_mime_type="text/x.enum",
            response_schema=InstrumentEnum,
            max_output_tokens=50,
        ),
    )

    print(f"Response: {response.text}")
    return response


# Test 15: Token counting
def test_token_counting():
    print("\n=== Test 15: Token Counting ===")
    content = "Why is the sky blue? Explain in simple terms."

    # Count tokens
    count_response = client.models.count_tokens(
        model="gemini-2.0-flash-001",
        contents=content,
    )

    print(f"Input text: {content}")
    print(f"Token count: {count_response}")

    return count_response


# Test 16: Embeddings
def test_embeddings():
    print("\n=== Test 16: Embeddings ===")
    texts = [
        "The quick brown fox jumps over the lazy dog.",
        "Machine learning is a subset of artificial intelligence.",
        "Python is a popular programming language.",
    ]

    # Generate embeddings
    response = client.models.embed_content(
        model="text-embedding-004",
        contents=texts,
        config=types.EmbedContentConfig(
            output_dimensionality=256,  # Reduce dimensionality for display
        ),
    )

    print(f"Generated embeddings for {len(texts)} texts")
    if hasattr(response, "embeddings"):
        for i, embedding in enumerate(response.embeddings or []):
            if hasattr(embedding, "values"):
                print(f"  Text {i + 1}: embedding dimension = {len(embedding.values or [])}")

    return response


# Async test example
async def test_async_generation():
    print("\n=== Test 17: Async Generation ===")
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
    print("\n=== Test 18: Async Streaming ===")
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
        test_system_instructions,
        test_streaming,
        test_image_input,
        test_temperature_variations,
        test_stop_sequences,
        test_long_context,
        test_mixed_content,
        test_short_max_tokens,
        test_function_calling,
        test_manual_function_calling,
        test_json_response_schema,
        test_enum_response,
        test_token_counting,
        test_embeddings,
    ]

    for test in tests:
        try:
            test()
            # Rate limiting
            time.sleep(1)
        except Exception as e:
            breakpoint()
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
            breakpoint()
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
