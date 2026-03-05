# E2E Tests

End-to-end tests that validate the Braintrust SDK by running real SDK usage scenarios against a mock server.

## How It Works

1. A **mock Braintrust server** starts before all tests (via Vitest global setup)
2. Each test spawns a **scenario script** as a subprocess using `tsx`, with env vars pointing at the mock server
3. The scenario uses the SDK normally (init, create spans, log data, flush)
4. The test waits for expected events to arrive at the mock server, then **normalizes** and **snapshots** them

Subprocess isolation ensures the SDK operates exactly as it would in production.

## Structure

```
e2e/
├── scenarios/          # Standalone scripts that use the SDK (run as subprocesses)
├── tests/
│   ├── helpers/        # Test utilities (see below)
│   ├── global-setup.ts # Starts mock server, injects URL + API key into test context
│   ├── *.test.ts       # Test files
│   └── __snapshots__/  # Vitest snapshot files
└── vitest.config.mts
```

## Helpers (`tests/helpers/`)

- `mock-braintrust-server.ts` — Mock Braintrust API server (started automatically via global setup).
- `run-scenario.ts` — Spawns scenario scripts as subprocesses.
- `ingestion.ts` — Utilities for retrieving and waiting on data captured by the mock server.
- `normalize.ts` — Makes captured data deterministic for snapshot testing.

### Writing a new test

Use `runScenarioOrThrow(scenarioFile, env)` to execute a scenario. It runs the file with `tsx`, passes your env vars, and throws on non-zero exit. Default timeout is 15s.

The main utilities you'll use in test files:

- `createTestRunId()` — Returns a unique `e2e-{uuid}` string. Pass it to your scenario via env vars so you can filter events for your test.
- `getTestServerEnv(testRunId)` — Returns the env vars a scenario needs to talk to the mock server (`BRAINTRUST_API_URL`, `BRAINTRUST_API_KEY`, `TEST_RUN_ID`).
- `waitForRunEvent(testRunId, predicate)` — Polls the mock server until an event matching the test run ID and predicate arrives (5s timeout, 50ms interval). Returns the matched `CapturedLogEvent`.
- `waitForEvent(predicate)` — Same as above but without filtering by test run ID.
- `getPayloadsForRun(testRunId)` — Returns all raw `logs3` payloads for a given test run.
- `getEvents()` / `getPayloads()` — Low-level access to all captured events/payloads, with optional predicate filtering.

Use `normalizeEvent(event)` and `normalizePayloads(payloads)` before snapshotting. Replaces timestamps with `<timestamp>`, UUIDs with indexed tokens (`<uuid:1>`, `<span:1>`, `<xact:1>`, `<run:1>`), and absolute file paths with relative ones.

## Running

```bash
pnpm run test:e2e          # Run tests
pnpm run test:e2e:update   # Run tests and update snapshots
```
