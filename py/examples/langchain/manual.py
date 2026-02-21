"""
Example: LangChain with manual setup

This example demonstrates using setup_langchain() for global handler registration
and BraintrustCallbackHandler for per-call tracing.

Run with: python examples/langchain/manual.py
"""

import braintrust
from braintrust.wrappers.langchain import (
    BraintrustCallbackHandler,
    set_global_handler,
    setup_langchain,
)

# Initialize logging
logger = braintrust.init_logger(project="langchain-manual-example")

# Method 1: Global handler via setup_langchain()
# This registers a handler that traces ALL LangChain operations automatically
print("Method 1: Global handler")
setup_langchain()

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

prompt = ChatPromptTemplate.from_template("What is the capital of {country}?")
model = ChatOpenAI(model="gpt-4o-mini")
chain = prompt | model

# All operations are traced automatically
result = chain.invoke({"country": "France"})
print(f"  Capital: {result.content}\n")


# Method 2: Per-call handler
# This is useful when you want more control over which calls are traced
print("Method 2: Per-call handler")

# Create a handler with a specific logger
handler = BraintrustCallbackHandler(logger=logger)

# Pass the handler explicitly to chain.invoke()
result = chain.invoke(
    {"country": "Japan"},
    config={"callbacks": [handler]}
)
print(f"  Capital: {result.content}\n")


# Method 3: Global handler with custom handler instance
print("Method 3: Custom global handler")

# Create a custom handler and set it globally
custom_handler = BraintrustCallbackHandler(logger=logger)
set_global_handler(custom_handler)

result = chain.invoke({"country": "Brazil"})
print(f"  Capital: {result.content}\n")

print("Check Braintrust dashboard for traces!")
