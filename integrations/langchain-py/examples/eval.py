"""
Simple Usage Example - Python

This example demonstrates simple usage of BraintrustCallbackHandler
where the handler is created inside the task without explicitly
passing the logger parameter.

This works because the handler captures the current span context
at operation time when created inside a Braintrust task.

Run with:
    python examples/simple_usage.py

Requirements:
    pip install braintrust langchain langchain-openai
"""

from braintrust import Eval
from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from braintrust_langchain import BraintrustCallbackHandler


def main():
    print("Starting simple usage example...\n")

    result = Eval(
        "LangChain Simple Example",
        data=[
            {"input": "Tell me a short joke about programming", "expected": "funny"},
            {"input": "What's 15 + 27?", "expected": "42"},
        ],
        task=task_fn,
        scores=[completed_scorer],
        # Run sequentially for this simple example
        max_concurrency=1,
    )

    print("\n✅ Eval completed!")
    print(f"Results: {len(result.results)} tasks processed")
    print(f"Experiment URL: {result.summary.experiment_url or 'N/A (local run)'}")

    # Show results
    for i, r in enumerate(result.results):
        print(f"\nTask {i + 1}:")
        print(f"  Input: {r.input}")
        output_preview = str(r.output)[:100]
        print(f"  Output: {output_preview}...")


def task_fn(input, hooks):
    """
    Task function that processes each input using LangChain.

    Args:
        input: The input question to process
        hooks: Braintrust hooks object (not used in this example)

    Returns:
        The LLM's response as a string
    """
    print(f'Processing: "{input}"')

    # ✅ Create handler without explicit logger
    # This works because we're inside a Braintrust task,
    # so the handler captures the current span context automatically
    handler = BraintrustCallbackHandler()

    prompt = ChatPromptTemplate.from_template("{question}")

    model = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.7,
    )

    chain = prompt | model

    message = chain.invoke(
        {"question": input},
        config={"callbacks": [handler]},
    )

    return message.content


def completed_scorer(**kwargs):
    """
    Simple scorer that marks all tasks as completed.
    """
    return {
        "name": "completed",
        "score": 1,
    }


if __name__ == "__main__":
    main()
