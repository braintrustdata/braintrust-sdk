# Braintrust Smoke Test Shared Package

Shared test utilities and suites for Braintrust SDK smoke tests across multiple runtime environments.

## Purpose

This package provides reusable test logic that can be imported and run in different JavaScript/TypeScript environments (Node.js, Deno, Cloudflare Workers, etc.) to verify the Braintrust SDK works correctly after build and bundling.

### Why Shared Tests?

1. **DRY Principle**: Write test logic once, run it everywhere
2. **Tree Shaking Coverage**: Different bundlers (webpack, esbuild, Deno's bundler) handle imports differently. Running the same tests across multiple environments helps catch export/import issues that only surface in specific bundlers.
3. **Consistency**: Ensure the SDK behaves identically across all supported environments
4. **Maintainability**: Add new test coverage in one place, automatically available everywhere

## Build Outputs

The package is built with `tsup` to produce both CommonJS and ESM formats:

- `dist/index.js` - CommonJS build
- `dist/index.mjs` - ESM build
- `dist/index.d.ts` / `dist/index.d.mts` - TypeScript declarations

This allows the same test code to be imported in both CJS and ESM environments.

## Structure

```
shared/
├── src/
│   ├── helpers/
│   │   ├── types.ts          # Shared type definitions
│   │   ├── test-state.ts     # Test environment setup/teardown
│   │   └── assertions.ts     # Assertion utilities
│   ├── suites/
│   │   ├── basic-logging.ts  # Basic logging test suite
│   │   └── ...               # Additional test suites
│   └── index.ts              # Main exports
├── dist/                     # Build output (gitignored)
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Building

```bash
cd smoke/shared
npm install
npm run build
```

This produces both CJS and ESM builds in the `dist/` directory.

## Usage

### In Node.js (CJS)

```typescript
// CommonJS environment
const {
  setupTestEnvironment,
  runBasicLoggingTests,
} = require("../../shared");


async function main() {
  const braintrust = require("braintrust");

  const adapters = await setupTestEnvironment({
    initLogger: braintrust.initLogger,
    testingExports: braintrust._exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "node",
  });

  const results = await runBasicLoggingTests(adapters, braintrust);
  // Handle results...
}
```

### In Node.js (ESM)

```typescript
// ESM environment (after enable-esm)
import {
  setupTestEnvironment,
  runBasicLoggingTests,
} from "../../shared";

async function main() {
  const braintrust = await import("braintrust");

  const adapters = await setupTestEnvironment({
    initLogger: braintrust.initLogger,
    testingExports: braintrust._exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "node-esm",
  });

  const results = await runBasicLoggingTests(adapters, braintrust);
  // Handle results...
}
```

### In Deno

```typescript
// Deno always uses ESM
import {
  setupTestEnvironment,
  runBasicLoggingTests,
} from "../../shared";

import * as braintrust from 'braintrust';

const adapters = await setupTestEnvironment({
  initLogger: braintrust.initLogger,
  testingExports: braintrust._exportsForTestingOnly,
  canUseFileSystem: true,
  canUseCLI: false,
  environment: "deno",
});

const results = await runBasicLoggingTests(adapters, braintrust);
```

### In Cloudflare Workers

```typescript
// Workers use ESM
import {
  setupTestEnvironment,
  runBasicLoggingTests,
} from "../../../shared";

import * as braintrust from "braintrust";

export default {
  async fetch(request: Request): Promise<Response> {
    const adapters = await setupTestEnvironment({
      initLogger: braintrust.initLogger,
      testingExports: braintrust._exportsForTestingOnly,
      canUseFileSystem: false, // No fs in Workers
      canUseCLI: false,
      environment: "cloudflare-worker",
    });

    const results = await runBasicLoggingTests(adapters, braintrust);
    return new Response(JSON.stringify(results));
  },
};
```

## Test Adapters

The `TestAdapters` interface allows test suites to adapt to different environment capabilities:

```typescript
interface TestAdapters {
  initLogger: Function; // Braintrust initLogger function
  testingExports: TestingExports; // _exportsForTestingOnly
  backgroundLogger: BackgroundLogger;
  canUseFileSystem: boolean; // Can tests read/write files?
  canUseCLI: boolean; // Can tests invoke CLI commands?
  environment: string; // Environment name for logging
}
```

Test suites check these flags and skip tests that aren't feasible in the current environment.

## Test Result Display

### Standardized Output Format

All scenarios now use a standardized display format via the `displayTestResults()` utility:

```typescript
import { displayTestResults } from "../../shared/dist/index.mjs";

// Display test results
displayTestResults({
  scenarioName: "My Scenario Test Results",
  results: testResults,
  verbose: false, // Optional: show full stack traces
});
```

This produces consistent output across all scenarios:

```
=== My Scenario Test Results ===

Tests: 18/20 passed
Expected failures: 2

✓ testCoreLoggingExports
✓ testDatasetExports
✗ testFailingFeature
  Error: Feature not implemented
  at Feature.test (feature.ts:42:11)
  at runTest (test.ts:10:5)
⊘ testNunjucksTemplate
  Expected failure: Nunjucks not supported in browser build
```

### Display Utilities

- `displayTestResults(options)` - Display results in standardized format
- `hasFailures(results)` - Check if there are any real failures (excluding xfail)
- `getFailureCount(results)` - Get count of real failures
- `getTestStats(results)` - Get summary statistics (total, passed, failed, xfail)

## Available Test Suites

### Basic Logging

Tests core logging functionality:

- `testBasicSpanLogging()` - Single span with input/output/expected
- `testMultipleSpans()` - Multiple sequential spans
- `testDirectLogging()` - Direct logger.log() if available
- `testJSONAttachment()` - JSON attachment logging
- `testAsyncLocalStorageTraced()` - ALS: traced() + startSpan() parent-child relationship
- `testNestedTraced()` - ALS: Nested traced() calls (3-level hierarchy)
- `testCurrentSpan()` - ALS: currentSpan() returns active span
- `runBasicLoggingTests()` - Runs all basic logging tests (including ALS if available)

**Async Local Storage (ALS) tests**: Verify parent-child span relationships work correctly.

- **Node.js/Deno**: Full ALS → verifies `span_parents` relationships
- **Browser/Workers**: No ALS → functions exist but relationships may not be automatic
- **Edge**: May have ALS → tests check if relationships work

**Error handling**: Tests don't pre-check if functions exist. If `traced`, `startSpan`, or `currentSpan` are undefined, the code naturally throws and the error is caught by the try/catch block, resulting in a test failure with the full stack trace.

### Adding New Test Suites

1. Create a new file in `src/suites/`:

```typescript
// src/suites/my-new-suite.ts
import type { TestAdapters, TestResult } from "../helpers/types";

export async function testMyFeature(
  adapters: TestAdapters,
): Promise<TestResult> {
  try {
    // Your test logic here
    return { success: true, testName: "testMyFeature" };
  } catch (error) {
    return { success: false, testName: "testMyFeature", error };
  }
}

export async function runMyNewSuiteTests(
  adapters: TestAdapters,
): Promise<TestResult[]> {
  return [
    await testMyFeature(adapters),
    // ... more tests
  ];
}
```

2. Export from `src/index.ts`:

```typescript
export { testMyFeature, runMyNewSuiteTests } from "./suites/my-new-suite";
```

3. Rebuild:

```bash
npm run build
```

4. Use in any test environment:

```typescript
import { runMyNewSuiteTests } from "../../shared/dist/index.mjs";
```

## Best Practices

### Write Environment-Agnostic Tests

Check adapter flags before using environment-specific features:

```typescript
export async function testDatasets(
  adapters: TestAdapters,
): Promise<TestResult> {
  if (!adapters.canUseFileSystem) {
    return {
      success: true,
      testName: "testDatasets",
      message: "Skipped (no filesystem access)",
    };
  }

  // Test logic that needs filesystem...
}
```

### Use Provided Assertions

Use the provided assertion helpers instead of environment-specific ones:

```typescript
import { assert, assertEqual, assertNotEmpty } from "../helpers/assertions";

// Good - works everywhere
assertEqual(actual, expected);

// Bad - only works in specific environments
expect(actual).toBe(expected); // Jest-specific
assertEquals(actual, expected); // Deno-specific
```

### Return TestResult

Always return a `TestResult` object with consistent structure:

```typescript
interface TestResult {
  success: boolean;
  testName: string;
  message?: string;
  error?: Error;
}
```

## Development Workflow

1. Make changes to test suites in `src/`
2. Run `npm run build` to rebuild
3. Test in target environment (e.g., Deno):
   ```bash
   cd ../tests/deno
   deno task test:shared
   ```
4. Verify tests pass in multiple environments

## Notes

- Tests use `_exportsForTestingOnly` to avoid hitting real APIs
- Each test suite should be independent and idempotent
- Clean up test state in `finally` blocks using `cleanupTestEnvironment()`
- The package is marked `private: true` - it's only for internal smoke tests
