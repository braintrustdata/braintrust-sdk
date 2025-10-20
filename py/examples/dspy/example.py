#!/usr/bin/env python
"""
DSPy example demonstrating complex multi-step reasoning with Braintrust observability:
- Multi-hop question answering with context retrieval
- ReAct agent with complex tool orchestration
- Evaluation with focused test cases

This example focuses on depth and complexity rather than breadth, showcasing how DSPy
modules can be composed to create sophisticated AI applications with full observability.

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
    print()

    # Disable DSPy's disk cache (keep memory cache for performance)
    dspy.configure_cache(
        enable_disk_cache=False,
        enable_memory_cache=True,
    )

    # Setup: Configure language model with Braintrust callback
    # You can use "openai/gpt-4o-mini" or other providers
    lm = dspy.LM("openai/gpt-4o-mini")
    dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])

    print("=" * 60)
    print("DSPy Example - Complex Multi-Step Reasoning")
    print("=" * 60)

    # Feature 1: Multi-hop reasoning with ChainOfThought
    print("\n1. Multi-hop Question Answering with Context Retrieval")
    print("-" * 60)

    class MultiHopQA(dspy.Module):
        def __init__(self):
            super().__init__()
            self.generate_query = dspy.ChainOfThought("question -> search_query")
            self.generate_answer = dspy.ChainOfThought("context, question -> answer")

        def forward(self, question):
            # Generate search query
            query_result = self.generate_query(question=question)

            # Simulate retrieval (in real app, you'd search a KB here)
            # Simple keyword-based context selection
            contexts = {
                "eiffel tower": "Paris is the capital and largest city of France. The Eiffel Tower, located in Paris, was completed in 1889 and stands 330 meters tall.",
                "paris": "Paris is the capital and largest city of France. The Eiffel Tower, located in Paris, was completed in 1889 and stands 330 meters tall.",
                "tokyo": "Tokyo is the capital of Japan. The Tokyo Tower was completed in 1958 and is 333 meters tall.",
                "statue of liberty": "The Statue of Liberty is located in New York Harbor. It was completed in 1886 and stands 93 meters tall.",
            }

            # Simple context retrieval based on query
            query_lower = query_result.search_query.lower()
            context = "No relevant information found."
            for key, ctx in contexts.items():
                if key in query_lower:
                    context = ctx
                    break

            # Generate answer from context
            answer_result = self.generate_answer(context=context, question=question)
            return dspy.Prediction(
                search_query=query_result.search_query,
                answer=answer_result.answer,
                reasoning=answer_result.reasoning
            )

    multi_hop = MultiHopQA()

    # Ask multiple multi-hop questions
    mh_questions = [
        "What year was the famous tower in France's capital completed?",
        "How tall is the tower in Japan's capital city?",
        "When was the statue in New York Harbor completed?",
    ]

    for q in mh_questions:
        result = multi_hop(question=q)
        print(f"Q: {q}")
        print(f"Search: {result.search_query}")
        print(f"A: {result.answer}")
        print()

    # Feature 2: Using tools with ReAct
    print("\n2. ReAct Agent with Complex Tool Orchestration")
    print("-" * 60)

    def calculator(expression: str) -> float:
        """Evaluate a mathematical expression."""
        try:
            # Safe eval for basic math
            result = eval(expression, {"__builtins__": {}}, {})
            return float(result)
        except Exception as e:
            return f"Error: {e}"

    def get_current_year() -> int:
        """Get the current year."""
        return 2025

    # ReAct agent with tools - multiple complex questions
    react = dspy.ReAct("question -> answer", tools=[calculator, get_current_year])

    questions = [
        "If I was born in 1990, how old will I be in the current year?",
        "What is 15% of 250, and then add 37 to that result?",
        "If someone born in 2000 is twice as old as someone born in year X, what is X in the current year?",
    ]

    for q in questions:
        result = react(question=q)
        print(f"Q: {q}")
        print(f"A: {result.answer}")
        print()

    # Feature 3: Simple evaluation
    print("\n3. Evaluation")
    print("-" * 60)

    # Create a simple QA system
    qa_system = dspy.Predict("question -> answer")

    # Define test cases - focused dataset
    test_cases = [
        {"question": "What is 2+2?", "expected": "4"},
        {"question": "What is the capital of Japan?", "expected": "Tokyo"},
        {"question": "What is the largest planet?", "expected": "Jupiter"},
        {"question": "What is the smallest prime number?", "expected": "2"},
        {"question": "How many continents are there?", "expected": "7"},
    ]

    # Evaluate
    correct = 0
    for i, test_case in enumerate(test_cases, 1):
        result = qa_system(question=test_case["question"])
        is_correct = test_case["expected"].lower() in result.answer.lower()
        correct += is_correct
        status = "✓" if is_correct else "✗"
        print(f"{status} [{i}/{len(test_cases)}] {test_case['question']}")
        if not is_correct:
            print(f"    Expected: {test_case['expected']}, Got: {result.answer}")

    accuracy = correct / len(test_cases)
    print(f"\n📊 Final Score: {accuracy:.1%} ({correct}/{len(test_cases)} correct)")

    print("\n" + "=" * 60)
    print("Example completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
