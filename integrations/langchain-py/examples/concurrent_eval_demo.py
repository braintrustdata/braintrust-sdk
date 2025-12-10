"""Demo: Concurrent LangChain callbacks with Braintrust Eval.

This demonstrates that BraintrustCallbackHandler works correctly when
created inside Eval tasks running in parallel across multiple threads.

Usage:
    python examples/concurrent_eval_demo.py

Requires:
    - BRAINTRUST_API_KEY environment variable
    - OPENAI_API_KEY environment variable
"""

import threading

from braintrust import Eval, flush, init_logger
from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from braintrust_langchain import BraintrustCallbackHandler


def main():
    logger = init_logger(project="langchain-py-test")

    def task_fn(input_text, hooks):
        print(f"  {input_text}: {threading.current_thread().name}")

        handler = BraintrustCallbackHandler(logger=logger)

        prompt = ChatPromptTemplate.from_template("Say hi to {name} briefly.")
        model = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        chain = prompt | model

        result = chain.invoke({"name": input_text}, config={"callbacks": [handler]})
        return result.content

    with logger.start_span(name="concurrent-demo") as span:
        print(f"View: {span.link}\n")

        Eval(
            "concurrent-demo",
            data=[{"input": n} for n in ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank"]],
            task=task_fn,
            scores=[],
            parent=span.id,
            max_concurrency=4,
        )

    flush()
    print("\n✅ Done - check Braintrust UI for all LangChain spans")


if __name__ == "__main__":
    main()
