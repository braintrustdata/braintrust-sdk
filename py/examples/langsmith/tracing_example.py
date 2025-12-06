#!/usr/bin/env python3
"""
Example showing how to migrate LangSmith @traceable to Braintrust.

This example demonstrates:
1. Setting up the LangSmith wrapper
2. Using @traceable decorated functions (traces go to Braintrust)
3. Nested tracing with multiple functions
"""

import os

# IMPORTANT: Call setup_langsmith BEFORE importing from langsmith
from braintrust.wrappers.langsmith import setup_langsmith

setup_langsmith(
    project="langsmith-migration-example",
    api_key=os.environ.get("BRAINTRUST_API_KEY"),
)

# Now import from langsmith - these are patched to use Braintrust
from langsmith import traceable


@traceable(name="format_prompt")
def format_prompt(question: str) -> str:
    """Format a question into a prompt."""
    return f"Please answer the following question concisely:\n\n{question}"


@traceable(name="mock_llm_call")
def mock_llm_call(prompt: str) -> str:
    """Simulate an LLM call (replace with real OpenAI/Anthropic call)."""
    # In a real scenario, you'd call an LLM here
    return f"This is a mock response to: {prompt[:50]}..."


@traceable(name="answer_question")
def answer_question(question: str) -> dict:
    """
    Main function that answers a question.

    This creates a trace with nested spans for each step.
    """
    prompt = format_prompt(question)
    response = mock_llm_call(prompt)
    return {
        "question": question,
        "answer": response,
    }


def main():
    print("LangSmith to Braintrust Tracing Example")
    print("=" * 50)
    print()

    questions = [
        "What is the capital of France?",
        "How does photosynthesis work?",
        "What is 2 + 2?",
    ]

    for question in questions:
        print(f"Question: {question}")
        result = answer_question(question)
        print(f"Answer: {result['answer']}")
        print()

    print("=" * 50)
    print("✓ Example completed!")
    print("Check Braintrust to see the traces.")


if __name__ == "__main__":
    main()
