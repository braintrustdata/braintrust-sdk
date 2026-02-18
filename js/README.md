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

**Breaking change in v3.0.0:** The `braintrust/browser` subpath export has been deprecated. Browser users should migrate to the `@braintrust/browser` package.

### Auto-Instrumentation

Braintrust provides automatic instrumentation for popular AI SDKs, eliminating the need for manual wrapping. This feature automatically logs all AI SDK calls (OpenAI, Anthropic, Vercel AI SDK, etc.) to Braintrust without any code changes.

#### Node.js Applications

For Node.js applications, use the `--import` flag to load the instrumentation hook:

```bash
node --import braintrust/hook.mjs app.js
```

This works with both ESM and CommonJS modules automatically.

#### Browser/Bundled Applications

For browser applications or bundled Node.js applications, use the appropriate bundler plugin:

**Vite:**

```typescript
// vite.config.ts
import { vitePlugin } from "braintrust/vite";

export default {
  plugins: [vitePlugin()],
};
```

**Webpack:**

```javascript
// webpack.config.js
const { webpackPlugin } = require("braintrust/webpack");

module.exports = {
  plugins: [webpackPlugin()],
};
```

**esbuild:**

```typescript
import { esbuildPlugin } from "braintrust/esbuild";

await esbuild.build({
  plugins: [esbuildPlugin()],
});
```

**Rollup:**

```typescript
import { rollupPlugin } from "braintrust/rollup";

export default {
  plugins: [rollupPlugin()],
};
```

For more information on auto-instrumentation, see the [internal architecture docs](src/auto-instrumentations/README.md).
