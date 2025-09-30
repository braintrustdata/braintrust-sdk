# pyright: reportUnknownMemberType=none
# pyright: reportUnknownVariableType=none
import asyncio
from typing import Literal

from braintrust.logger import start_span
from braintrust.wrappers.genai import setup_genai
from google.genai import Client
from google.genai.types import FunctionDeclaration, GenerateContentConfig, Tool

setup_genai(project_name="example-genai-py")


def calculator(operator: Literal["add", "subtract"], a: float, b: float) -> float:
    """Simple calculator that can add or subtract two numbers."""
    return a + b if operator == "add" else a - b


calculator_tool = Tool(
    function_declarations=[
        FunctionDeclaration(
            name="calculator",
            description="A simple calculator that can add or subtract two numbers",
            parameters_json_schema={
                "type": "object",
                "properties": {
                    "operator": {"type": "string", "enum": ["add", "subtract"]},
                    "a": {"type": "number"},
                    "b": {"type": "number"},
                },
                "required": ["operator", "a", "b"],
            },
        )
    ]
)


def demo_sync():
    client = Client()

    with start_span(name="sync span"):
        print(
            client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents="Explain how AI works in a few words",
            )
        )

    with start_span(name="sync tool usage"):
        print(
            client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents="What is 42 + 17?",
                config=GenerateContentConfig(
                    tools=[calculator_tool],
                ),
            )
        )


async def demo_async():
    async_client = Client().aio

    with start_span(name="async span"):
        print(
            await async_client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents="Explain how AI works in a few words",
            )
        )

    with start_span(name="async tool usage"):
        print(
            await async_client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents="Calculate 100 - 25",
                config=GenerateContentConfig(
                    tools=[calculator_tool],
                ),
            )
        )

    with start_span(name="async stream span"):
        async for chunk in await async_client.models.generate_content_stream(
            model="gemini-2.0-flash-exp",
            contents="Explain how AI works in a few words",
        ):
            print(chunk)

    with start_span(name="async tool usage"):
        print(
            await async_client.models.generate_content_stream(
                model="gemini-2.0-flash-exp",
                contents="Calculate 100 - 25",
                config=GenerateContentConfig(
                    tools=[calculator_tool],
                ),
            )
        )


async def main():
    demo_sync()
    await demo_async()


if __name__ == "__main__":
    asyncio.run(main())
