#!/usr/bin/env python

import asyncio
import time

import braintrust
from anthropic import AsyncAnthropic

# Initialize Anthropic client (needs ANTHROPIC_API_KEY)
client = braintrust.wrap_anthropic(AsyncAnthropic())

braintrust.init_logger(project="example-anthropic-app")


async def stream():
    async with client.messages.stream(
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": "Write me a haiku about a stream.",
            }
        ],
        model="claude-3-5-sonnet-latest",
    ) as stream:
        # Process the stream
        async for event in stream:
            # You can process events here if needed
            # For example: print(event) or handle specific event types
            pass

        # Get the final message within the context manager
        msg = await stream.get_final_message()
        print(msg.to_json())


async def create():
    msg = await client.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=1024,
        messages=[
            {"role": "user", "content": "Write me a haiku about creation."},
        ],
    )
    print(msg.to_json())


async def create_with_stream():
    stream = await client.messages.create(
        model="claude-3-5-sonnet-latest",
        max_tokens=1024,
        messages=[
            {"role": "user", "content": "Write me a haiku about creation."},
        ],
        stream=True,
    )

    async for event in stream:
        print(event.to_json())


async def main() -> None:
    promises = []
    for target in [stream, create, create_with_stream]:
        print(f"Running {target.__name__}")
        promises.append(target())

    for promise in promises:
        msg = await promise


if __name__ == "__main__":
    asyncio.run(main())
