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

**For browser-only applications, use the dedicated browser package:**

```bash
npm install @braintrust/browser
```

The `@braintrust/browser` package is optimized for browser environments and includes the `als-browser` polyfill for AsyncLocalStorage support. It's a standalone package with no peer dependencies.

**When to use each package:**

- **`braintrust`** (this package) - For Node.js applications, full-stack frameworks (Next.js, etc.), and edge runtimes with native AsyncLocalStorage (Cloudflare Workers, Vercel Edge)
- **`@braintrust/browser`** - For browser-only applications that need AsyncLocalStorage support in standard browsers

See the [@braintrust/browser README](../integrations/browser-js/README.md) for more details.

**Breaking change in v3.0.0:** The `braintrust/browser` subpath export has been removed. Browser users should migrate to the `@braintrust/browser` package.
