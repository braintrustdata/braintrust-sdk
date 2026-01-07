# Braintrust Auto-Instrumentation

Automatic instrumentation for AI SDKs using import hooks. Zero-code tracing for OpenAI, Anthropic, Vercel AI SDK, and Google GenAI.

## Installation

Auto-instrumentation is included in the main `braintrust` package:

```bash
npm install braintrust
```

The `import-in-the-middle` dependency is optional and only loaded when auto-instrumentation is used.

## Usage

### 1. Node.js --import Flag (Recommended)

```bash
BRAINTRUST_AUTO_INSTRUMENT=1 node --import braintrust/auto-instrument/register app.js
```

This is the cleanest approach - no code changes required!

### 2. Programmatic API

#### Next.js (instrumentation.ts)

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupAutoInstrumentation } = await import(
      "braintrust/auto-instrument"
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
import { setupAutoInstrumentation } from "braintrust/auto-instrument";

setupAutoInstrumentation();

// Now import and use SDKs normally - they'll be auto-wrapped
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Client is automatically instrumented!
```

### 3. Environment Variables

```bash
# Enable auto-instrumentation
BRAINTRUST_AUTO_INSTRUMENT=1

# Only instrument specific SDKs
BRAINTRUST_AUTO_INSTRUMENT_INCLUDE=openai,anthropic

# Exclude specific SDKs
BRAINTRUST_AUTO_INSTRUMENT_EXCLUDE=@google/genai

# Enable debug logging
BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1
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
// Just run: BRAINTRUST_AUTO_INSTRUMENT=1 node --import braintrust/auto-instrument/register app.js

import OpenAI from "openai";
const client = new OpenAI(); // Automatically wrapped!
```

**Note:** Manual wrappers are still supported and not deprecated. Auto-instrumentation and manual wrapping can coexist (double-wrap prevention is built-in).

## Troubleshooting

### Import hooks not working

Make sure you're calling `setupAutoInstrumentation()` **before** importing any SDKs:

```typescript
// ✅ Correct order
import { setupAutoInstrumentation } from "braintrust/auto-instrument";
setupAutoInstrumentation();

import OpenAI from "openai"; // This will be wrapped

// ❌ Wrong order
import OpenAI from "openai"; // Already imported, can't be wrapped

import { setupAutoInstrumentation } from "braintrust/auto-instrument";
setupAutoInstrumentation(); // Too late!
```

### Enable debug logging

Set `BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1` to see detailed logging:

```bash
BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import braintrust/auto-instrument/register app.js
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
- `import-in-the-middle` >= 2.0.1 (installed as optional dependency)
