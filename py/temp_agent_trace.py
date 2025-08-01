"""
Temporary script to test OpenAI agents with Braintrust tracing (Python version)

Run with: python temp_agent_trace.py

Requirements:
- OPENAI_API_KEY environment variable
- BRAINTRUST_API_KEY environment variable (optional, can login via browser)
- pip install openai-agents pydantic
"""

import asyncio
import os
from typing import Any


def main():
    try:
        # Import required modules
        import braintrust
        from braintrust.wrappers.openai import BraintrustTracingProcessor
        from agents import Agent, tracing, Runner
        from agents.tool import function_tool

        print("Setting up Braintrust logger...")

        # Initialize Braintrust logging
        logger = braintrust.init_logger(
            project_id="37a8a4f4-4a34-4cdc-9b87-91ec0ebe9a97"  # Replace with your actual project ID
        )

        # Enhanced processor that logs raw data AND sends to Braintrust
        class EnhancedTracingProcessor(BraintrustTracingProcessor):
            def on_trace_start(self, trace: tracing.Trace) -> None:
                # print('\n=== RAW TRACE START ===')
                # print(f"Trace: {trace.model_dump()}")
                return super().on_trace_start(trace)

            def on_trace_end(self, trace: tracing.Trace) -> None:
                # print('\n=== RAW TRACE END ===')
                # print(f"Trace: {trace.model_dump()}")
                return super().on_trace_end(trace)

            def on_span_start(self, span: tracing.Span[Any]) -> None:
                # print('\n=== RAW SPAN START ===')
                # print(f"Span: {span.model_dump()}")
                return super().on_span_start(span)

            def on_span_end(self, span: tracing.Span[Any]) -> None:
                # print('\n=== RAW SPAN END ===')
                # print(f"Span: {span.model_dump()}")
                return super().on_span_end(span)

        # Set up enhanced tracing (logs raw data + sends to Braintrust)
        processor = EnhancedTracingProcessor(logger)
        tracing.set_tracing_disabled(False)
        tracing.add_trace_processor(processor)

        print("Creating tools...")

        # Create a weather tool
        @function_tool
        def get_weather(city: str) -> str:
            """Get the current weather for a city"""
            print(f"🌤️  Getting weather for {city}...")
            return f"The weather in {city} is sunny with temperature 72°F and light winds."

        # Create a calculator tool for more complex interactions
        @function_tool
        def calculator(operation: str) -> str:
            """Perform basic math calculations. Operation should be like '2 + 2' or '10 * 5'"""
            print(f"🧮 Calculating: {operation}")
            try:
                # Simple eval for basic math (don't do this in production!)
                import re

                # Only allow basic math operations
                if re.match(r"^[\d+\-*/().\s]+$", operation):
                    result = eval(operation)
                    return f"The result of {operation} is {result}"
                else:
                    return "Sorry, I can only do basic math operations like +, -, *, /"
            except Exception as error:
                return f"Sorry, I couldn't calculate that. Please use basic math operations like +, -, *, /. Error: {error}"

        print("Creating agent with tools...")

        # Create agent with tools
        agent = Agent(
            name="weather-calc-agent",
            model="gpt-4o-mini",
            instructions="""You are a helpful assistant that can get weather information and do calculations. 
            Use the get_weather tool when asked about weather in any city.
            Use the calculator tool when asked to do math.
            Be friendly and helpful!""",
            tools=[get_weather, calculator],
        )

        print("Running agent with tool calls...")

        # Run the agent with a prompt that will trigger tool usage
        result = Runner.run_sync(agent, "What's the weather in San Francisco? Also, what's 15 * 24?")
        print(result.final_output_as(str))

        # Clean up
        processor.shutdown()
        logger.flush()

    except ImportError as e:
        if "agents" in str(e):
            print("❌ Error: Missing agents dependency")
            print("\n💡 Install agents first:")
            print("   pip install 'braintrust[openai-agents]'")
        else:
            print(f"❌ Import Error: {e}")
    except Exception as error:
        print(f"❌ Error: {error}")

        if "OPENAI_API_KEY" in str(error):
            print("\n💡 Set your OpenAI API key:")
            print("   export OPENAI_API_KEY=your_key_here")

        raise


if __name__ == "__main__":
    main()
