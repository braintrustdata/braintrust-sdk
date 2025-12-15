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

- `scripts/` - has the scripts that run during the build process to
- `tests/` - Contains test projects

  - `spans/` - a simple span being sent to braintrust
  - `otel-v1/` - OpenTelemetry v1 ingestion for sending spans to braintrust
  - `deno/` - the simple span test re-written for the deno environment

- `scripts/` - has the scripts that run during the build process to
- `tests/` - Contains test projects
  - `spans/` - a simple span being sent to braintrust
  - `otel-v1/` - OpenTelemetry v1 ingestion for sending spans to braintrust
  - `deno/` - the simple span test re-written for the deno environment

## Running Tests

### Build the shared package first

```bash
cd shared
npm install
npm run build
```

### Run tests in specific environments

Each test directory has its own instructions, but generally:

```bash
# Deno tests
cd tests/deno
deno task test              # Original simple test
deno task test:shared       # Shared test suites

# Node.js tests
cd tests/span
npm start                   # CJS mode
npm run enable-esm          # Switch to ESM
npm start                   # ESM mode
```

## Notes

- There were some caching issues with pnpm, so tests use npm ci and package-lock.json files
- Tests use `_exportsForTestingOnly` to avoid hitting real Braintrust APIs
- The shared package allows adding test coverage once and automatically running it in all environments
