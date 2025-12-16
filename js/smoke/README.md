# Braintrust JS SDK Smoke Tests

The smoke tests ensure that a freshly packed `braintrust` build installs
cleanly and can run basic user workflows. These tests run on any PR.

The tests utilize the newly built braintrust package to run first using the CommonJS (CJS) build file and then using the ECMAScript Module (ESM) build file.

The tests are written without the use of vitest in order to work in both CJS and ESM environments. Vitest is a testing framework that is ESM native and did not support running using CJS.

## Standardized Test Infrastructure

The smoke test suite follows **pure "convention over configuration"**:

- **Auto-discovery** - Any `tests/*/` directory with `package.json` is a test
- **Universal interface** - All tests run via `npm test`
- **Zero registration** - Just create a directory, CI picks it up automatically
- **Master runner** - `run-tests.sh` discovers and runs tests automatically

### Key Files

- `run-tests.sh` - Master test runner with auto-discovery
- `tests/*/package.json` - Standard `npm test` script
- `shared/` - Reusable test suites (see below)

### Convention

```
tests/
├── my-test/
│   ├── package.json    # Must have "test" script
│   └── run-test.js     # Test implementation
└── another-test/
    ├── package.json    # "test": "npm test" or "deno task test" etc
    └── ...
```

**That's it!** Test name = directory name. All tests run via `npm test`.

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

## CI Integration

### SDK Submodule CI

The smoke tests run automatically in the **SDK submodule's CI** (`sdk/.github/workflows/js.yaml`) that **builds the SDK from source** and tests against the actual build artifacts.

#### Workflow: `sdk/.github/workflows/js.yaml`

Runs on:

- Pull requests to SDK repository
- Pushes to `main` branch in SDK repository

**Build stage:**

1. **Builds the SDK** from source (`js/`)
   - Runs `npm ci && npm run build`
   - Packs into tarball: `npm pack --pack-destination artifacts`
2. **Uploads artifacts** for test jobs to download

**Test stages** (parallel jobs):

Each smoke test runs in its own job:

- `smoke-tests-node` - Tests `span` and `otel-v1`
- `smoke-tests-jest` - Tests `span-jest`
- `smoke-tests-nextjs` - Tests `nextjs-instrumentation`
- `smoke-tests-cloudflare` - Tests `cloudflare-worker`
- `smoke-tests-deno` - Tests `deno`

**Each job:**

1. Downloads SDK build artifacts
2. Installs SDK into test directory via `install-build.ts`
3. Builds shared test package
4. Runs test via `./run-tests.sh <test-name>`

**Workflow visualization:**

```
┌─────────────────────────────────────────────────────────┐
│  SDK CI: sdk/.github/workflows/js.yaml                  │
└─────────────────────────────────────────────────────────┘
                        ↓
        ┌───────────────────────────┐
        │  Build Job                │
        │  1. Build SDK from source │
        │     js/                   │
        │  2. Pack into tarball     │
        │  3. Upload artifacts      │
        └───────────┬───────────────┘
                    ↓
            ┌───────┴────────┬─────────────┬──────────────┐
            ↓                ↓             ↓              ↓
    ┌───────────────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐
    │ smoke-tests-  │ │ smoke-     │ │ smoke-  │ │ smoke-   │
    │ node          │ │ tests-jest │ │ tests-  │ │ tests-   │
    │ (span,otel-v1)│ │ (span-jest)│ │ nextjs  │ │ deno     │
    └───────┬───────┘ └─────┬──────┘ └────┬────┘ └────┬─────┘
            │               │             │           │
            │   For each test job:        │           │
            │   1. Download artifacts     │           │
            │   2. Install SDK            │           │
            │   3. Build shared package   │           │
            │   4. ./run-tests.sh <name>  │           │
            │                             │           │
            └─────────────┬───────────────┴───────────┘
                          ↓
                  ✅ Pass or ❌ Fail
```

**Key benefit**: Tests run against the **actual build** from the PR, not the npm registry version.

### How Individual Test Jobs Work

Example from `sdk/.github/workflows/js.yaml`:

```yaml
smoke-tests-cloudflare:
  needs: build
  runs-on: ubuntu-latest

  steps:
    - name: Download build artifact
      uses: actions/download-artifact@v4
      with:
        name: ${{ needs.build.outputs.artifact-name }}
        path: js/artifacts

    - name: Install dependencies and local build
      working-directory: js/smoke/tests/cloudflare-worker
      run: |
        npm ci
        npx tsx ../../install-build.ts ../../../artifacts braintrust

    - name: Build shared test package
      working-directory: js/smoke/shared
      run: |
        npm ci
        npm run build

    - name: Run Cloudflare Worker smoke test
      working-directory: js/smoke
      run: |
        ./run-tests.sh cloudflare-worker
```

**Pattern**: Build SDK → Download artifacts → Install in test → Build shared → Run specific test

### Running Multiple Tests in One Job

```yaml
- name: Run multiple smoke tests
  working-directory: js/smoke
  run: ./run-tests.sh span cloudflare-worker deno
```

Or run all tests:

```yaml
- name: Run all smoke tests
  working-directory: js/smoke
  run: ./run-tests.sh
```

### Test Discovery and Build Process

Tests are **automatically discovered** by scanning `tests/*/`. To add a new test:

1. Create `tests/my-test/` directory
2. Add `package.json` with `"test"` script
3. Done!

CI will automatically:

- Build the SDK from source
- Install the build artifact into your test directory
- Run your test against the actual build

**No registration or configuration needed!**

### What Gets Tested

The smoke tests verify the **actual SDK build** (not the published npm package):

1. **Build**: SDK is built from source in `sdk/js/`
2. **Package**: Built SDK is packed into tarball (`.tgz`)
3. **Install**: Tarball is installed into each test's `node_modules/`
4. **Test**: Tests import and verify the **built** SDK

This ensures that:

- ✅ The build process works correctly
- ✅ All exports are present and functional
- ✅ No tree-shaking issues or missing dependencies
- ✅ SDK works in diverse runtime environments

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

## Adding New Tests

Adding a new smoke test is trivial:

1. **Create directory**: `mkdir tests/my-test`
2. **Add package.json**:
   ```json
   {
     "name": "braintrust-my-test",
     "scripts": {
       "test": "node run-test.js"
     },
     "dependencies": {
       "braintrust": "latest"
     }
   }
   ```
3. **Write test**: Create `run-test.js` (can use shared test suites)
4. **Run it**: `./run-tests.sh my-test`

Done! CI automatically discovers and runs it.

## Convention Over Configuration

Tests are **auto-discovered** by scanning `tests/*/` for directories with `package.json`.

**Rules:**

- Test name = directory name
- All tests run via: `npm test`
- For Deno: `package.json` calls `deno task test`
- For Bun: `package.json` calls `bun test`

**Example (Deno test):**

```json
{
  "scripts": {
    "test": "deno task test"
  }
}
```

**Benefits:**

- Zero registration needed
- Pure convention
- Add directory → CI runs it
- Can't forget to register

## Notes

- There were some caching issues with pnpm, so tests use npm ci and package-lock.json files
- Tests use `_exportsForTestingOnly` to avoid hitting real Braintrust APIs
- The shared package allows adding test coverage once and automatically running it in all environments
- Import verification tests help catch tree-shaking issues across different bundlers
- Each environment runs the same test logic, ensuring consistent behavior
- All tests use `npm test` for consistency (universal interface)
- Tests are auto-discovered from `tests/*/` directories with `package.json`
