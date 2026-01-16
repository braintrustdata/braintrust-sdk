# Deno Browser Build Test

This directory tests the browser build (`braintrust/browser`) in Deno.

## Dependencies

The browser build requires these npm packages (marked as `external` in tsup but still imported):

### Required Dependencies

- **`uuid`** - Used by `IDGenerator` for generating span and trace IDs
  - Could potentially be replaced with `node:crypto.randomUUID()` but would require SDK code changes
- **`zod`** (v3 and v4) - Schema validation, used throughout the SDK
  - Core dependency, cannot be removed
- **`mustache`** - Template rendering (default template engine for browser)
  - Used by `Prompt` class for template rendering
- **`eventsource-parser`** - Streaming response parsing
  - Used by OpenAI/Anthropic wrappers for streaming
- **`@vercel/functions`** - Vercel Edge Runtime utilities
  - Used for `waitUntil` in serverless environments
- **`zod-to-json-schema`** - Convert Zod schemas to JSON Schema
  - Used for schema serialization

### Removed Dependencies

- ~~**`nunjucks`**~~ - **REMOVED** by using `.browser.ts` variants
  - The browser build now uses stub implementations that throw errors
  - Browser users should use `templateFormat: 'mustache'` instead

### Why Not Use `node:` Prefix?

The `node:` prefix only works for **Node.js built-in modules** like `node:fs`, `node:crypto`, `node:path`, etc.

It does **NOT** work for npm packages like `uuid`, `zod`, `mustache` - these must be resolved from npm via Deno's import map.

## Build Configuration

The browser build is configured in `sdk/js/tsup.config.ts` with:

- `platform: "browser"` - Enables browser-specific optimizations
- `esbuildPlugins: [browserResolvePlugin]` - Resolves `.browser.ts` variants for platform-specific code
- `external: ["zod"]` - Marks zod as external (still needs to be in import map)

### Browser Variants

Files with `.browser.ts` extensions provide browser-specific implementations:

- `src/template/nunjucks-env.browser.ts` - Throws error instead of using nunjucks
- `src/template/nunjucks-utils.browser.ts` - Throws error for nunjucks linting

The `browserResolvePlugin` in tsup.config.ts automatically resolves these during the browser build.

## Running Tests

```bash
# Using deno task
deno task test:shared

# Or directly
deno test --no-config --import-map=./deno.json --allow-env --allow-read=.,./build --allow-net shared_suite_test.ts
```

Note: We use `--no-config` to avoid Deno's workspace detection which can cause issues with the parent pnpm workspace.

## Updating Lock File

```bash
deno cache --no-config --import-map=./deno.json --lock=deno.lock --frozen=false shared_suite_test.ts
```
