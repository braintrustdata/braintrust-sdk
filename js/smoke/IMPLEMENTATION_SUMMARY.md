# Smoke Test Shared Package - Implementation Summary

## What We Built

A shared test utilities package (`smoke/shared/`) that provides reusable test suites and helpers for Braintrust SDK smoke tests across multiple runtime environments.

### Key Components

1. **Shared Package** (`smoke/shared/`)

   - Built with `tsup` to produce both CJS and ESM outputs
   - `dist/index.js` - CommonJS build
   - `dist/index.mjs` - ESM build
   - TypeScript declarations for both formats

2. **Test Infrastructure**

   - `src/helpers/types.ts` - Shared type definitions
   - `src/helpers/test-state.ts` - Test environment setup/teardown
   - `src/helpers/assertions.ts` - Environment-agnostic assertions

3. **Test Suites**

   - `src/suites/basic-logging.ts` - Tests for core logging functionality
     - `testBasicSpanLogging()` - Single span with input/output/expected
     - `testMultipleSpans()` - Multiple sequential spans
     - `testDirectLogging()` - Direct logger.log() if available

4. **Adapted Deno Test**
   - `tests/deno/shared_suite_test.ts` - Deno test using shared suites
   - Successfully runs the shared test logic in Deno environment
   - Demonstrates ESM import of shared package

## Why We Built This

### Primary Goals

1. **DRY Principle**: Write test logic once, run it everywhere
2. **Tree Shaking Coverage**: Different bundlers (webpack, esbuild, Deno's bundler, etc.) handle imports/exports differently. Running the same test code through multiple bundlers helps catch:
   - Missing exports that only surface in specific bundlers
   - Tree shaking issues
   - Import/export edge cases
3. **Consistency**: Ensure SDK behaves identically across all supported environments
4. **Maintainability**: Add test coverage in one place, automatically available everywhere

### The Problem This Solves

Previously, each smoke test environment had its own test code. This meant:

- Duplicated test logic across environments
- When adding new test coverage, had to manually port to each environment
- Different environments tested different things
- Hard to ensure comprehensive coverage

The `nextjs-instrumentation` test proved that build-time issues exist that runtime tests don't catch. By running shared test logic through multiple bundlers, we maximize the chance of catching these issues.

## Current Status

### ✅ Completed

1. **Shared package created and building successfully**

   - Produces both CJS and ESM outputs
   - TypeScript declarations included
   - Clean build with no errors

2. **Basic logging test suite implemented**

   - Three test functions covering core logging features
   - Uses environment-agnostic assertions
   - Returns structured TestResult objects

3. **Deno integration complete**

   - `shared_suite_test.ts` successfully imports and runs shared tests
   - All three tests passing in Deno environment
   - Original `span_test.ts` still works (no breaking changes)

4. **Documentation written**
   - `shared/README.md` - Complete guide to using shared package
   - Updated `smoke/README.md` to reference shared package
   - Usage examples for Node.js (CJS/ESM), Deno, and Cloudflare Workers

### 🎉 Proof of Concept Success

The Deno test successfully demonstrates:

- ✅ Shared test code builds to both CJS and ESM
- ✅ ESM build imports correctly in Deno
- ✅ Test logic executes identically to standalone version
- ✅ No breaking changes to existing tests
- ✅ Pattern is viable for other environments

## How It Works

### Build Process

```bash
cd smoke/shared
npm run build  # tsup builds both CJS and ESM
```

### Import in Different Environments

**Node.js CJS:**

```javascript
const { runBasicLoggingTests } = require("../../shared/dist/index.js");
```

**Node.js ESM / Deno / Cloudflare Workers:**

```javascript
import { runBasicLoggingTests } from "../../shared/dist/index.mjs";
```

### Test Execution Flow

1. Environment-specific test file imports shared suites
2. Test sets up environment (using `setupTestEnvironment()`)
3. Test passes adapters to shared suite functions
4. Shared suites check adapter flags (e.g., `canUseFileSystem`) and adapt
5. Tests run and return structured results
6. Environment cleans up (using `cleanupTestEnvironment()`)

### Adapter Pattern

Tests use a `TestAdapters` interface to adapt to environment capabilities:

```typescript
interface TestAdapters {
  initLogger: Function;
  testingExports: TestingExports;
  backgroundLogger: BackgroundLogger;
  canUseFileSystem: boolean; // Can read/write files?
  canUseCLI: boolean; // Can invoke CLI?
  environment: string; // Environment name
}
```

This allows test suites to skip tests that aren't feasible in certain environments.

## Next Steps

### Immediate Priorities

1. **Adapt more environments**

   - [ ] Node.js `span/` test (CJS mode)
   - [ ] Node.js `span/` test (ESM mode after enable-esm)
   - [ ] Cloudflare Worker test
   - [ ] Jest test (`span-jest/`)
   - [ ] Next.js instrumentation (import-only, no execution)

2. **Add more test suites**
   - [ ] Advanced tracing (wrapTraced, currentSpan, updateSpan)
   - [ ] Wrapped clients (wrapOpenAI with mocked client)
   - [ ] Datasets (initDataset, insert, iterate, filter)
   - [ ] Prompts (create, load, build with parameters)
   - [ ] Evals (Eval() function, scorers, CLI execution)

### Suggested Test Coverage

Based on the SDK documentation review, these are popular SDK operations to test:

**Logging & Tracing:**

- ✅ Basic span logging (DONE)
- ✅ Multiple spans (DONE)
- [ ] Nested spans (parent-child relationships)
- [ ] `@traced` decorator / `wrapTraced()`
- [ ] `currentSpan()` access
- [ ] `updateSpan()` modification
- [ ] `JSONAttachment` for structured data
- [ ] Wrapped AI clients (wrapOpenAI, wrapAnthropic)

**Datasets:**

- [ ] `initDataset()` create/retrieve
- [ ] Insert records
- [ ] Iterate over dataset
- [ ] Filter with `_internal_btql`
- [ ] Dataset structure (input/expected/metadata)

**Prompts:**

- [ ] `loadPrompt()` / `load_prompt()`
- [ ] `prompt.build()` with mustache templates
- [ ] `project.prompts.create()` programmatic creation
- [ ] Version pinning

**Evaluations:**

- [ ] `Eval()` function
- [ ] Custom scorers
- [ ] Built-in scorers (Levenshtein, etc.)
- [ ] CLI execution (`npx braintrust eval`)
- [ ] Experiment creation and results

**Advanced:**

- [ ] OTEL integration (already partially covered by `otel-v1/`)
- [ ] Error handling in spans
- [ ] Metadata and attributes
- [ ] Online scoring

## Testing the Implementation

### Test the Shared Package Build

```bash
cd sdk/js/smoke/shared
npm install
npm run build
ls -la dist/  # Should see index.js, index.mjs, and .d.ts files
```

### Test Deno Integration

```bash
cd sdk/js/smoke/tests/deno

# Extract Braintrust package (if not already done)
tar -xzf ../../../artifacts/braintrust-1.0.2.tgz -C .

# Run original test (ensure no breakage)
BRAINTRUST_BUILD_DIR="$(pwd)/package/dist/browser.mjs" deno task test

# Run new shared suite test
BRAINTRUST_BUILD_DIR="$(pwd)/package/dist/browser.mjs" deno task test:shared
```

Expected output from shared suite test:

```
✅ All shared test suites passed:
  ✓ testBasicSpanLogging: Basic span logging test passed
  ✓ testMultipleSpans: Multiple spans test passed (2 events captured)
  ✓ testDirectLogging: Direct logging test passed
```

## Benefits Realized

1. **Code Reuse**: Basic logging tests written once, now available in all environments
2. **Consistency**: Same test logic runs identically everywhere
3. **Maintainability**: Adding new tests is now a single-file change
4. **Bundler Coverage**: Deno's bundler now exercises the SDK imports
5. **Type Safety**: TypeScript types shared across all tests
6. **No Breaking Changes**: Existing tests continue to work

## Architecture Decisions

### Why tsup?

- Already used by main SDK build
- Simple configuration
- Excellent CJS/ESM dual build support
- Fast builds
- Good TypeScript support

### Why Separate Package?

- Clear separation of concerns
- Independent versioning (if needed)
- Can be built once, used many times
- Easy to add to CI/CD pipeline

### Why TestAdapters Pattern?

- Allows test suites to be environment-aware
- Tests can gracefully skip unsupported features
- Single codebase supports vastly different capabilities
- Clear contract between test suite and environment

## Lessons Learned

1. **TypeScript strictness helps**: Caught unused imports during build
2. **Deno lockfile versioning**: Had to regenerate for compatibility
3. **Import paths matter**: Must use exact paths (`.mjs` vs `.js`) for correct format
4. **Testing infrastructure is valuable**: `_exportsForTestingOnly` makes this possible

## Conclusion

This implementation successfully proves the shared test package pattern is viable for Braintrust SDK smoke tests. The Deno integration demonstrates that:

- Test code can be shared across environments
- Both CJS and ESM builds work correctly
- The pattern is maintainable and extensible
- Existing tests aren't disrupted

The foundation is now in place to expand coverage to other environments and add comprehensive test suites for all major SDK features.
