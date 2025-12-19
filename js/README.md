An isomorphic JS library for logging data to Braintrust.

## Version information

**1.x** is the current stable release with improved ESM support. OpenTelemetry integration is available via the separate [`@braintrust/otel`](https://www.npmjs.com/package/@braintrust/otel) package.

### Upgrading from 0.x

If you're on version **0.4.10 or earlier**, we recommend upgrading to **1.x**. See the [TypeScript SDK upgrade guide](https://www.braintrust.dev/docs/reference/sdks/typescript-upgrade-guide) for migration instructions.

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

## Dependencies

### Zod

The Braintrust SDK works with [Zod](https://github.com/colinhacks/zod) for schema validation. Both Zod v3 and v4 are supported.

If you don't already have Zod installed, you'll need to install it alongside the SDK:

```bash
# Install both packages together
npm install braintrust zod

# Or with a specific Zod version
npm install braintrust zod@^4
```

The SDK is tested and compatible with both:

- Zod v3 (^3.25)
- Zod v4 (^4.0)
