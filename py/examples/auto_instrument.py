"""
Example: Auto-instrumentation with Braintrust

This example demonstrates one-line auto-instrumentation for multiple AI libraries.
Run with: python examples/auto_instrument.py

Supported integrations:
- OpenAI
- Anthropic
- LiteLLM
- Pydantic AI
- Google GenAI
- Agno
- Claude Agent SDK
- DSPy
"""

import braintrust

# One-line instrumentation - call this BEFORE importing AI libraries
# This patches all supported libraries automatically
results = braintrust.auto_instrument()

# Show what was instrumented
print("Instrumentation results:")
for lib, success in results.items():
    status = "yes" if success else "no (not installed)"
    print(f"  {lib}: {status}")
print()

# Initialize Braintrust logging
logger = braintrust.init_logger(project="auto-instrument-demo")

# Now import and use AI libraries normally - all calls are traced!
# IMPORTANT: Import AI libraries AFTER calling auto_instrument()
import anthropic
import openai

# Create clients - they're automatically wrapped
openai_client = openai.OpenAI()
anthropic_client = anthropic.Anthropic()

# Wrap in a manual span to get a link
with braintrust.start_span(name="auto_instrument_example") as span:
    # OpenAI call - automatically traced as child span
    print("Calling OpenAI...")
    openai_response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say hello in 3 words"}],
    )
    print(f"  OpenAI: {openai_response.choices[0].message.content}")

    # Anthropic call - automatically traced as child span
    print("Calling Anthropic...")
    anthropic_response = anthropic_client.messages.create(
        model="claude-3-5-haiku-latest",
        max_tokens=100,
        messages=[{"role": "user", "content": "Say goodbye in 3 words"}],
    )
    print(f"  Anthropic: {anthropic_response.content[0].text}")

    span.log(
        output={
            "openai": openai_response.choices[0].message.content,
            "anthropic": anthropic_response.content[0].text,
        }
    )

print(f"\nView trace: {span.link()}")
