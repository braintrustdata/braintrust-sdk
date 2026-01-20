#!/usr/bin/env python3
# type: ignore
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
def multiply(inputs: dict, **kwargs) -> int:
    """Multiply two numbers.

    Args:
        inputs: Dictionary with 'x' and 'y' keys
        **kwargs: Additional arguments (e.g., langsmith_extra from LangSmith)
    """
    return inputs["x"] * inputs["y"]


# Define LangSmith-style evaluators
# LangSmith evaluators use signature: (inputs, outputs, reference_outputs) -> bool | dict
# When target returns a plain value, LangSmith wraps it as {"output": value}
def exact_match_evaluator(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """
    LangSmith-style evaluator that checks for exact match.
    """
    expected = reference_outputs["output"]
    actual = outputs["output"]
    return {
        "key": "exact_match",
        "score": 1.0 if actual == expected else 0.0,
    }


def range_evaluator(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """
    LangSmith-style evaluator that checks if result is in expected range.
    """
    actual = outputs["output"]
    expected = reference_outputs["output"]
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

    # Create a dataset in LangSmith (proper LangSmith API usage)
    dataset_name = "multiply-dataset-example"

    # Try to get or create the dataset
    try:
        dataset = client.read_dataset(dataset_name=dataset_name)
        print(f"Using existing dataset: {dataset_name}")
    except Exception:
        # Create new dataset if it doesn't exist
        dataset = client.create_dataset(dataset_name=dataset_name, description="Multiplication test dataset")
        print(f"Created new dataset: {dataset_name}")

        # Create examples in the dataset (proper LangSmith API)
        client.create_examples(
            dataset_id=dataset.id,
            examples=[
                {"inputs": {"x": 2, "y": 3}, "outputs": {"output": 6}},
                {"inputs": {"x": 5, "y": 5}, "outputs": {"output": 25}},
                {"inputs": {"x": 10, "y": 0}, "outputs": {"output": 0}},
                {"inputs": {"x": 7, "y": 8}, "outputs": {"output": 56}},
            ],
        )
        print(f"Created {4} examples in dataset")

    print()
    print("Running evaluation...")
    print()

    # Run evaluation using LangSmith's API (redirects to Braintrust)
    # Pass the dataset name - this is valid LangSmith API usage
    client.evaluate(
        multiply,  # Target function
        data=dataset_name,  # Dataset name (valid LangSmith API)
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
