# Braintrust Browser SDK

Official browser-only SDK for [Braintrust](https://braintrust.dev).

## Installation

```bash
npm install @braintrust/browser
# or
pnpm add @braintrust/browser
# or
yarn add @braintrust/browser
```

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

- **Includes** `als-browser` polyfill for AsyncLocalStorage
- **Standalone** - no peer dependencies required
- **Optimized** for browser bundle size
- **Auto-configures** browser environment on import

## When to Use

Use `@braintrust/browser` when:

- Building browser-only applications
- Need AsyncLocalStorage support in standard browsers
- Want a standalone package with no peer dependencies

Use `braintrust` when:

- Building Node.js applications
- Using in Next.js or other full-stack frameworks
- Need CLI tools or filesystem access
- Running in edge runtimes with native AsyncLocalStorage

## Features

All browser-compatible features from the main SDK:

- Logging and tracing
- Experiments and datasets
- Prompt management
- AI provider wrappers (OpenAI, Anthropic, Google)
- Evaluation framework
- OpenTelemetry integration

## Environment Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Edge runtimes (Cloudflare Workers, Vercel Edge)
- React Native (with polyfills)
- Electron renderer process

## Documentation

For full documentation, visit [https://www.braintrust.dev/docs](https://www.braintrust.dev/docs)

## License

MIT
