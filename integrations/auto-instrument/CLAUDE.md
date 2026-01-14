# @braintrust/auto-instrument Development Guide

## Package Overview

This package provides automatic instrumentation for AI SDKs using ESM import hooks.

## Architecture

- **ESM-only**: Uses import-in-the-middle which only works with ESM imports
- **Wrapper delegation**: Detectors call wrapper functions from main braintrust package
- **Global function pattern**: Wrappers registered on globalThis by main package
- **Single version testing**: Tests with latest import-in-the-middle
- **Build configuration**: ESM only (no CommonJS build)

## Dependencies

- `import-in-the-middle`: ESM module loading hooks
- `braintrust`: Main package with wrapper implementations

## Why Separate Package?

1. **ESM requirement**: import-in-the-middle doesn't work with CommonJS require()
2. **Optional functionality**: Not all users need auto-instrumentation
3. **Clear boundaries**: Main package stays CJS+ESM compatible
4. **Explicit opt-in**: Users choose to install and use it

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm watch

# Test
pnpm test

# Integration test
node --import ./dist/register.mjs test-openai.mjs
node --import ./dist/register.mjs test-anthropic.mjs
node --import ./dist/register.mjs test-ai-sdk.mjs
node --import ./dist/register.mjs test-otel-integration.mjs
```

## How It Works

1. User adds --import flag: `node --import @braintrust/auto-instrument/register`
2. register.ts loads braintrust package (registers global wrappers)
3. setupAutoInstrumentation() detects if @braintrust/otel is installed
4. If found, automatically calls setupOtelCompat() for bidirectional tracing
5. register.ts registers import-in-the-middle hook
6. When SDK imported, detector intercepts and calls global wrapper
7. SDK client/instance gets wrapped automatically

## File Structure

```
src/
├── index.ts              # Main API entry point
├── register.ts           # Node.js --import entry point
├── loader.ts             # Hook registration logic
├── config.ts             # Configuration management
├── util.ts               # Utilities (logging, version detection)
└── detectors/
    ├── openai.ts         # OpenAI detector
    ├── anthropic.ts      # Anthropic detector
    ├── ai-sdk.ts         # Vercel AI SDK detector
    └── google-genai.ts   # Google GenAI detector
```

## Detector Pattern

Each detector:

1. Intercepts module exports when imported
2. Checks if already wrapped (double-wrap prevention)
3. Calls global wrapper function from main braintrust package
4. Returns wrapped exports
5. Handles errors gracefully

Example:

```typescript
export function wrapOpenAI(exports: any, config: Config): any {
  // Check if module is already wrapped
  if (exports[WRAPPED_SYMBOL]) {
    return exports;
  }

  // Get global wrapper function
  const braintrustWrapOpenAI = globalThis.__inherited_braintrust_wrap_openai;

  // Wrap constructor with Proxy
  return new Proxy(exports, {
    construct(target, args) {
      const instance = new target(...args);
      return braintrustWrapOpenAI(instance);
    },
  });
}
```

## Global Wrapper Functions

The main braintrust package registers these on globalThis:

- `__inherited_braintrust_wrap_openai`
- `__inherited_braintrust_wrap_anthropic`
- `__inherited_braintrust_wrap_ai_sdk_individual`
- `__inherited_braintrust_wrap_google_genai_individual`

## OpenTelemetry Auto-Detection

The package automatically detects and enables OpenTelemetry compatibility:

**How it works:**

1. `detectAndSetupOtel()` checks if `@braintrust/otel` is installed
2. If found, loads the package and calls `setupOtelCompat()`
3. This enables bidirectional tracing between Braintrust and OpenTelemetry
4. All happens automatically - no user configuration needed

**Implementation:**

```typescript
// In util.ts
export function detectAndSetupOtel(config: Config): boolean {
  // Check if @braintrust/otel has registered its setup function on globalThis
  const setupOtelCompat = (globalThis as any).__braintrust_setup_otel_compat;

  if (typeof setupOtelCompat === "function") {
    log(config, "info", "Detected @braintrust/otel");
    setupOtelCompat();
    return true;
  }
  return false;
}

// In @braintrust/otel's src/index.ts
// Register the function on globalThis when the package is loaded
(globalThis as any).__braintrust_setup_otel_compat = setupOtelCompat;

// In index.ts
export function setupAutoInstrumentation(config?: Partial<Config>): void {
  // ...
  detectAndSetupOtel(finalConfig); // Called before registerHooks
  registerHooks(finalConfig);
  // ...
}
```

**Benefits:**

- Users get OpenTelemetry integration without extra configuration
- Works seamlessly when both packages are installed
- Gracefully degrades if @braintrust/otel is not installed
- Debug logging shows when OTel is detected and enabled

## Testing

### Unit Tests

```bash
pnpm test
```

### Integration Test

```bash
# Build first
pnpm build

# Test with OpenAI
BRAINTRUST_AUTO_INSTRUMENT=1 node --import ./dist/register.mjs test-integration.mjs
```

### Manual Testing

```bash
# Create test file
cat > manual-test.mjs << 'EOF'
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: 'test' });
console.log('Wrapped:', !!client[Symbol.for('braintrust.wrapped.openai')]);
EOF

# Run with auto-instrumentation
BRAINTRUST_AUTO_INSTRUMENT=1 node --import ./dist/register.mjs manual-test.mjs
```

## Troubleshooting

### "Module not found" errors

Make sure dependencies are installed:

```bash
pnpm install
```

### Import hooks not working

- Ensure you're using Node.js >= 18.19.0
- Check that register.ts is being loaded before app code
- Enable debug logging: `BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1`

### Wrappers not found

The main braintrust package must be loaded before auto-instrumentation.
register.ts handles this with: `import "braintrust"`

## Publishing

```bash
# 1. Update version in package.json
# 2. Build
pnpm build

# 3. Publish to npm
npm publish --access public
```

## Relationship to Main Package

```
@braintrust/auto-instrument (this package)
    ↓
    imports
    ↓
braintrust (main package)
    ↓
    registers global wrappers
    ↓
    provides wrapper implementations
```

Auto-instrument delegates to the main package for actual instrumentation logic.
