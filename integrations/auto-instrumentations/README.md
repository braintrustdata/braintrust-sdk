# @braintrust/auto-instrumentations

Braintrust auto-instrumentation for popular AI SDKs, eliminating the need for manual wrapping.

## Supported SDKs

- ✅ OpenAI SDK v4+ (chat completions, embeddings, moderations)
- 🚧 Anthropic SDK (planned)
- 🚧 Vercel AI SDK (planned)
- 🚧 Google GenAI SDK (planned)

## Installation

```bash
npm install @braintrust/auto-instrumentations braintrust
```

## Usage

### Node.js Applications

For Node.js applications, use the `--import` flag to load the instrumentation hook. This works with both ESM and CJS modules automatically.

```bash
node --import @braintrust/auto-instrumentations/hook.mjs app.js
```

#### Example (ESM)

```typescript
import { initLogger } from "braintrust";
import OpenAI from "openai";

initLogger({ projectName: "my-project" });

// ✨ Automatically instrumented!
const openai = new OpenAI();
```

#### Example (CommonJS)

```javascript
const { initLogger } = require("braintrust");
const OpenAI = require("openai");

initLogger({ projectName: "my-project" });

// ✨ Automatically instrumented!
const openai = new OpenAI();
```

### Browser/Bundled Applications

For browser applications or bundled Node.js applications, use the appropriate bundler plugin.

#### Vite

```typescript
// vite.config.ts
import { vitePlugin } from "@braintrust/auto-instrumentations/bundler/vite";

export default {
  plugins: [vitePlugin()],
};
```

#### Webpack

```javascript
// webpack.config.js
const {
  webpackPlugin,
} = require("@braintrust/auto-instrumentations/bundler/webpack");

module.exports = {
  plugins: [webpackPlugin()],
};
```

#### esbuild

```typescript
// build.ts
import { esbuildPlugin } from "@braintrust/auto-instrumentations/bundler/esbuild";

await esbuild.build({
  plugins: [esbuildPlugin()],
});
```

#### Rollup

```typescript
// rollup.config.ts
import { rollupPlugin } from "@braintrust/auto-instrumentations/bundler/rollup";

export default {
  plugins: [rollupPlugin()],
};
```

## Configuration

### Disabling Specific Integrations

By default, all SDK integrations are automatically instrumented when you use the Braintrust SDK. You can disable specific integrations if needed.

#### Programmatic Configuration

```typescript
import { configureInstrumentation } from "braintrust";

// Disable OpenAI instrumentation
configureInstrumentation({
  integrations: {
    openai: false,
  },
});

// Now import SDKs - OpenAI will not be instrumented
import OpenAI from "openai";
```

**Important:** `configureInstrumentation()` must be called **before** importing any AI SDKs to take effect.

#### Environment Variables

You can also disable integrations using the `BRAINTRUST_DISABLE_INSTRUMENTATION` environment variable with a comma-separated list of SDKs:

```bash
# Disable OpenAI instrumentation
BRAINTRUST_DISABLE_INSTRUMENTATION=openai node --import @braintrust/auto-instrumentations/hook.mjs app.js

# Disable multiple SDKs
BRAINTRUST_DISABLE_INSTRUMENTATION=openai,anthropic node --import @braintrust/auto-instrumentations/hook.mjs app.js
```

Supported SDK names:

- `openai` - OpenAI SDK instrumentation
- `anthropic` - Anthropic SDK instrumentation (when available)
- `vercel` - Vercel AI SDK instrumentation (when available)
- `google` - Google GenAI SDK instrumentation (when available)

## Troubleshooting

### Node.js Hook Not Working

Make sure you're using the `--import` flag (not the deprecated `--loader` flag):

```bash
# Correct
node --import @braintrust/auto-instrumentations/hook.mjs app.js

# Incorrect (deprecated)
node --loader @braintrust/auto-instrumentations/hook.mjs app.js
```

### Bundler Plugin Not Working

Ensure the plugin is added to the `plugins` array in your bundler config, and that you're initializing Braintrust (via `initLogger`) before making AI SDK calls.

## Contributing

To add support for a new SDK:

1. Create a config file in `src/configs/` (e.g., `anthropic.ts`)
2. Define instrumentation configs for each function to instrument
3. Add channel handlers in the `BraintrustPlugin` (in the main `braintrust` package at `js/src/instrumentation/braintrust-plugin.ts`)
4. Export the configs from `src/index.ts`

## License

MIT

## Links

- [Braintrust SDK](https://github.com/braintrustdata/braintrust-sdk)
- [orchestrion-js](https://github.com/apm-js-collab/orchestrion-js)
- [dc-polyfill](https://github.com/mhassan1/dc-polyfill)
