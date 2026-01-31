# Braintrust Browser SDK

Official browser-only SDK for [Braintrust](https://braintrust.dev).

This is an integration package that provides browser-optimized builds of the Braintrust SDK with AsyncLocalStorage polyfill support for standard browsers.

## Installation

```bash
npm install @braintrust/browser braintrust
# or
pnpm add @braintrust/browser braintrust
# or
yarn add @braintrust/browser braintrust
```

Note: `braintrust` is a peer dependency and must be installed alongside `@braintrust/browser`.

## Usage

```typescript
import * as braintrust from "@braintrust/browser";

const experiment = await braintrust.init("BrowserExperiment", {
  apiKey: "YOUR_API_KEY",
});

// Use tracing in browser
const result = await braintrust.traced(
  async () => {
    // Your code here
    return "result";
  },
  { name: "myOperation" },
);
```

## Differences from Main Package

This package:

- **Includes** `als-browser` polyfill for AsyncLocalStorage (bundled)
- **Requires** `braintrust` as a peer dependency

## When to Use

Use `@braintrust/browser` when:

- Building browser-only applications
- Need AsyncLocalStorage support in standard browsers

Use `braintrust` directly when:

- Building Node.js applications
- Using in Next.js or other full-stack frameworks (with proper module resolution)
- Need CLI tools or filesystem access

## Features

All browser-compatible features from the main SDK:

- Logging and tracing
- Experiments and datasets
- Prompt management
- AI provider wrappers (OpenAI, Anthropic, Google)
- Evaluation framework
- OpenTelemetry integration

## Documentation

For full documentation, visit [https://www.braintrust.dev/docs](https://www.braintrust.dev/docs)

## License

Apache-2.0
