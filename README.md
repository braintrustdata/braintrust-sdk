# Braintrust SDK

[Braintrust](https://www.braintrust.dev/) is a platform for evaluating and shipping AI products. To learn more about Braintrust or sign up for free,
visit our [website](https://www.braintrust.dev/) or check out the [docs](https://www.braintrust.dev/docs).

This repository contains the JavaScript SDK for Braintrust. The SDK includes utilities to:

- Log experiments and datasets to Braintrust
- Run evaluations (via the `Eval` framework)

## Quickstart

First, install the Braintrust SDK:

```bash
npm install braintrust autoevals
```

or

```bash

yarn add braintrust autoevals

```

Then, create a file named `tutorial.eval.ts` with the following code:

```typescript
import { Eval } from "braintrust";
import { LevenshteinScorer } from "autoevals";

Eval("Say Hi Bot", {
  data: () => {
    return [
      {
        input: "Foo",
        expected: "Hi Foo",
      },
      {
        input: "Bar",
        expected: "Hello Bar",
      },
    ]; // Replace with your eval dataset
  },
  task: (input) => {
    return "Hi " + input; // Replace with your LLM call
  },
  scores: [LevenshteinScorer],
});
```

Then, run the following command:

```bash
BRAINTRUST_API_KEY=<YOUR_API_KEY> \
    npx braintrust eval tutorial.eval.ts
```

## Integrations

Braintrust provides integrations with several popular AI development tools and platforms:

- **LangChain.js**: A callback handler to automatically log LangChain.js executions to Braintrust. [Learn more](integrations/langchain-js)
- **Val Town**: Examples and templates for using Braintrust with Val Town's serverless JavaScript/TypeScript environment. [Learn more](integrations/val.town)
- **Vercel AI SDK**: Integration with Vercel's AI SDK for building AI-powered applications. [Learn more](integrations/vercel-ai-sdk)

## Documentation

For more information, check out the [docs](https://www.braintrust.dev/docs):

- [TypeScript](https://www.braintrust.dev/docs/reference/sdks/typescript)
