"""
Example: LangChain with auto_instrument()

This example demonstrates automatic tracing of LangChain operations
using braintrust.auto_instrument().

Run with: python examples/langchain/auto.py
"""

import braintrust

# One-line instrumentation - call this BEFORE importing LangChain
results = braintrust.auto_instrument()
print(f"LangChain instrumented: {results.get('langchain', False)}")

# Initialize logging
logger = braintrust.init_logger(project="langchain-auto-example")

# Now import LangChain - all operations are automatically traced
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

# Create a simple chain
prompt = ChatPromptTemplate.from_template("What is {number} + {number}?")
model = ChatOpenAI(model="gpt-4o-mini")
chain = prompt | model

# Wrap in a span to get a link
with braintrust.start_span(name="langchain_auto_example") as span:
    print("Running LangChain chain...")
    result = chain.invoke({"number": "5"})
    print(f"Result: {result.content}")
    span.log(output=result.content)

print(f"\nView trace: {span.link()}")
