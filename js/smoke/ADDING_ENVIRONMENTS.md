# Adding Shared Tests to New Environments

This guide walks you through adapting the shared test suites to run in a new runtime environment.

## Quick Start Checklist

- [ ] Determine environment capabilities (filesystem, CLI, etc.)
- [ ] Choose correct import format (CJS vs ESM)
- [ ] Create test file that imports shared suites
- [ ] Set up test environment using `setupTestEnvironment()`
- [ ] Run shared test suites
- [ ] Clean up using `cleanupTestEnvironment()`
- [ ] Add test script to package.json or config
- [ ] Verify tests pass

## Step-by-Step Guide

### Step 1: Analyze Environment Capabilities

Determine what your environment can and cannot do:

```typescript
// Example capability analysis
const capabilities = {
  canUseFileSystem: true, // Can read/write files?
  canUseCLI: false, // Can invoke braintrust CLI?
  moduleFormat: "esm", // "cjs" or "esm"?
  environment: "my-env", // Name for logging
};
```

**Common environments:**

- Node.js CJS: `canUseFileSystem: true, canUseCLI: true, moduleFormat: "cjs"`
- Node.js ESM: `canUseFileSystem: true, canUseCLI: true, moduleFormat: "esm"`
- Deno: `canUseFileSystem: true, canUseCLI: false, moduleFormat: "esm"`
- Cloudflare Workers: `canUseFileSystem: false, canUseCLI: false, moduleFormat: "esm"`
- Jest: `canUseFileSystem: true, canUseCLI: true, moduleFormat: "cjs"`
- Next.js: `canUseFileSystem: false, canUseCLI: false, moduleFormat: "esm"` (import only)

### Step 2: Create Test File

Create a new test file in your environment's test directory.

#### For ESM Environments (Deno, Cloudflare Workers, Node ESM)

```typescript
// tests/my-env/shared_suite_test.ts
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  type TestResult,
} from "../../shared/dist/index.mjs"; // Use .mjs for ESM

export async function runSharedTestSuites() {
  // Import Braintrust (method varies by environment)
  const { initLogger, _exportsForTestingOnly } = await import("braintrust");

  // Setup test environment
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true, // Set based on your environment
    canUseCLI: false, // Set based on your environment
    environment: "my-env",
  });

  try {
    // Run test suites
    const results = await runBasicLoggingTests(adapters);

    // Handle results
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.error("Test failures:");
      for (const failure of failures) {
        console.error(`  ❌ ${failure.testName}: ${failure.error?.message}`);
      }
      throw new Error(`${failures.length} test(s) failed`);
    }

    console.log("✅ All tests passed:");
    for (const result of results) {
      console.log(`  ✓ ${result.testName}: ${result.message}`);
    }

    return results;
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

// Environment-specific test runner (e.g., Deno.test, describe(), etc.)
// See examples below for each environment
```

#### For CJS Environments (Node.js CJS, Jest)

```javascript
// tests/my-env/shared_suite_test.js
const {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
} = require("../../shared/dist/index.js"); // Use .js for CJS

async function runSharedTestSuites() {
  const { initLogger, _exportsForTestingOnly } = require("braintrust");

  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "my-env",
  });

  try {
    const results = await runBasicLoggingTests(adapters);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.error("Test failures:");
      for (const failure of failures) {
        console.error(`  ❌ ${failure.testName}: ${failure.error?.message}`);
      }
      throw new Error(`${failures.length} test(s) failed`);
    }

    console.log("✅ All tests passed:");
    for (const result of results) {
      console.log(`  ✓ ${result.testName}: ${result.message}`);
    }

    return results;
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

module.exports = { runSharedTestSuites };
```

### Step 3: Add Environment-Specific Test Runner

Choose the pattern that matches your environment's test framework:

#### Deno

```typescript
// Use Deno.test()
Deno.test("Run shared test suites", async () => {
  const results = await runSharedTestSuites();

  // Deno assertions
  assertEquals(
    results.filter((r) => !r.success).length,
    0,
    "All tests should pass",
  );
});
```

#### Jest

```javascript
// Use Jest's test()
test("shared test suites pass", async () => {
  const results = await runSharedTestSuites();

  // Jest assertions
  const failures = results.filter((r) => !r.success);
  expect(failures).toHaveLength(0);
});
```

#### Node.js (standalone)

```javascript
// Just call the function
async function main() {
  try {
    await runSharedTestSuites();
    console.log("All tests passed!");
    process.exit(0);
  } catch (error) {
    console.error("Tests failed:", error);
    process.exit(1);
  }
}

main();
```

#### Cloudflare Workers

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/test") {
      try {
        const results = await runSharedTestSuites();
        return new Response(JSON.stringify({ success: true, results }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    return new Response("Use /test to run tests");
  },
};
```

### Step 4: Add Test Script

Add a test script to your environment's config file.

#### package.json (Node.js, Jest)

```json
{
  "scripts": {
    "test:shared": "node shared_suite_test.js"
  }
}
```

#### deno.json (Deno)

```json
{
  "tasks": {
    "test:shared": "deno test --allow-env --allow-read --allow-net shared_suite_test.ts"
  }
}
```

### Step 5: Handle Braintrust Import

Different environments import Braintrust differently:

#### Node.js CJS

```javascript
const { initLogger, _exportsForTestingOnly } = require("braintrust");
```

#### Node.js ESM

```javascript
import { initLogger, _exportsForTestingOnly } from "braintrust";
```

#### Deno (with build directory)

```typescript
const buildDir = Deno.env.get("BRAINTRUST_BUILD_DIR");
const { initLogger, _exportsForTestingOnly } = await import(
  `file://${buildDir}`
);
```

#### Cloudflare Workers

```typescript
import { initLogger, _exportsForTestingOnly } from "braintrust";
```

### Step 6: Test Your Implementation

1. **Build the shared package** (if not already done):

   ```bash
   cd smoke/shared
   npm run build
   ```

2. **Run your test**:

   ```bash
   cd tests/my-env
   npm test  # or deno task test, etc.
   ```

3. **Verify output**:
   - All tests should pass
   - You should see test names and success messages
   - No errors or exceptions

## Environment-Specific Examples

### Complete Example: Node.js CJS

```javascript
// tests/span/shared_suite_test.js
const {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
} = require("../../shared/dist/index.js");

async function main() {
  const { initLogger, _exportsForTestingOnly } = require("braintrust");

  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "node-cjs",
  });

  try {
    const results = await runBasicLoggingTests(adapters);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.error("❌ Test failures:");
      for (const failure of failures) {
        console.error(`  ${failure.testName}: ${failure.error?.message}`);
      }
      process.exit(1);
    }

    console.log("✅ All tests passed:");
    for (const result of results) {
      console.log(`  ${result.testName}: ${result.message}`);
    }
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### Complete Example: Next.js (Import Only)

For Next.js, we only want to verify imports work (tree shaking test):

```typescript
// tests/nextjs-instrumentation/instrumentation.ts
import {
  setupTestEnvironment,
  runBasicLoggingTests,
  type TestAdapters,
  type TestResult,
} from "../../shared/dist/index.mjs";

export async function register() {
  // Just importing is enough to test tree shaking
  // We can also verify types are correct
  const _testAdapter: TestAdapters | undefined = undefined;
  const _testResult: TestResult | undefined = undefined;

  console.log("Next.js instrumentation: Shared test imports successful");

  // Note: We don't actually run tests in Next.js build,
  // we just want to ensure webpack doesn't choke on imports
}
```

## Common Patterns

### Pattern 1: Conditional Test Running

```typescript
// Run different suites based on environment capabilities
const results: TestResult[] = [];

results.push(...(await runBasicLoggingTests(adapters)));

if (adapters.canUseFileSystem) {
  results.push(...(await runDatasetTests(adapters)));
}

if (adapters.canUseCLI) {
  results.push(...(await runEvalTests(adapters)));
}
```

### Pattern 2: Custom Assertions

```typescript
// Add environment-specific assertion handling
import { assert as denoAssert } from "jsr:@std/assert";

function assertResults(results: TestResult[]) {
  const failures = results.filter((r) => !r.success);

  // Use environment's native assertions
  denoAssert(failures.length === 0, `${failures.length} tests failed`);
}
```

### Pattern 3: Result Formatting

```typescript
// Format results for your environment
function formatResults(results: TestResult[]): string {
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return `Tests: ${passed} passed, ${failed} failed, ${results.length} total`;
}
```

## Troubleshooting

### Issue: "Cannot find module"

**Problem**: Import paths are wrong

**Solution**:

- CJS environments use `require("../../shared/dist/index.js")`
- ESM environments use `import ... from "../../shared/dist/index.mjs"`

### Issue: "Module format mismatch"

**Problem**: Using ESM import in CJS environment or vice versa

**Solution**: Check your package.json `type` field:

- `"type": "module"` → Use ESM (`.mjs`)
- No type field or `"type": "commonjs"` → Use CJS (`.js`)

### Issue: Tests fail with "No events captured"

**Problem**: `_exportsForTestingOnly` not set up correctly

**Solution**: Ensure you call:

```typescript
testingExports.setInitialTestState();
await testingExports.simulateLoginForTests();
```

### Issue: TypeScript errors on imports

**Problem**: Type definitions not found

**Solution**: Make sure shared package was built with types:

```bash
cd shared && npm run build
ls dist/*.d.ts  # Should exist
```

## Next Steps

After getting shared tests working in your environment:

1. **Add more test suites**: Import additional suites as they're created
2. **Document environment quirks**: Add notes to this file
3. **CI Integration**: Add your test to the CI pipeline
4. **Report results**: Consider structured output for CI

## Contributing

When you add a new environment:

1. Follow this guide to implement tests
2. Add your environment to the list in Step 1
3. Add a complete example to this document
4. Update the main README.md with your environment
5. Submit a PR with your changes

Your contribution helps ensure Braintrust works reliably everywhere!
