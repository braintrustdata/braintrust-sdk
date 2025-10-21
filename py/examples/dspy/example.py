#!/usr/bin/env python
"""
DSPy example with Braintrust observability - demonstrates all key features in one trace:
- Custom module with multi-step reasoning (ChainOfThought)
- Tool usage (ReAct agent with calculator)
- Rich span hierarchy and metrics

Run with: OPENAI_API_KEY=<your-key> BRAINTRUST_API_KEY=<your-key> python examples/dspy/example.py
"""

# IMPORTANT: Patch LiteLLM BEFORE importing DSPy to get detailed token metrics
from braintrust.wrappers.litellm import patch_litellm

patch_litellm()

# Now import DSPy
import dspy
from braintrust import init_logger
from braintrust.wrappers.dspy import BraintrustDSpyCallback


def main():
    # Initialize Braintrust logging
    logger = init_logger(project="dspy-example")
    print("🔍 Braintrust logging enabled - view traces at https://braintrust.dev")

    # Disable DSPy's disk cache (keep memory cache for performance)
    dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=True)

    # Configure DSPy with Braintrust callback
    lm = dspy.LM("openai/gpt-4o-mini")
    dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])

    print("\n" + "=" * 60)
    print("DSPy + Braintrust Example")
    print("=" * 60)

    # ReAct agent with tools demonstrates:
    # - Multi-step reasoning
    # - Tool calling (calculator, get_current_year)
    # - Rich nested span hierarchy
    print("\nReAct Agent with Tools")
    print("-" * 60)

    def calculator(expression: str) -> float:
        """Evaluate a mathematical expression."""
        return eval(expression, {"__builtins__": {}}, {})

    def get_current_year() -> int:
        """Get the current year."""
        return 2025

    react = dspy.ReAct("question -> answer", tools=[calculator, get_current_year])

    # This single question creates a rich trace with:
    # - Module span (ReAct)
    # - Multiple LM spans (reasoning steps)
    # - Tool spans (calculator, get_current_year, finish)
    # - Complete token metrics from LiteLLM
    question = "If I was born in 1990, how old will I be in the current year?"
    result = react(question=question)

    print(f"Q: {question}")
    print(f"A: {result.answer}")

    print("\n" + "=" * 60)
    print("✓ Trace logged to Braintrust with full observability:")
    print("  - Module execution (ReAct)")
    print("  - LLM calls with token metrics")
    print("  - Tool invocations (calculator, get_current_year)")
    print("  - Complete span hierarchy")
    print("=" * 60)


if __name__ == "__main__":
    main()
