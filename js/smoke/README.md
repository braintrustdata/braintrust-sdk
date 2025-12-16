# Braintrust JS SDK Smoke Tests

The smoke tests ensure that a freshly packed `braintrust` build installs
cleanly and can run basic user workflows. These tests run on any PR.

The tests utilize the newly built braintrust package to run first using the CommonJS (CJS) build file and then using the ECMAScript Module (ESM) build file.

The tests are written without the use of vitest in order to work in both CJS and ESM environments. Vitest is a testing framework that is ESM native and did not support running using CJS.

## Shared Test Package

To maximize test coverage while maintaining DRY principles, common test logic is now shared across environments via the `shared/` package. This package:

- Provides reusable test suites and helpers
- Builds to both CJS (`dist/index.js`) and ESM (`dist/index.mjs`) formats
- Allows the same test logic to run in Node.js, Deno, Cloudflare Workers, etc.
- Helps catch bundler-specific issues (webpack, esbuild, Deno's bundler handle imports differently)

See `shared/README.md` for detailed documentation on the shared test package.

## Repository Layout

</text>

<old_text line=14>

## Repository Layout

- `shared/` - Shared test package providing reusable test suites

  - Builds to both CJS (`dist/index.js`) and ESM (`dist/index.mjs`)
  - Contains test suites: `basic-logging`, `import-verification`
  - See `shared/README.md` for detailed documentation

- `tests/` - Test projects for different runtime environments
  - `span/` - Node.js CJS tests (uses shared suites)
  - `span-jest/` - Jest framework tests (uses shared suites)
  - `deno/` - Deno environment tests (uses shared suites)
  - `cloudflare-worker/` - Cloudflare Workers tests (uses shared suites)
  - `nextjs-instrumentation/` - Next.js tests (Edge + Node.js runtimes via API routes)
  - `otel-v1/` - OpenTelemetry v1 ingestion test (specialized)

## Running Tests

### Build the shared package first

The shared test package must be built before running any tests:

```bash
cd shared
npm install
npm run build
```

### Run tests in specific environments

All environments now support shared test suites via `test:shared` scripts:

```bash
# Node.js CJS tests
cd tests/span
npm run test:shared

# Jest tests
cd tests/span-jest
npm run test:shared

# Deno tests
cd tests/deno
deno task test:shared       # Shared test suites
deno task test              # Original simple test

# Cloudflare Worker tests
cd tests/cloudflare-worker
npm test                    # Runs shared suites via HTTP endpoint

# Next.js tests
cd tests/nextjs-instrumentation
npm run test:shared         # Runs shared suites in Edge + Node.js runtimes
npm run build               # Build-time verification (webpack bundling)
```

### Legacy Tests

Original standalone tests still exist and can be run:

```bash
# Node.js span test (original)
cd tests/span
npm start

# Deno span test (original)
cd tests/deno
deno task test
```

## Test Coverage

The shared test suites currently include:

### Import Verification Tests (13 tests)

- Core logging exports (initLogger, wrapLogger, etc.)
- Dataset exports (initDataset, Dataset)
- Prompt exports (loadPrompt, Prompt)
- Experiment exports (Experiment, init)
- Eval exports (Eval, ReporterDef, EvalCase)
- Tracing exports (traced, wrapTraced, currentSpan, etc.)
- Client wrappers (wrapOpenAI, wrapAnthropic, etc.)
- Utility exports (getCurrentUnixTimestamp, JSONAttachment, etc.)
- Function, Framework, ID generator, Testing, and State management exports

### Functional Tests (3 tests)

- Basic span logging (single span with input/output/expected)
- Multiple spans (sequential span creation)
- Direct logging (logger.log() if available)

**Total: 16+ tests running in each environment**

## Environment Status

| Environment             | Shared Tests   | Import Verification | Functional Tests |
| ----------------------- | -------------- | ------------------- | ---------------- |
| Node.js CJS             | ✅             | ✅                  | ✅               |
| Jest                    | ✅             | ✅                  | ✅               |
| Deno                    | ✅             | ✅                  | ✅               |
| Cloudflare Workers      | ✅             | ✅                  | ✅               |
| Next.js Edge Runtime    | ✅             | ✅                  | ✅               |
| Next.js Node.js Runtime | ✅             | ✅                  | ✅               |
| OTEL v1                 | ⚪ Specialized | N/A                 | ⚪ Custom        |

## Notes

- There were some caching issues with pnpm, so tests use npm ci and package-lock.json files
- Tests use `_exportsForTestingOnly` to avoid hitting real Braintrust APIs
- The shared package allows adding test coverage once and automatically running it in all environments
- Import verification tests help catch tree-shaking issues across different bundlers
- Each environment runs the same test logic, ensuring consistent behavior
