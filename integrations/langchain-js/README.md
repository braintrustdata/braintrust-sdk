# @braintrust/langchain-js

SDK for integrating [Braintrust](https://braintrust.dev) with [LangChain.js](https://langchain.com/js). This package provides a callback handler to automatically log LangChain.js executions to Braintrust.

## Installation

```bash
npm install @braintrust/langchain-js
# or
yarn add @braintrust/langchain-js
# or
pnpm add @braintrust/langchain-js
```

## Requirements

- Node.js >= 16
- LangChain.js >= 0.3.42 (incl. 1.0.0)

## Usage

First, make sure you have your Braintrust API key set in your environment:

```bash
export BRAINTRUST_API_KEY="your-api-key"
```

### Basic Usage

```typescript
import { ChatOpenAI } from "@langchain/openai";
import {
  BraintrustCallbackHandler,
  setGlobalHandler,
} from "@braintrust/langchain-js";

// Create the callback handler (optionally pass in a custom logger)
const handler = new BraintrustCallbackHandler();

// Set the handler for all LangChain components
setGlobalHandler(handler);

// Use LangChain as normal - all calls will be logged to Braintrust
const response = await model.invoke("Tell me a joke about bears");
```

If you'd like to pass the callback handler to specific LangChain calls, you can do so by passing the handler to the `callbacks` option.

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { BraintrustCallbackHandler } from "@braintrust/langchain-js";

// Create the callback handler (optionally pass in a custom logger)
const handler = new BraintrustCallbackHandler();

// Initialize your LangChain components with the handler
const model = new ChatOpenAI({
  callbacks: [handler],
});

// Use LangChain as normal - all calls will be logged to Braintrust
const response = await model.invoke("Tell me a joke about bears", {
  callbacks: [handler],
});
```

### Supported Features

The callback handler supports logging for:

- LLM calls (including streaming)
- Chat model interactions
- Chain executions
- Tool/Agent usage
- Memory operations
- State management (LangGraph)

Review the [LangChain.js documentation](https://js.langchain.com/docs/how_to/#callbacks) for more information on how to use callbacks.

## Development

Contributions are welcomed!

```bash
git clone https://github.com/braintrustdata/sdk.git

cd sdk/integrations/langchain-js

pnpm install

# work on the code

pnpm test
pnpm build
```
