"""
An example showing how Braintrust eval experiment traces will continue to work with adk traces.
"""

import asyncio
from typing import Any

from braintrust.framework import EvalAsync
from braintrust_adk import setup_braintrust
from manual import main as manual


async def main():
    async def task(input: Any):
        setup_braintrust()
        return await manual(input)

    await EvalAsync(
        name="hello",
        data=[{"input": "Hello, World!"}],
        task=task,
        scores=[],
    )


asyncio.run(main())
