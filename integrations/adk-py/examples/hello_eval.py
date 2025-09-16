import asyncio
from typing import Any

from braintrust.framework import EvalAsync
from braintrust_adk import setup_braintrust
from hello import main as hello


async def main():
    async def task(input: Any):
        setup_braintrust()
        return await hello(input)

    await EvalAsync(
        name="hello",
        data=[{"input": "Hello, World!"}],
        task=task,
        scores=[],
    )


asyncio.run(main())
