# Braintrust JS SDK Smoke Tests

The smoke tests ensure that a freshly packed `braintrust` build installs
cleanly and can run basic user workflows. These tests run on any PR.

The tests utilize the newly built braintrust package to run first using the CommonJS (CJS) build file and then using the ECMAScript Module (ESM) build file.

The tests are written without the use of vitest in order to work in both CJS and ESM environments. Vitest is a testing framework that is ESM native and did not support running using CJS.

## Repository Layout

- `scripts/` - has the scripts that run during the build process to
- `tests/` - Contains test projects
  - `spans/` - a simple span being sent to braintrust
  - `otel-v1/` - OpenTelemetry v1 ingestion for sending spans to braintrust
  - `deno/` - the simple span test re-written for the deno environment

Note: There were some caching issues I was running into with pnpm and keeping the test install completely separate. A switch was made to use npm ci and the package-lock.json file.
