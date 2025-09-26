# braintrust-langchain

SDK for integrating [Braintrust](https://braintrust.dev) with [LangChain](https://langchain.com/). This package provides a callback handler to automatically log LangChain executions to Braintrust.

## Installation

```bash
pip install braintrust-langchain
```

## Requirements

- Python >= 3.9
- LangChain >= 0.1.0

## Usage

First, make sure you have your Braintrust API key set in your environment:

```bash
export BRAINTRUST_API_KEY="your-api-key"
```

### Basic Usage

```python
import asyncio
from braintrust import init_logger
from braintrust_langchain import BraintrustCallbackHandler, set_global_handler
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate


async def main():
    # Initialize the logger with your project
    init_logger(project="your-project-name")

    # Create the callback handler and set it globally for all LangChain components
    handler = BraintrustCallbackHandler()
    set_global_handler(handler)

    # Initialize your LangChain components
    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    model = ChatOpenAI()

    # Create a simple chain
    chain = prompt | model

    # Use LangChain as normal - all calls will be logged to Braintrust
    response = await chain.ainvoke({"number": "2"})


if __name__ == "__main__":
    asyncio.run(main())
```

If you'd prefer to pass the callback handler to specific LangChain calls instead of setting it globally, you can do so using the `callbacks` config option:

```python
async def main():
    handler = BraintrustCallbackHandler()

    # Pass the handler to specific calls
    response = await chain.ainvoke(
        {"number": "2"},
        config={"callbacks": [handler]}
    )

    # Or initialize components with the handler
    model = ChatOpenAI(callbacks=[handler])
```

### Supported Features

The callback handler supports logging for:

- LLM calls (including streaming)
- Chat model interactions
- Chain executions
- Tool/Agent usage
- Memory operations
- State management (LangGraph)

Review the [LangChain documentation](https://python.langchain.com/docs/modules/callbacks/) for more information on how to use callbacks.

## Development

Contributions are welcomed!

```bash
git clone https://github.com/braintrustdata/sdk.git

cd sdk/integrations/langchain-py

pip install -e ".[dev]"

# work on the code

pytest
```
