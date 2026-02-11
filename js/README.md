An isomorphic JS library for logging data to Braintrust.

## Version information

**2.x** is the current stable release. [Zod](https://zod.dev/) is now a peer dependency instead of a bundled dependency. This gives you control over the Zod version in your project and reduces bundle size if you’re already using Zod.

The SDK requires Zod v3.25.34 or later.

### Upgrading from 1.x

See the [Migrate from v1.x to v2.x guide](https://www.braintrust.dev/docs/reference/sdks/typescript/migrations/v1-to-v2) for instructions.

### Upgrading from 0.x

First follow the [Migrate from v0.x to v1.x guide](https://www.braintrust.dev/docs/reference/sdks/typescript/migrations/v0-to-v1), then proceed to the [Migrate from v1.x to v2.x guide](https://www.braintrust.dev/docs/reference/sdks/typescript/migrations/v1-to-v2).

**Note:** If you do not have OpenTelemetry you can upgrade directly from v0.x to v2.x.

### Quickstart

Install the library with npm (or yarn).

```bash
npm install braintrust zod
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
