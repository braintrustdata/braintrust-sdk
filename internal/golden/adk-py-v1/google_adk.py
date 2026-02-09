# pyright: reportUnknownMemberType=none
# pyright: reportUnknownVariableType=none
# pyright: reportUnknownParameterType=none
# pyright: reportUnknownArgumentType=none
import asyncio
from pathlib import Path

import braintrust
from braintrust_adk import setup_adk
from google.adk import Agent
from google.adk.planners import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

setup_adk(project_name="golden-py-adk")

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"

# Session configuration
APP_NAME = "golden_test_app"
USER_ID = "test-user"


async def get_session_runner(agent: Agent, session_id: str) -> Runner:
    """Helper to create a runner with session setup."""
    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=session_id)
    return Runner(agent=agent, app_name=APP_NAME, session_service=session_service)


# Test 1: Basic completion
async def test_basic_completion():
    with braintrust.start_span(name="test_basic_completion"):
        print("\n=== Test 1: Basic Completion ===")
        agent = Agent(
            name="basic_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )

        runner = await get_session_runner(agent, "session-basic")

        user_msg = types.Content(role="user", parts=[types.Part(text="What is the capital of France?")])

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-basic", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses:
            print(responses[0].content.parts[0].text)
        return responses


# Test 2: Multi-turn conversation
async def test_multi_turn():
    with braintrust.start_span(name="test_multi_turn"):
        print("\n=== Test 2: Multi-turn Conversation ===")
        agent = Agent(
            name="conversation_agent",
            model="gemini-2.5-flash",
            instruction="You are a helpful assistant with good memory.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )

        runner = await get_session_runner(agent, "session-multi-turn")

        # First message
        msg1 = types.Content(role="user", parts=[types.Part(text="Hi, my name is Alice.")])
        async for event in runner.run_async(user_id=USER_ID, session_id="session-multi-turn", new_message=msg1):
            if event.is_final_response():
                print(f"Response 1: {event.content.parts[0].text}")

        # Second message
        msg2 = types.Content(role="user", parts=[types.Part(text="What did I just tell you my name was?")])
        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-multi-turn", new_message=msg2):
            if event.is_final_response():
                responses.append(event)
                print(f"Response 2: {event.content.parts[0].text}")

        return responses


# Test 3: System prompt
async def test_system_prompt():
    with braintrust.start_span(name="test_system_prompt"):
        print("\n=== Test 3: System Prompt ===")
        agent = Agent(
            name="pirate_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a pirate. Always respond in pirate speak.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=150,
            ),
        )

        runner = await get_session_runner(agent, "session-pirate")

        user_msg = types.Content(role="user", parts=[types.Part(text="Tell me about the weather.")])

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-pirate", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 4: Streaming response
async def test_streaming():
    with braintrust.start_span(name="test_streaming"):
        print("\n=== Test 4: Streaming ===")
        agent = Agent(
            name="counting_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )

        runner = await get_session_runner(agent, "session-streaming")

        user_msg = types.Content(role="user", parts=[types.Part(text="Count from 1 to 10 slowly.")])

        full_text = ""
        async for event in runner.run_async(user_id=USER_ID, session_id="session-streaming", new_message=user_msg):
            if event.content and event.content.parts:
                text = event.content.parts[0].text
                if text:
                    print(text, end="")
                    full_text += text

        print("\n")
        return full_text


# Test 5: Image input
async def test_image_input():
    with braintrust.start_span(name="test_image_input"):
        print("\n=== Test 5: Image Input ===")
        image_path = FIXTURES_DIR / "test-image.png"

        if not image_path.exists():
            print("Skipping: Image file not found")
            return None

        agent = Agent(
            name="vision_agent",
            model="gemini-2.5-flash",
            instruction="You are a helpful vision assistant that can analyze images.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=150,
            ),
        )

        runner = await get_session_runner(agent, "session-vision")

        with open(image_path, "rb") as f:
            image_data = f.read()

        user_msg = types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=image_data, mime_type="image/png"),
                types.Part(text="What color is this image?"),
            ],
        )

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-vision", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 6: Document input
async def test_document_input():
    with braintrust.start_span(name="test_document_input"):
        print("\n=== Test 6: Document Input ===")
        pdf_path = FIXTURES_DIR / "test-document.pdf"

        if not pdf_path.exists():
            print("Skipping: PDF file not found")
            return None

        agent = Agent(
            name="doc_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a document analysis assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=150,
            ),
        )

        runner = await get_session_runner(agent, "session-document")

        with open(pdf_path, "rb") as f:
            pdf_data = f.read()

        user_msg = types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=pdf_data, mime_type="application/pdf"),
                types.Part(text="What is in this document?"),
            ],
        )

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-document", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 7: Temperature variations
async def test_temperature_variations():
    with braintrust.start_span(name="test_temperature_variations"):
        print("\n=== Test 7: Temperature Variations ===")

        configs = [
            {"temperature": 0.0, "top_p": 1.0},
            {"temperature": 1.0, "top_p": 0.9},
            {"temperature": 0.7, "top_p": 0.95},
        ]

        responses = []
        for i, config in enumerate(configs):
            print(f"\nConfig: temp={config['temperature']}, top_p={config['top_p']}")

            # Create a unique agent and session for each iteration to avoid state leakage
            agent = Agent(
                name=f"agent_temp_{str(config['temperature']).replace('.', '_')}",
                model="gemini-2.0-flash-exp",
                instruction="You are a creative storyteller.",
                generate_content_config=types.GenerateContentConfig(
                    temperature=config["temperature"],
                    top_p=config["top_p"],
                    max_output_tokens=50,
                ),
            )

            # Use unique session ID with iteration counter to ensure complete isolation
            session_id = f"session-temp-{config['temperature']}-{i}"
            runner = await get_session_runner(agent, session_id)

            user_msg = types.Content(role="user", parts=[types.Part(text="Say something creative.")])

            accumulated_text = ""
            async for event in runner.run_async(user_id=USER_ID, session_id=session_id, new_message=user_msg):
                # Collect content from any event that has it
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if hasattr(part, "text") and part.text:
                            accumulated_text += part.text

                if event.is_final_response():
                    responses.append(event)

            # Print accumulated text if available
            if accumulated_text:
                print(accumulated_text)

        return responses


# Test 8: Stop sequences
async def test_stop_sequences():
    with braintrust.start_span(name="test_stop_sequences"):
        print("\n=== Test 8: Stop Sequences ===")
        agent = Agent(
            name="story_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a creative writer.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=500,
                stop_sequences=["END", "\n\n"],
            ),
        )

        runner = await get_session_runner(agent, "session-stop")

        user_msg = types.Content(role="user", parts=[types.Part(text="Write a short story about a robot.")])

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-stop", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 9: Metadata
async def test_metadata():
    with braintrust.start_span(name="test_metadata"):
        print("\n=== Test 9: Metadata ===")
        agent = Agent(
            name="basic_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=100,
                labels={
                    "user_id": "test_user_123",
                    "environment": "testing",
                    "feature": "metadata_test",
                },
            ),
        )

        runner = await get_session_runner(agent, "session-metadata")

        user_msg = types.Content(role="user", parts=[types.Part(text="Hello!")])

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-metadata", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 10: Long context
async def test_long_context():
    with braintrust.start_span(name="test_long_context"):
        print("\n=== Test 10: Long Context ===")
        agent = Agent(
            name="analysis_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a text analysis assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )

        runner = await get_session_runner(agent, "session-long")

        long_text = "The quick brown fox jumps over the lazy dog. " * 100
        user_msg = types.Content(
            role="user",
            parts=[
                types.Part(text=f"Here is a long text:\n\n{long_text}\n\nHow many times does the word 'fox' appear?")
            ],
        )

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-long", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 11: Mixed content types
async def test_mixed_content():
    with braintrust.start_span(name="test_mixed_content"):
        print("\n=== Test 11: Mixed Content Types ===")
        image_path = FIXTURES_DIR / "test-image.png"

        if not image_path.exists():
            print("Skipping: Image file not found")
            return None

        agent = Agent(
            name="vision_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful vision assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )

        runner = await get_session_runner(agent, "session-mixed")

        with open(image_path, "rb") as f:
            image_data = f.read()

        user_msg = types.Content(
            role="user",
            parts=[
                types.Part(text="First, look at this image:"),
                types.Part.from_bytes(data=image_data, mime_type="image/png"),
                types.Part(text="Now describe what you see and explain why it matters."),
            ],
        )

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-mixed", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 12: Empty assistant message (prefill)
async def test_prefill():
    with braintrust.start_span(name="test_prefill"):
        print("\n=== Test 12: Prefill ===")
        agent = Agent(
            name="haiku_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )

        runner = await get_session_runner(agent, "session-prefill")

        # First send the user message
        msg1 = types.Content(role="user", parts=[types.Part(text="Write a haiku about coding.")])
        async for event in runner.run_async(user_id=USER_ID, session_id="session-prefill", new_message=msg1):
            if event.is_final_response():
                print(f"Response 1: {event.content.parts[0].text}")

        # Then send a prefill message
        msg2 = types.Content(role="user", parts=[types.Part(text="Here is a haiku:")])
        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-prefill", new_message=msg2):
            if event.is_final_response():
                responses.append(event)
                print(f"Response 2: {event.content.parts[0].text}")

        return responses


# Test 13: Very short max_tokens
async def test_short_max_tokens():
    with braintrust.start_span(name="test_short_max_tokens"):
        print("\n=== Test 13: Very Short Max Tokens ===")
        agent = Agent(
            name="brief_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=5,
            ),
        )

        runner = await get_session_runner(agent, "session-brief")

        user_msg = types.Content(role="user", parts=[types.Part(text="What is AI?")])

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-brief", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        if responses and responses[0].content and responses[0].content.parts:
            print(responses[0].content.parts[0].text)
        return responses


# Test 14: Tool use
async def test_tool_use():
    with braintrust.start_span(name="test_tool_use"):
        print("\n=== Test 14: Tool Use ===")

        def get_weather(city_and_state: str, unit: str = "celsius"):
            """Get the current weather for a location.

            Args:
                city_and_state: The city and state, e.g. San Francisco, CA
                unit: The unit of temperature (celsius or fahrenheit). Default to fahrenheit.
            """
            return f"22 degrees {unit} and sunny in {city_and_state}"

        agent = Agent(
            name="weather_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful weather assistant. Use the get_weather tool to answer questions.",
            tools=[get_weather],
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=500,
            ),
        )

        runner = await get_session_runner(agent, "session-weather")

        user_msg = types.Content(role="user", parts=[types.Part(text="What is the weather like in Paris, France?")])

        responses = []
        async for event in runner.run_async(user_id=USER_ID, session_id="session-weather", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)
                print("Response content:")
                if event.content and event.content.parts:
                    for i, part in enumerate(event.content.parts):
                        if hasattr(part, "function_call") and part.function_call:
                            print(f"Tool use block {i}:")
                            print(f"  Tool: {part.function_call.name}")
                            print(f"  Input: {part.function_call.args}")
                        elif hasattr(part, "text") and part.text:
                            print(f"Text: {part.text}")

        return responses


# Test 15: Tool use with result (multi-turn)
async def test_tool_use_with_result():
    with braintrust.start_span(name="test_tool_use_with_result"):
        print("\n=== Test 15: Tool Use With Result ===")

        def calculate(operation: str, a: float, b: float):
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
            return ops.get(operation, "Invalid operation")

        agent = Agent(
            name="math_agent",
            model="gemini-2.0-flash-exp",
            instruction="You are a helpful math assistant. Use the calculate tool to perform calculations.",
            tools=[calculate],
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=500,
            ),
        )

        runner = await get_session_runner(agent, "session-calculator")

        user_msg = types.Content(role="user", parts=[types.Part(text="What is 127 multiplied by 49?")])

        print("First response:")
        async for event in runner.run_async(user_id=USER_ID, session_id="session-calculator", new_message=user_msg):
            if event.is_final_response():
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if hasattr(part, "function_call") and part.function_call:
                            print(f"Tool called: {part.function_call.name}")
                            print(f"Input: {part.function_call.args}")

        # Note: In a real scenario, the agent would automatically execute the tool and continue
        # For this test, we're just demonstrating the tool call initiation
        responses = []
        return responses


# Test 16: Reasoning tokens generation and follow-up
async def test_reasoning():
    with braintrust.start_span(name="test_reasoning"):
        print("\n=== Test 16: Reasoning Tokens & Follow-up ===")

        # First request: Analyze pattern and derive formula
        print("\n--- First request (generate reasoning) ---")
        agent = Agent(
            name="reasoning_agent",
            model="gemini-2.5-flash",
            instruction="You are a mathematical reasoning assistant.",
            generate_content_config=types.GenerateContentConfig(
                max_output_tokens=2048,
            ),
            planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(include_thoughts=True, thinking_budget=1024)),
        )

        runner = await get_session_runner(agent, "session-reasoning")

        user_msg = types.Content(
            role="user",
            parts=[
                types.Part(
                    text="Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?"
                )
            ],
        )

        print("First response:")
        async for event in runner.run_async(user_id=USER_ID, session_id="session-reasoning", new_message=user_msg):
            if event.is_final_response():
                if event.content and event.content.parts:
                    print(event.content.parts[0].text)

        # Second request: Apply the discovered pattern to solve a new problem
        print("\n--- Follow-up request (using reasoning context) ---")
        follow_up_msg = types.Content(
            role="user",
            parts=[
                types.Part(
                    text="Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?"
                )
            ],
        )

        responses = []
        print("Follow-up response:")
        async for event in runner.run_async(
            user_id=USER_ID, session_id="session-reasoning", new_message=follow_up_msg
        ):
            if event.is_final_response():
                responses.append(event)
                if event.content and event.content.parts:
                    print(event.content.parts[0].text)

        return responses


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
    ]

    for test in tests:
        try:
            await test()
            # Rate limiting
            await asyncio.sleep(3)
        except Exception as e:
            print(f"Test {test.__name__} failed: {e}")
            import traceback

            traceback.print_exc()


async def main():
    """Run all tests."""
    print("=" * 60)
    print("Google ADK Golden Tests with Braintrust")
    print("=" * 60)

    # Run all async tests
    print("\n### Running ADK Agent Tests ###")
    await run_async_tests()

    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
