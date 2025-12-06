#!/usr/bin/env python3
"""
Example showing how to migrate LangSmith evaluate() to Braintrust.

This example demonstrates:
1. Setting up the LangSmith wrapper
2. Using client.evaluate() (redirects to Braintrust's Eval)
3. LangSmith-style evaluators working with Braintrust
"""

import os

# IMPORTANT: Call setup_langsmith BEFORE importing from langsmith
from braintrust.wrappers.langsmith import setup_langsmith

setup_langsmith(
    project="langsmith-eval-example",
    api_key=os.environ.get("BRAINTRUST_API_KEY"),
)

# Now import from langsmith - these are patched to use Braintrust
from langsmith import Client, traceable


# Define a target function (the function being evaluated)
@traceable(name="multiply")
def multiply(x: int, y: int) -> int:
    """Multiply two numbers."""
    return x * y


# Define LangSmith-style evaluators
def exact_match_evaluator(run, example):
    """
    LangSmith-style evaluator that checks for exact match.

    Args:
        run: Has .outputs attribute with the function's return value
        example: Has .inputs and .outputs attributes from the dataset
    """
    expected = example.outputs
    actual = run.outputs
    return {
        "key": "exact_match",
        "score": 1.0 if actual == expected else 0.0,
    }


def range_evaluator(run, example):
    """
    LangSmith-style evaluator that checks if result is in expected range.
    """
    actual = run.outputs
    expected = example.outputs
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
    results = client.evaluate(
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
