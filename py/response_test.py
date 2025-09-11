#!/usr/bin/env python3

import asyncio
import base64
from pathlib import Path

from braintrust import init_logger
from braintrust.oai import wrap_openai
from openai import AsyncOpenAI, OpenAI

# Initialize Braintrust logger
init_logger(project="Alex-Test-Project")

# Create wrapped OpenAI clients
client = wrap_openai(OpenAI())
async_client = wrap_openai(AsyncOpenAI())

def test_image_generation():
    print("\n🎨 Testing Image Generation...")

    try:
        response = client.responses.create(
            model="gpt-4o",
            input="Generate an image of a serene mountain landscape at sunset. Use the image generation tool to create this image.",
            tools=[
                {
                    "type": "image_generation"
                }
            ],
        )

        output_length = len(response.output) if isinstance(response.output, (str, list)) else "unknown"
        if isinstance(response.output, list):
            output_length = len(response.output)

        print("✅ Image generation response:", {
            "hasOutput": bool(response.output),
            "outputLength": output_length,
            "responseId": response.id,
            "outputType": type(response.output).__name__,
        })
        return response
    except Exception as error:
        print(f"❌ Image generation failed: {error}")
        return None

def test_image_analysis():
    print("\n🔍 Testing Image Analysis...")

    try:
        # Read the test image
        image_path = Path("/Users/alex/Desktop/test-image.png")
        with open(image_path, "rb") as f:
            image_data = f.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')

        response = client.responses.create(
            model="gpt-4o",
            input=[
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Please analyze this image and describe what you see in detail."
                        },
                        {
                            "type": "input_image",
                            "image_url": f"data:image/png;base64,{base64_image}"
                        }
                    ]
                }
            ],
        )

        print("✅ Image analysis response:")
        print("Response ID:", response.id)
        output_text = str(response.output)
        print("Output length:", len(output_text) if output_text else 0)
        print("First 200 chars:", (output_text[:200] + "...") if output_text and len(output_text) > 200 else output_text)
        return response
    except Exception as error:
        print(f"❌ Image analysis failed: {error}")
        return None

def test_reasoning_output():
    print("\n🧠 Testing Reasoning Output...")

    try:
        response = client.responses.create(
            model="o4-mini",
            reasoning={"effort": "high", "summary": "auto"},
            input=[
                {
                    "role": "user",
                    "content": (
                        """I want you to solve this in five steps:
                            1. List all countries in South America.
                            2. Filter the list to only those that border the Pacific Ocean.
                            3. For each, find the capital city.
                            4. Estimate the population of each capital.
                            5. Rank the countries from largest to smallest capital population."""
                    ),
                }
            ],
            text={"format": {"type": "text"}, "verbosity": "medium"},
            stream=False,
        )

        print("✅ Reasoning output response:")
        print("Response ID:", response.id)
        reasoning_output_text = str(response.output)
        print("Output length:", len(reasoning_output_text) if reasoning_output_text else 0)

        # Check for reasoning tokens in usage
        reasoning_tokens = 0
        if hasattr(response, 'usage') and response.usage:
            if hasattr(response.usage, 'output_tokens_details') and response.usage.output_tokens_details:
                reasoning_tokens = getattr(response.usage.output_tokens_details, 'reasoning_tokens', 0)

        print("Has reasoning tokens:", reasoning_tokens > 0)
        print("Reasoning tokens:", reasoning_tokens)
        print("First 300 chars:", (reasoning_output_text[:300] + "...") if reasoning_output_text and len(reasoning_output_text) > 300 else reasoning_output_text)
        return response
    except Exception as error:
        print(f"❌ Reasoning output failed: {error}")
        return None

async def test_reasoning_output_async():
    print("\n🧠 Testing Reasoning Output (Async)...")

    try:
        response = await async_client.responses.create(
            model="o4-mini",
            reasoning={"effort": "high", "summary": "auto"},
            input=[
                {
                    "role": "user",
                    "content": (
                        """I want you to solve this in five steps:
                            1. List all countries in South America.
                            2. Filter the list to only those that border the Pacific Ocean.
                            3. For each, find the capital city.
                            4. Estimate the population of each capital.
                            5. Rank the countries from largest to smallest capital population."""
                    ),
                }
            ],
            text={"format": {"type": "text"}, "verbosity": "medium"},
            stream=False,
        )

        print("✅ Reasoning output response (async):")
        print("Response ID:", response.id)
        reasoning_output_text = str(response.output)
        print("Output length:", len(reasoning_output_text) if reasoning_output_text else 0)

        # Check for reasoning tokens in usage
        reasoning_tokens = 0
        if hasattr(response, 'usage') and response.usage:
            if hasattr(response.usage, 'output_tokens_details') and response.usage.output_tokens_details:
                reasoning_tokens = getattr(response.usage.output_tokens_details, 'reasoning_tokens', 0)

        print("Has reasoning tokens:", reasoning_tokens > 0)
        print("Reasoning tokens:", reasoning_tokens)
        print("First 300 chars:", (reasoning_output_text[:300] + "...") if reasoning_output_text and len(reasoning_output_text) > 300 else reasoning_output_text)
        return response
    except Exception as error:
        print(f"❌ Reasoning output (async) failed: {error}")
        return None

def test_web_search_tool():
    print("\n🌐 Testing Web Search Tool...")

    try:
        response = client.responses.create(
            model="gpt-4o",
            input="What are the latest developments in artificial intelligence from this week? Please search the web for current AI news.",
            tools=[
                {
                    "type": "web_search"
                }
            ],
        )

        print("✅ Web search tool response:")
        print("Response ID:", response.id)
        web_search_output_text = str(response.output)
        print("Output length:", len(web_search_output_text) if web_search_output_text else 0)
        has_tool_calls = "web_search" in web_search_output_text.lower() or "search" in web_search_output_text.lower()
        print("Has tool calls:", has_tool_calls)
        print("First 400 chars:", (web_search_output_text[:400] + "...") if web_search_output_text and len(web_search_output_text) > 400 else web_search_output_text)
        return response
    except Exception as error:
        print(f"❌ Web search tool failed: {error}")
        return None

def test_streaming_response():
    print("\n🌊 Testing Streaming Response...")

    try:
        stream = client.responses.create(
            model="gpt-4o-mini",
            input="Tell me an interesting fact about space exploration",
            stream=True,
        )

        event_count = 0
        final_output = ""

        for event in stream:
            event_count += 1
            if hasattr(event, 'type') and event.type == "response.completed":
                final_output = event.response.output
            elif hasattr(event, 'output'):
                final_output = event.output

        print("✅ Streaming response completed:")
        print("Total events:", event_count)
        print("Final output length:", len(final_output))
        print("Final output:", final_output)
        return {"eventCount": event_count, "finalOutput": final_output}
    except Exception as error:
        print(f"❌ Streaming response failed: {error}")
        return None


async def main():
    print("🚀 Starting Comprehensive OpenAI Responses Test")
    print("This will test various response types with Braintrust tracing")

    results = {}

    # Test all different response types (mix of sync and async)
    results["imageGeneration"] = test_image_generation()
    results["imageAnalysis"] = test_image_analysis()
    results["reasoningOutput"] = test_reasoning_output()
    results["reasoningOutputAsync"] = await test_reasoning_output_async()  # Async version
    results["webSearchTool"] = test_web_search_tool()
    results["streamingResponse"] = test_streaming_response()


    # Summary
    print("\n📊 Test Summary:")
    success_count = sum(1 for r in results.values() if r is not None)
    total_tests = len(results)
    print(f"✅ {success_count}/{total_tests} tests completed successfully")

    if success_count < total_tests:
        print("❌ Some tests failed - check the error messages above")

    print("\n🎯 Check your Braintrust UI to see the traces for these responses!")
    print("Project: Alex-Test-Project")

if __name__ == "__main__":
    asyncio.run(main())
