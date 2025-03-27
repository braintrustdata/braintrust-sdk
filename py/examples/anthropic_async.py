#!/usr/bin/env python

import asyncio
import time

import braintrust
from anthropic import AsyncAnthropic

# Initialize Anthropic client (needs ANTHROPIC_API_KEY)
client = braintrust.wrap_anthropic(AsyncAnthropic())

braintrust.init_logger(project="example-anthropic-app")


print(braintrust.__file__)


async def main() -> None:

    while True:
        async with client.messages.stream(
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": "How many states are there?",
                }
            ],
            model="claude-3-5-sonnet-latest",
        ) as stream:
            async for event in stream:
                pass
        msg = await stream.get_final_message()
        print(msg.to_json())
        time.sleep(3)


asyncio.run(main())
