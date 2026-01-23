# Auto-Instrumentation Internals

This document describes the internal architecture of the Braintrust auto-instrumentation system.

## Architecture Overview

The auto-instrumentation system uses [orchestrion-js](https://github.com/apm-js-collab/orchestrion-js) to perform AST transformations at load-time or build-time, injecting `diagnostics_channel` instrumentation into AI SDK methods.

## How It Works

### 1. Instrumentation Configs

Each SDK integration defines **instrumentation configs** that specify which functions to instrument:

```typescript
{
  channelName: 'chat.completions.create',
  module: {
    name: 'openai',
    versionRange: '>=4.0.0',
    filePath: 'resources/chat/completions.mjs'
  },
  functionQuery: {
    className: 'Completions',
    methodName: 'create',
    kind: 'Async'
  }
}
```

**Note:** The `channelName` should NOT include the `braintrust:` prefix. The code-transformer automatically prepends `orchestrion:openai:` to these names, resulting in final channel names like `orchestrion:openai:chat.completions.create`.

### 2. AST Transformation

At build-time or load-time, orchestrion-js transforms the source code by wrapping instrumented functions with `tracingChannel` calls:

**Before:**

```typescript
class Completions {
  async create(params) {
    // ... actual implementation
  }
}
```

**After:**

```typescript
import { tracingChannel } from 'dc-polyfill';

class Completions {
  async create(params) {
    const channel = tracingChannel('orchestrion:openai:chat.completions.create');
    return channel.tracePromise(
      () => /* original implementation */,
      { arguments: [params] }
    );
  }
}
```

### 3. Event Subscription

The `BraintrustPlugin` (in the main `braintrust` package at `js/src/instrumentation/braintrust-plugin.ts`) subscribes to these channels and converts the events into Braintrust spans:

```typescript
channel.subscribe({
  asyncStart: (event) => {
    const span = startSpan({ name: 'Chat Completion', type: 'llm' });
    span.log({ input: event.arguments[0].messages });
  },
  asyncEnd: (event) => {
    span.log({ output: event.result.choices, metrics: { tokens: ... } });
    span.end();
  },
  error: (event) => {
    span.log({ error: event.error });
    span.end();
  }
});
```

## Load-Time vs Build-Time Instrumentation

### Load-Time (Node.js Hook)

The `hook.mjs` file uses Node.js's module loader hooks to intercept module loading and apply transformations on-the-fly. This approach:

- Works with both ESM and CJS modules
- Requires no build step
- Adds minimal overhead at startup
- Is the recommended approach for Node.js applications

### Build-Time (Bundler Plugins)

The bundler plugins (Vite, Webpack, esbuild, Rollup) apply transformations during the build process. This approach:

- Required for browser environments (no Node.js hooks available)
- Zero runtime overhead (transformations done at build time)
- Works with bundled Node.js applications

## Plugin Architecture

The plugin system follows the OpenTelemetry pattern:

- **Core Infrastructure**: `js/src/instrumentation/core/` in the main `braintrust` package

  - `BasePlugin` - Abstract base class for plugins
  - Channel utilities (`createChannelName`, `parseChannelName`, etc.)
  - Event type definitions

- **Braintrust Implementation**: `js/src/instrumentation/braintrust-plugin.ts` in the main `braintrust` package

  - `BraintrustPlugin` - Converts diagnostics_channel events into Braintrust spans
  - Automatically enabled when the Braintrust SDK is loaded
  - Supports configuration to disable specific integrations

- **Plugin Registry**: `js/src/instrumentation/registry.ts` in the main `braintrust` package

  - `PluginRegistry` - Manages plugin lifecycle
  - Automatically enables `BraintrustPlugin` on SDK initialization
  - Reads configuration from `configureInstrumentation()` API and `BRAINTRUST_DISABLE_INSTRUMENTATION` environment variable
  - `configureInstrumentation()` - Public API for disabling specific integrations

- **Integration Configs**: `src/configs/` in this package
  - SDK-specific instrumentation configurations
  - Consumed by orchestrion-js for transformation

### Auto-Enable Mechanism

The instrumentation is automatically enabled when the Braintrust SDK is loaded:

1. **Node.js**: When `configureNode()` is called (in `src/node.ts`), it calls `registry.enable()`
2. **Browser**: When `configureBrowser()` is called (in `src/browser-config.ts`), it calls `registry.enable()`
3. The registry creates and enables `BraintrustPlugin` with the appropriate configuration
4. Individual integrations (OpenAI, Anthropic, etc.) can be disabled via:
   - Programmatic API: `configureInstrumentation({ integrations: { openai: false } })`
   - Environment variable: `BRAINTRUST_DISABLE_INSTRUMENTATION=openai,anthropic`

### Configuration Priority

Configuration is merged in the following order (later overrides earlier):

1. Default configuration (all integrations enabled)
2. Programmatic configuration via `configureInstrumentation()`
3. Environment variables

**Important**: `configureInstrumentation()` must be called before the SDK is loaded (before importing any AI SDKs) to take effect. After the registry is enabled, configuration changes will log a warning and be ignored.

## Adding Support for a New SDK

1. **Create a config file** in `src/configs/` (e.g., `anthropic.ts`):

```typescript
import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";

export const anthropicConfigs: InstrumentationConfig[] = [
  {
    channelName: "messages.create",
    module: {
      name: "@anthropic-ai/sdk",
      versionRange: ">=0.20.0",
      filePath: "resources/messages.mjs",
    },
    functionQuery: {
      className: "Messages",
      methodName: "create",
      kind: "Async",
    },
  },
];
```

2. **Export the configs** from `src/index.ts`:

```typescript
export { anthropicConfigs } from "./configs/anthropic";
```

3. **Add channel handlers** in `BraintrustPlugin` (in the main `braintrust` package):

```typescript
// In js/src/instrumentation/braintrust-plugin.ts
protected onEnable() {
  // ... existing OpenAI handlers ...

  // Add Anthropic handler
  const anthropicChannel = tracingChannel('orchestrion:anthropic:messages.create');
  anthropicChannel.subscribe({
    asyncStart: (event) => {
      // Create span and log input
    },
    asyncEnd: (event) => {
      // Log output and end span
    },
    error: (event) => {
      // Log error and end span
    }
  });
}
```

## Browser Compatibility

For browser environments:

- The bundler plugins automatically use `dc-browser` instead of `dc-polyfill`
- `dc-browser` provides browser-compatible implementations of Node.js's `diagnostics_channel` API
- The `BraintrustPlugin` works the same in both environments

## Advanced: Custom Plugins

Third parties can create custom plugins by extending `BasePlugin`:

```typescript
import { BasePlugin } from "braintrust/instrumentation";
import { tracingChannel } from "dc-polyfill";

class MyCustomPlugin extends BasePlugin {
  protected onEnable() {
    const channel = tracingChannel(
      "orchestrion:openai:chat.completions.create",
    );

    channel.subscribe({
      asyncEnd: (event) => {
        // Custom handling - e.g., log to console, send to external service, etc.
        console.log("OpenAI call completed:", event.result);
      },
    });
  }

  protected onDisable() {
    // Cleanup subscriptions
  }
}
```

Note: Plugins must be constructed and enabled within the core Braintrust library. Due to ESM loading semantics, users cannot manually enable plugins from application code.

## Testing

The test suite covers:

- **Config validation** (`src/configs/*.test.ts`) - Verify config structure
- **AST transformation** (`test/transformation.test.ts`) - Verify orchestrion-js transforms code correctly
- **Runtime execution** (`test/runtime-execution.test.ts`) - Verify transformed code executes correctly
- **Event content** (`test/event-content.test.ts`) - Verify events contain expected data
- **Error handling** (`test/error-handling.test.ts`) - Verify errors propagate correctly
- **Loader hooks** (`test/loader-hook.test.ts`) - Verify Node.js hooks work
