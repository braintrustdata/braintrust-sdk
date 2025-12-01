An isomorphic JS library for logging data to Braintrust.

## Version information

This SDK has two active version lines:

- **1.x** (developed on the `js-1.x` branch): The latest major release with improved ESM support. OpenTelemetry integration is now available via the separate [`@braintrust/otel`](https://www.npmjs.com/package/@braintrust/otel) package.

- **0.4.x** (developed on the `main` branch): The previous version line, available for backward compatibility. Once 1.x is stable, it will be promoted to the `main` branch.

**Recommendation**: Use the latest 1.x release. If you encounter any issues, please reach out to [support@braintrust.dev](mailto:support@braintrust.dev).

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
