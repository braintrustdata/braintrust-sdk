#!/usr/bin/env python

import asyncio

import braintrust

braintrust.auto_instrument()
logger = braintrust.init_logger(project="example-pydantic-ai-project")

from pydantic_ai import Agent

agent = Agent("openai:gpt-4o", system_prompt="You are a helpful assistant.")


async def main():
    with braintrust.start_span(name="pydantic_ai_example") as span:
        result = await agent.run("What's the capital of Australia?")
        print(result.output)

    print(f"\nView trace: {span.link()}")


if __name__ == "__main__":
    asyncio.run(main())
