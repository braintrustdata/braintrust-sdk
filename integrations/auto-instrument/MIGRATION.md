# Migration Guide: braintrust/auto-instrument → @braintrust/auto-instrument

Auto-instrumentation has moved to a separate package to better support ESM requirements and keep the main braintrust package compatible with both CommonJS and ESM.

## Installation

**Before:**

```bash
npm install braintrust
```

**After:**

```bash
npm install @braintrust/auto-instrument braintrust
```

## Usage Changes

### Programmatic API

**Before:**

```typescript
import { setupAutoInstrumentation } from "braintrust/auto-instrument";

setupAutoInstrumentation();
```

**After:**

```typescript
import { setupAutoInstrumentation } from "@braintrust/auto-instrument";

setupAutoInstrumentation();
```

### CLI Flag

**Before:**

```bash
node --import braintrust/auto-instrument/register app.js
```

**After:**

```bash
node --import @braintrust/auto-instrument/register app.js
```

### Next.js instrumentation.ts

**Before:**

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupAutoInstrumentation } = await import(
      "braintrust/auto-instrument"
    );
    setupAutoInstrumentation();
  }
}
```

**After:**

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupAutoInstrumentation } = await import(
      "@braintrust/auto-instrument"
    );
    setupAutoInstrumentation();
  }
}
```

### Environment Variables

**No changes** - all `BRAINTRUST_AUTO_INSTRUMENT_*` environment variables work the same:

- `BRAINTRUST_AUTO_INSTRUMENT=1`
- `BRAINTRUST_AUTO_INSTRUMENT_INCLUDE=openai,anthropic`
- `BRAINTRUST_AUTO_INSTRUMENT_EXCLUDE=@google/genai`
- `BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1`

## Requirements Update

The new package has explicit requirements:

- **Node.js >= 18.19.0** (for `module.register()` API)
- **ESM-only** (CommonJS require() not supported)
- **Braintrust SDK >= 2.0.0**

## CommonJS Projects

Auto-instrumentation now requires ESM. If you're using CommonJS:

### Option 1: Convert to ESM (Recommended)

Add to your package.json:

```json
{
  "type": "module"
}
```

Use import/export instead of require():

```javascript
// Before (CommonJS)
const { wrapOpenAI } = require("braintrust");
const OpenAI = require("openai");

// After (ESM)
import { wrapOpenAI } from "braintrust";
import OpenAI from "openai";
```

### Option 2: Use Manual Wrapping

If you must stay on CommonJS, use manual wrapping:

```javascript
const { wrapOpenAI } = require("braintrust");
const OpenAI = require("openai");

const client = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
```

Manual wrappers work the same in both CommonJS and ESM, and are fully supported.

## Why the Change?

### 1. Better Compatibility

The main braintrust package stays compatible with both CommonJS and ESM projects.

### 2. Optional Feature

Not all users need auto-instrumentation. Making it a separate package allows users to opt-in.

### 3. Clearer Requirements

The ESM-only requirement is now explicit in the package name and documentation.

### 4. Smaller Main Package

The main braintrust package no longer includes the optional `import-in-the-middle` dependency.

### 5. Technical Limitations

`import-in-the-middle` (the library that powers auto-instrumentation) only works with ESM imports. It cannot intercept CommonJS `require()` calls.

## Timeline

- **Braintrust 2.0**: Auto-instrumentation available via `braintrust/auto-instrument`
- **Braintrust 2.1+**: Auto-instrumentation moved to `@braintrust/auto-instrument`
- **Migration period**: Both work during transition
- **Future**: Old path (`braintrust/auto-instrument`) will be removed

## Need Help?

- Read the [README](./README.md) for usage examples
- Check the [Braintrust documentation](https://www.braintrust.dev/docs)
- Open an issue on [GitHub](https://github.com/braintrustdata/braintrust-sdk)

## Quick Migration Checklist

- [ ] Install `@braintrust/auto-instrument` package
- [ ] Update imports from `braintrust/auto-instrument` to `@braintrust/auto-instrument`
- [ ] Update `--import` flags in npm scripts/launch configs
- [ ] Update `instrumentation.ts` if using Next.js
- [ ] Verify Node.js version is >= 18.19.0
- [ ] If using CommonJS, decide: migrate to ESM or use manual wrapping
- [ ] Test that auto-instrumentation still works
- [ ] Update any documentation or team guides
