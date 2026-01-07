# @braintrust/auto-instrument

Automatic instrumentation for the Braintrust SDK using import hooks. This package enables zero-code instrumentation for popular AI SDKs.

## Features

- ✅ Zero-code auto-instrumentation via import hooks
- ✅ Supports OpenAI (more SDKs coming soon: Anthropic, Vercel AI SDK, Google GenAI)
- ✅ Opt-in by default (explicit flag required)
- ✅ Silent fallback with debug logging
- ✅ Compatible with manual wrapping (double-wrap prevention)

## Installation

```bash
npm install @braintrust/auto-instrument
# or
pnpm add @braintrust/auto-instrument
```

## Usage

### 1. CLI (Recommended)

Run your application with automatic instrumentation:

```bash
# Auto-instrument all supported SDKs
braintrust instrument node app.js

# Only instrument specific SDKs
braintrust instrument --instrument openai node app.js

# Debug mode
braintrust instrument --debug node app.js
```

### 2. Programmatic API

#### Next.js (instrumentation.ts)

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupAutoInstrumentation } = await import(
      "@braintrust/auto-instrument"
    );
    setupAutoInstrumentation({
      include: ["openai"], // Only instrument OpenAI
    });
  }
}
```

Make sure to enable the instrumentation hook in `next.config.js`:

```javascript
module.exports = {
  experimental: {
    instrumentationHook: true,
  },
};
```

#### General Node.js Application

```typescript
// At the very top of your entry file, before any other imports
import { setupAutoInstrumentation } from "@braintrust/auto-instrument";

setupAutoInstrumentation();

// Now import and use SDKs normally - they'll be auto-wrapped
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Client is automatically instrumented!
```

### 3. Environment Variables

```bash
# Enable auto-instrumentation
export BRAINTRUST_AUTO_INSTRUMENT=1

# Only instrument specific SDKs
export BRAINTRUST_AUTO_INSTRUMENT_INCLUDE=openai

# Exclude specific SDKs
export BRAINTRUST_AUTO_INSTRUMENT_EXCLUDE=openai

# Enable debug logging
export BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1

# Run with --import flag
node --import @braintrust/auto-instrument/register app.js
```

## Configuration

### Config Options

```typescript
interface Config {
  enabled: boolean; // Enable/disable instrumentation (default: true)
  include: string[]; // SDKs to instrument (empty = all)
  exclude: string[]; // SDKs to exclude (default: [])
  debug: boolean; // Enable debug logging (default: false)
}
```

### Supported SDKs

- ✅ `openai` - OpenAI SDK
- 🚧 `@anthropic-ai/sdk` - Anthropic SDK (coming soon)
- 🚧 `@ai-sdk/core` - Vercel AI SDK (coming soon)
- 🚧 `@google/genai` - Google GenAI (coming soon)

## How It Works

This package uses [`import-in-the-middle`](https://github.com/nodejs/import-in-the-middle) to hook into Node.js module loading. When a supported SDK is imported, we automatically wrap it with Braintrust's instrumentation.

The wrapper:

1. Detects when an SDK is imported
2. Wraps SDK constructors/functions with Braintrust tracing
3. Prevents double-wrapping if manual wrapping is also used
4. Falls back gracefully on errors (never crashes your app)

## Migration from Manual Wrapping

If you're currently using manual wrapping:

```typescript
// Before (manual)
import { wrapOpenAI } from "braintrust";
import OpenAI from "openai";

const client = wrapOpenAI(new OpenAI());
```

You can now use auto-instrumentation:

```typescript
// After (auto-instrumentation via CLI)
// Just run: braintrust instrument node app.js

import OpenAI from "openai";
const client = new OpenAI(); // Automatically wrapped!
```

**Note:** Manual wrappers are still supported and not deprecated. Auto-instrumentation and manual wrapping can coexist (double-wrap prevention is built-in).

## Troubleshooting

### Import hooks not working

Make sure you're calling `setupAutoInstrumentation()` **before** importing any SDKs:

```typescript
// ✅ Correct order
import { setupAutoInstrumentation } from "@braintrust/auto-instrument";
setupAutoInstrumentation();

import OpenAI from "openai"; // This will be wrapped

// ❌ Wrong order
import OpenAI from "openai"; // Already imported, can't be wrapped

import { setupAutoInstrumentation } from "@braintrust/auto-instrument";
setupAutoInstrumentation(); // Too late!
```

### Enable debug logging

Set `BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1` to see detailed logging:

```bash
BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import @braintrust/auto-instrument/register app.js
```

### Verify wrapping

Check if your client is wrapped:

```typescript
const client = new OpenAI();

if (client[Symbol.for("braintrust.wrapped.openai")]) {
  console.log("✅ OpenAI client is wrapped");
} else {
  console.log("❌ OpenAI client is NOT wrapped");
}
```

## Requirements

- Node.js >= 18.0.0
- Braintrust SDK >= 2.0.0

## License

MIT
