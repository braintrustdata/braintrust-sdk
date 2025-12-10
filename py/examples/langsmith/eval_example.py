#!/usr/bin/env python3
"""
Example showing how to migrate LangSmith evaluate() to Braintrust.

This example demonstrates:
1. Setting up the LangSmith wrapper
2. Using client.evaluate() (redirects to Braintrust's Eval)
3. LangSmith-style evaluators working with Braintrust
"""

import os

# Enable LangSmith tracing (required for traces to be sent to LangSmith)
os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
os.environ.setdefault("LANGCHAIN_PROJECT", "examples-wrappers-langsmith-eval")

# IMPORTANT: Call setup_langsmith BEFORE importing from langsmith
from braintrust.wrappers.langsmith_wrapper import setup_langsmith

# Set BRAINTRUST_STANDALONE=1 to completely replace LangSmith with Braintrust
standalone = os.environ.get("BRAINTRUST_STANDALONE", "").lower() in ("1", "true", "yes")

# project_name is automatically read from LANGCHAIN_PROJECT env var
setup_langsmith(
    api_key=os.environ.get("BRAINTRUST_API_KEY"),
    standalone=standalone,
)

# Now import from langsmith - these are patched to use Braintrust
from langsmith import Client, traceable


# Define a target function (the function being evaluated)
# LangSmith requires the parameter to be named 'inputs' (or 'attachments'/'metadata')
@traceable(name="multiply")
def multiply(inputs: dict) -> int:
    """Multiply two numbers."""
    return inputs["x"] * inputs["y"]


# Define LangSmith-style evaluators
def _unwrap_output(value):
    """Unwrap output from dict format if needed (LangSmith requires dict outputs)."""
    if isinstance(value, dict) and "output" in value:
        return value["output"]
    return value


def exact_match_evaluator(run, example):
    """
    LangSmith-style evaluator that checks for exact match.

    Args:
        run: Has .outputs attribute with the function's return value
        example: Has .inputs and .outputs attributes from the dataset
    """
    expected = _unwrap_output(example.outputs)
    actual = _unwrap_output(run.outputs)
    return {
        "key": "exact_match",
        "score": 1.0 if actual == expected else 0.0,
    }


def range_evaluator(run, example):
    """
    LangSmith-style evaluator that checks if result is in expected range.
    """
    actual = _unwrap_output(run.outputs)
    expected = _unwrap_output(example.outputs)
    # Check if within 10% of expected
    if expected == 0:
        score = 1.0 if actual == 0 else 0.0
    else:
        diff = abs(actual - expected) / abs(expected)
        score = 1.0 if diff <= 0.1 else 0.0
    return {
        "key": "within_range",
        "score": score,
        "metadata": {"actual": actual, "expected": expected},
    }


def main():
    print("LangSmith to Braintrust Evaluation Example")
    print("=" * 50)
    print()

    # Create a LangSmith client (patched to use Braintrust)
    client = Client()

    # Define test data in LangSmith format
    test_data = [
        {"inputs": {"x": 2, "y": 3}, "outputs": 6},
        {"inputs": {"x": 5, "y": 5}, "outputs": 25},
        {"inputs": {"x": 10, "y": 0}, "outputs": 0},
        {"inputs": {"x": 7, "y": 8}, "outputs": 56},
    ]

    print("Running evaluation...")
    print(f"Test cases: {len(test_data)}")
    print()

    # Run evaluation using LangSmith's API (redirects to Braintrust)
    client.evaluate(
        multiply,  # Target function
        data=test_data,  # Test dataset
        evaluators=[exact_match_evaluator, range_evaluator],
        experiment_prefix="multiply-test",
        description="Testing multiplication function",
        metadata={"version": "1.0", "migrated_from": "langsmith"},
    )
    print()
    print("=" * 50)
    print("✓ Evaluation completed!")
    print("Check Braintrust to see the experiment results.")


if __name__ == "__main__":
    main()
