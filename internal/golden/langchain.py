import asyncio
import base64
from pathlib import Path

import braintrust
from braintrust import flush, init_logger, start_span
from braintrust_langchain import BraintrustCallbackHandler, set_global_handler
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

init_logger(project="golden-py-langchain")

handler = BraintrustCallbackHandler()
set_global_handler(handler)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_basic_completion():
    print("\n=== Test 1: Basic Completion ===")
    with start_span(name="test_basic_completion"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=100)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=100)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                prompt = ChatPromptTemplate.from_template("What is the capital of {country}?")
                chain = prompt | model
                result = chain.invoke({"country": "France"})
                print(result.content)
                print()


def test_multi_turn():
    print("\n=== Test 2: Multi-turn Conversation ===")
    with start_span(name="test_multi_turn"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=200)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=200)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                messages = [
                    HumanMessage(content="Hi, my name is Alice."),
                    SystemMessage(content="Hello Alice! Nice to meet you."),
                    HumanMessage(content="What did I just tell you my name was?"),
                ]
                result = model.invoke(messages)
                print(result.content)
                print()


def test_system_prompt():
    print("\n=== Test 3: System Prompt ===")
    with start_span(name="test_system_prompt"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=150)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=150)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                system_msg = "You are a pirate. Always respond in pirate speak."
                prompt = ChatPromptTemplate.from_messages([("system", system_msg), ("human", "{input}")])
                chain = prompt | model
                result = chain.invoke({"input": "Tell me about the weather."})
                print(result.content)
                print()


def test_streaming():
    print("\n=== Test 4: Streaming ===")
    with start_span(name="test_streaming"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=200, streaming=True)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=200, streaming=True)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                prompt_text = "Count from 1 to 10 slowly."
                prompt = ChatPromptTemplate.from_template(prompt_text)
                chain = prompt | model

                for chunk in chain.stream({}):
                    if chunk.content:
                        print(chunk.content, end="", flush=True)
                print("\n")


def test_image_input():
    print("\n=== Test 5: Image Input ===")
    with start_span(name="test_image_input"):
        image_path = FIXTURES_DIR / "test-image.png"
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=150)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=150)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")

                if provider == "openai":
                    messages = [
                        HumanMessage(
                            content=[
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}},
                                {"type": "text", "text": "What color is this image?"},
                            ]
                        )
                    ]
                else:
                    messages = [
                        HumanMessage(
                            content=[
                                {
                                    "type": "image",
                                    "source": {"type": "base64", "media_type": "image/png", "data": image_data},
                                },
                                {"type": "text", "text": "What color is this image?"},
                            ]
                        )
                    ]

                result = model.invoke(messages)
                print(result.content)
                print()


def test_document_input():
    print("\n=== Test 6: Document Input ===")
    with start_span(name="test_document_input"):
        pdf_path = FIXTURES_DIR / "test-document.pdf"
        with open(pdf_path, "rb") as f:
            pdf_data = base64.b64encode(f.read()).decode("utf-8")

        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=150)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=150)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")

                if provider == "openai":
                    messages = [
                        HumanMessage(
                            content=[
                                {
                                    "type": "file",
                                    "file": {
                                        "file_data": f"data:application/pdf;base64,{pdf_data}",
                                        "filename": "test-document.pdf",
                                    },
                                },
                                {"type": "text", "text": "What is in this document?"},
                            ]
                        )
                    ]
                else:
                    messages = [
                        HumanMessage(
                            content=[
                                {
                                    "type": "document",
                                    "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_data},
                                },
                                {"type": "text", "text": "What is in this document?"},
                            ]
                        )
                    ]

                result = model.invoke(messages)
                print(result.content)
                print()


def test_temperature_variations():
    print("\n=== Test 7: Temperature Variations ===")
    with start_span(name="test_temperature_variations"):
        configs = [(0.0, 1.0), (1.0, 0.9), (0.7, 0.95)]

        for provider, models in (
            (
                "openai",
                [
                    ChatOpenAI(model="gpt-4o", max_completion_tokens=50, temperature=temp, top_p=top_p)
                    for temp, top_p in configs
                ],
            ),
            (
                "anthropic",
                [
                    ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=50, temperature=temp, top_p=top_p)
                    for temp, top_p in configs
                ],
            ),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                for (temp, top_p), model in zip(configs, models):
                    print(f"Config: temp={temp}, top_p={top_p}")
                    prompt = ChatPromptTemplate.from_template("Say something {topic}.")
                    chain = prompt | model
                    result = chain.invoke({"topic": "creative"})
                    print(result.content)
                    print()


def test_stop_sequences():
    print("\n=== Test 8: Stop Sequences ===")
    with start_span(name="test_stop_sequences"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=500, stop_sequences=["END", "\n\n"])),
            (
                "anthropic",
                ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=500, stop_sequences=["END"]),
            ),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                topic = "robot"
                prompt = ChatPromptTemplate.from_template(f"Write a short story about a {topic}.")
                chain = prompt | model
                result = chain.invoke({})
                print(result.content)
                print(f"Response metadata: {result.response_metadata}")
                print()


def test_metadata():
    print("\n=== Test 9: Metadata ===")
    with start_span(name="test_metadata"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=100, model_kwargs={"user": "test_user_123"})),
            (
                "anthropic",
                ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=100),
            ),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                messages = [HumanMessage(content="Hello!")]
                result = model.invoke(messages)
                print(result.content)
                print()


def test_long_context():
    print("\n=== Test 10: Long Context ===")
    with start_span(name="test_long_context"):
        long_text = "The quick brown fox jumps over the lazy dog. " * 100

        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=100)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=100)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                prompt = ChatPromptTemplate.from_template(
                    "Here is a long text:\n\n{text}\n\nHow many times does the word 'fox' appear?"
                )
                chain = prompt | model
                result = chain.invoke({"text": long_text})
                print(result.content)
                print()


def test_mixed_content():
    print("\n=== Test 11: Mixed Content Types ===")
    with start_span(name="test_mixed_content"):
        image_path = FIXTURES_DIR / "test-image.png"
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=200)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=200)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")

                if provider == "openai":
                    messages = [
                        HumanMessage(
                            content=[
                                {"type": "text", "text": "First, look at this image:"},
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}},
                                {"type": "text", "text": "Now describe what you see and explain why it matters."},
                            ]
                        )
                    ]
                else:
                    messages = [
                        HumanMessage(
                            content=[
                                {"type": "text", "text": "First, look at this image:"},
                                {
                                    "type": "image",
                                    "source": {"type": "base64", "media_type": "image/png", "data": image_data},
                                },
                                {"type": "text", "text": "Now describe what you see and explain why it matters."},
                            ]
                        )
                    ]

                result = model.invoke(messages)
                print(result.content)
                print()


def test_prefill():
    print("\n=== Test 12: Prefill ===")
    with start_span(name="test_prefill"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=200)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=200)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                topic = "coding"
                messages = [
                    HumanMessage(content=f"Write a haiku about {topic}."),
                    SystemMessage(content="Here is a haiku:"),
                ]
                result = model.invoke(messages)
                print(result.content)
                print()


def test_short_max_tokens():
    print("\n=== Test 13: Very Short Max Tokens ===")
    with start_span(name="test_short_max_tokens"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=5)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=5)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                prompt = ChatPromptTemplate.from_template("What is AI?")
                chain = prompt | model
                result = chain.invoke({})
                print(result.content)
                print(f"Response metadata: {result.response_metadata}")
                print()


def test_tool_use():
    print("\n=== Test 14: Tool Use ===")
    with start_span(name="test_tool_use"):

        @tool
        def get_weather(location: str, unit: str = "celsius") -> str:
            """Get the current weather for a location.

            Args:
                location: The city and state, e.g. San Francisco, CA
                unit: The unit of temperature (celsius or fahrenheit)
            """
            return f"22 degrees {unit} and sunny in {location}"

        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=500)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=500)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")

                model_with_tools = model.bind_tools([get_weather])
                query = "What is the weather like in Paris, France?"
                result = model_with_tools.invoke(query)

                print("Response content:")
                if result.content:
                    print(f"Text: {result.content}")

                if hasattr(result, "tool_calls") and result.tool_calls:
                    for i, call in enumerate(result.tool_calls):
                        print(f"Tool use block {i}:")
                        print(f"  Tool: {call['name']}")
                        print(f"  Input: {call['args']}")
                print()


def test_tool_use_with_result():
    print("\n=== Test 15: Tool Use With Result ===")
    with start_span(name="test_tool_use_with_result"):

        @tool
        def calculate(operation: str, a: float, b: float) -> float:
            """Perform a mathematical calculation.

            Args:
                operation: The mathematical operation (add, subtract, multiply, divide)
                a: First number
                b: Second number
            """
            if operation == "add":
                return a + b
            elif operation == "subtract":
                return a - b
            elif operation == "multiply":
                return a * b
            elif operation == "divide":
                return a / b if b != 0 else 0
            return 0

        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=500)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=500)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")

                model_with_tools = model.bind_tools([calculate])
                query = "What is 127 multiplied by 49?"

                # First request - model will use the tool
                first_result = model_with_tools.invoke(query)

                print("First response:")
                if hasattr(first_result, "tool_calls") and first_result.tool_calls:
                    tool_call = first_result.tool_calls[0]
                    print(f"Tool called: {tool_call['name']}")
                    print(f"Input: {tool_call['args']}")

                    # Simulate tool execution
                    result = 127 * 49

                    # Second request - provide tool result
                    messages = [
                        HumanMessage(content=query),
                        AIMessage(content="", tool_calls=[tool_call]),
                        ToolMessage(content=str(result), tool_call_id=tool_call["id"]),
                    ]

                    second_result = model_with_tools.invoke(messages)
                    print("\nSecond response (with tool result):")
                    print(second_result.content)
                print()


# Test 18: Reasoning with o1 model
def test_reasoning():
    with start_span(name="test_reasoning"):
        braintrust.log(output="Responses API not supported and chat completions do not include (reasoning) summaries")


async def test_async_generation():
    print("\n=== Test 17: Async Generation ===")
    with start_span(name="test_async_generation"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=100)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=100)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                topic = "programming"
                prompt = ChatPromptTemplate.from_template("Tell me a joke about {topic}.")
                chain = prompt | model
                result = await chain.ainvoke({"topic": topic})
                print(result.content)
                print()


async def test_async_streaming():
    print("\n=== Test 18: Async Streaming ===")
    with start_span(name="test_async_streaming"):
        for provider, model in (
            ("openai", ChatOpenAI(model="gpt-4o", max_completion_tokens=200, streaming=True)),
            ("anthropic", ChatAnthropic(model="claude-sonnet-4-20250514", max_tokens=200, streaming=True)),
        ):
            with start_span(name=provider):
                print(f"{provider.capitalize()}:")
                category = "programming languages"
                prompt = ChatPromptTemplate.from_template("List 3 {category}.")
                chain = prompt | model

                full_content = ""
                async for chunk in chain.astream({"category": category}):
                    if chunk.content:
                        print(chunk.content, end="", flush=True)
                        full_content += chunk.content
                print("\n")


def run_sync_tests():
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
            test()
            flush()
        except Exception as e:
            print(f"Test {test.__name__} failed: {e}")
            import traceback

            traceback.print_exc()


async def run_async_tests():
    tests = [
        test_async_generation,
        test_async_streaming,
    ]

    for test in tests:
        try:
            await test()
            flush()
        except Exception as e:
            print(f"Test {test.__name__} failed: {e}")
            import traceback

            traceback.print_exc()


async def main():
    print("=" * 60)
    print("LangChain Golden Tests with Braintrust")
    print("=" * 60)

    print("\n### Running Synchronous Tests ###")
    run_sync_tests()

    print("\n### Running Asynchronous Tests ###")
    await run_async_tests()

    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
