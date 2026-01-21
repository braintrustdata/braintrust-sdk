# Braintrust JS SDK Smoke Tests v2

Smoke test infrastructure verifying SDK installation across different runtimes and integrations.

## Quick Reference

```bash
make test              # Run all scenarios
make test otel-v1      # Run specific scenario
make list              # List available scenarios
```

## Output Standardization (REQUIRED)

**ALL test files MUST use `displayTestResults()` from the shared package:**

```typescript
import {
  displayTestResults,
  hasFailures,
  getFailureCount,
} from "../../shared/dist/index.mjs";

// Run your tests
const results = [...importResults, ...functionalResults];

// Display with standardized format
displayTestResults({
  scenarioName: "My Scenario Test Results",
  results,
});

// Check for failures
if (hasFailures(results)) {
  process.exit(1);
}
```

**Keep logging minimal:** No status messages, banners, or summaries. Let `displayTestResults()` do the talking.

## Creating a New Scenario

### Requirements

- [ ] Makefile with `setup` and `test` targets
- [ ] Environment spec (mise.toml, deno.json, etc.)
- [ ] Dependencies declared (package.json, deno.json, etc.)
- [ ] README.md explaining design decisions (15-25 lines)
- [ ] .gitignore (ignore artifacts, track lock files)
- [ ] **Tests use `displayTestResults()`**
- [ ] **Minimal logging** (errors only)
- [ ] **POSIX shell syntax** (`[ ]` not `[[ ]]`)

### Patterns

**Node.js + npm:** Use tarball paths in package.json. See `scenarios/otel-v1/`.

**Deno:** Use workspace links via `deno.json`. See `scenarios/deno-node/`.

**Multi-test:** Each test uses `displayTestResults()`. Makefile runs all tests (don't fail early), then exits with failure if any failed. See `scenarios/otel-v1/` for example.

### Example Test File

```typescript
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runImportVerificationTests,
  runBasicLoggingTests,
  displayTestResults,
  hasFailures,
} from "../../shared";

import { initLogger, _exportsForTestingOnly } from "braintrust";

async function runTests() {
  const braintrust = await import("braintrust");

  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "my-scenario",
  });

  try {
    const importResults = await runImportVerificationTests(braintrust, {
      checkBuildResolution: true, 
      expectedBuild: "node", // depends on scenario
      expectedFormat: "esm", // depends on scenario
    });
    const functionalResults = await runBasicLoggingTests(adapters, braintrust);
    const results = [...importResults, ...functionalResults];

    displayTestResults({
      scenarioName: "My Scenario Test Results",
      results,
    });

    if (hasFailures(results)) {
      process.exit(1);
    }
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### Example Makefile (Multiple Tests)

**IMPORTANT:** Run all tests even if one fails. Don't exit early.

```makefile
test: setup
	@echo "==> Running tests"
	@FAILED=0; \
	npx tsx tests/test1.test.ts || FAILED=1; \
	npx tsx tests/test2.test.ts || FAILED=1; \
	npx tsx tests/test3.test.ts || FAILED=1; \
	exit $$FAILED
```

This ensures all tests run and display their results, but the suite still fails if any test failed.

## Design Principles

### Well-Known Tarball Paths

Use version-agnostic paths: `braintrust-latest.tgz` not `braintrust-2.0.2.tgz`. Prevents package.json from changing on version bumps.

### No Workarounds

Never use `--legacy-peer-deps`, `--no-check`, `--ignore-errors`, or mocks. Smoke tests must expose issues users will encounter.

### No Defensive Checks in Tests

Don't conditionally check if functions exist before calling them. Let natural JavaScript errors occur and get caught by try/catch blocks. This provides:

- **Better error messages**: Stack traces show exactly where/what failed
- **Cleaner test code**: No redundant existence checks
- **Real-world behavior**: Tests fail the same way user code would fail

```typescript
// ❌ Bad - defensive checks hide the real error
if (!braintrust.traced) {
  return { status: "fail", error: { message: "traced missing" } };
}

// ✓ Good - let it throw naturally
const traced = braintrust.traced;
await traced(
  () => {
    /* ... */
  },
  { name: "test" },
); // Throws if undefined
```

### Build Before Install

Build all artifacts BEFORE installing dependencies that reference them. Prevents "ENOENT" errors.

### Track Lock Files

Commit `package-lock.json` and `deno.lock`. Changes signal new dependencies, version conflicts, or packaging issues.

### Makefiles Are the Source of Truth

No npm scripts in package.json. All commands in Makefile. Single clear path to run tests.

## Troubleshooting

### "ENOENT: no such file or directory" for tarball

Ensure Makefile builds packages BEFORE `npm install`.

### "Unsupported URL Type 'workspace:'"

Use `pnpm pack` (not `npm pack`) for packages with `workspace:*` dependencies.

### package.json gets modified by npm

Use well-known tarball paths: `braintrust-latest.tgz` not version-specific paths.

### Tests can't find braintrust imports

Verify tarball paths in package.json are correct relative to scenario directory.

## Directory Structure

```
smoke/
├── shared/          # Cross-scenario test utilities
├── scenarios/       # Individual test scenarios
│   ├── otel-v1/
│   │   ├── tests/         # Test files
│   │   ├── Makefile       # setup + test targets
│   │   ├── mise.toml      # Environment definition
│   │   ├── package.json   # Dependencies only (no scripts)
│   │   └── README.md
│   └── deno-node/
├── Makefile         # Top-level orchestration (auto-discovery)
└── README.md        # This file
```

## How Auto-Discovery Works

The top-level Makefile finds scenarios:

```makefile
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d -exec test -f {}/Makefile \; -print | sed 's|scenarios/||')
```

Any folder in `scenarios/` with a `Makefile` is automatically discovered. No registration needed.

## Shared Test Suites

The `shared/` package provides reusable test suites that run across all scenarios:

- **Import Verification** - Verifies SDK exports exist, prevents tree-shaking issues
- **Basic Logging** - Core logging functionality including Async Local Storage (ALS) tests
- **Prompt Templating** - Mustache (all environments) and Nunjucks (Node.js)
- **Eval Smoke Test** - Basic eval functionality

See `shared/README.md` for complete test suite documentation, individual test functions, and implementation details.

## Reference Scenarios

- **Node.js + OTEL:** `scenarios/otel-v1/`
- **Deno:** `scenarios/deno-node/`, `scenarios/deno-browser/`
- **Cloudflare Workers:** `scenarios/cloudflare-worker-*/`
- **Multi-test:** `scenarios/cloudflare-vite-hono/`
- **Next.js:** `scenarios/nextjs-instrumentation/`
