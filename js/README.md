An isomorphic JS library for logging data to Braintrust.

## Version information

**1.x** is the current stable release with improved ESM support. OpenTelemetry integration is available via the separate [`@braintrust/otel`](https://www.npmjs.com/package/@braintrust/otel) package. Temporal integration is available via the separate [`@braintrust/temporal`](https://www.npmjs.com/package/@braintrust/temporal) package (install its peer dependencies alongside it).

### Upgrading from 0.x

If you're on version **0.4.10 or earlier**, we recommend upgrading to **1.x**. See the [TypeScript SDK upgrade guide](https://www.braintrust.dev/docs/reference/sdks/typescript/migrations/v0-to-v1) for migration instructions.

### Quickstart

Install the library with npm (or yarn).

```bash
npm install braintrust
```

Then, run a simple experiment with the following code (replace `YOUR_API_KEY` with
your Braintrust API key):

```javascript
import * as braintrust from "braintrust";

async function main() {
  const experiment = await braintrust.init("NodeTest", {
    apiKey: "YOUR_API_KEY",
  });
  experiment.log({
    input: { test: 1 },
    output: "foo",
    expected: "bar",
    scores: {
      n: 0.5,
    },
    metadata: {
      id: 1,
    },
  });
  console.log(await experiment.summarize());
}

main().catch(console.error);
```

### Browser Support

The Braintrust SDK works in browser environments with full support for async context tracking through AsyncLocalStorage. This enables parent-child span relationships to be maintained automatically in browser-based tracing.

**How it works:**

- In environments with native `AsyncLocalStorage` support (e.g., Next.js Edge Runtime, some Cloudflare Workers), the SDK uses the native implementation
- In standard browsers, the SDK uses [`als-browser`](https://github.com/apm-js-collab/als-browser) to polyfill AsyncLocalStorage functionality
- Parent-child span relationships work transparently through nested `traced()` calls
- `currentSpan()` returns the active span within any traced context

**Example:**

```javascript
import { traced, startSpan } from "braintrust";

// Parent span automatically tracked
await traced(
  async () => {
    // Child span automatically inherits parent
    const child = startSpan({ name: "child-operation" });
    // ... do work ...
    child.end();
  },
  { name: "parent-operation" },
);
```
