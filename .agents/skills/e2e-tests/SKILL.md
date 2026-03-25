---
name: e2e-tests
description: Write, run, and debug end-to-end tests for the Braintrust SDK. Use when asked to "add an e2e test", "create a scenario", "write an e2e scenario", "add e2e coverage", "debug e2e test", "fix e2e snapshot", or any task involving the e2e/ directory.
---

# E2E Tests

E2E tests run SDK scenarios in subprocesses against a mock Braintrust server. Read `e2e/README.md` for full details. **Always read the existing scenario closest to your task before writing a new one.**

## Commands

```bash
pnpm run build                        # Build SDK (required if source changed)
cd e2e && npx vitest run scenarios/<name>/scenario.test.ts          # Run one scenario
cd e2e && npx vitest run --reporter=verbose scenarios/<name>/scenario.test.ts  # Verbose
cd e2e && npx vitest run --update scenarios/<name>/scenario.test.ts # Update snapshots
cd e2e && npx vitest run -t "<exact test name>"                     # Isolate one test when file args over-match
pnpm run test:e2e                     # Run all (from repo root)
pnpm run test:e2e:hermetic            # Run hermetic-only e2e tests
pnpm run test:e2e:external            # Run external-api-only e2e tests
pnpm run fix:formatting               # Always run before committing
```

## Creating a Scenario

### 1. Create directory and entrypoint

```bash
mkdir -p e2e/scenarios/<name>
```

**Provider wrapper scenarios** — use `runTracedScenario` + `runOperation` from `provider-runtime.mjs`. This handles `initLogger`, root span, `testRunId` tagging, and flush. See `e2e/helpers/anthropic-scenario.mjs` or `e2e/helpers/openai-scenario.mjs` for examples.

**SDK primitive scenarios** — use `initLogger` + `logger.traced` + `logger.flush` directly. See `e2e/scenarios/trace-primitives-basic/scenario.ts`.

Both patterns use `runMain` from `scenario-runtime.ts` as the entrypoint wrapper.

### 2. Write the test (`scenario.test.ts`)

```typescript
import { expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { findLatestSpan } from "../../helpers/trace-selectors";
import { E2E_TAGS } from "../../helpers/tags";

// Module-level: copies scenario to temp dir + installs deps once
const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});

test(
  "my-scenario captures expected spans",
  { tags: [E2E_TAGS.hermetic] },
  async () => {
    await withScenarioHarness(async ({ runScenarioDir, testRunEvents }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: 90_000 });
      const events = testRunEvents();
      const root = findLatestSpan(events, "my-root");
      expect(root).toBeDefined();
      // ...assertions and snapshots
    });
  },
);
```

Key harness methods: `runScenarioDir()`, `runNodeScenarioDir()`, `runDenoScenarioDir()`, `testRunEvents()`, `events()`, `payloads()`, `requestsAfter(cursor)`, `testRunId`.

For wrapper scenarios use `events()` (not `testRunEvents()`) and scope payloads via `payloadRowsForRootSpan()`.

Tagging rules:

- Tag every e2e test with exactly one tag from `e2e/helpers/tags.ts`.
- Use `E2E_TAGS.hermetic` for scenarios that only use local mocks and fixtures.
- Use `E2E_TAGS.externalApi` for provider-backed scenarios. The shared Vitest config applies `retry: 1` to this tag automatically.
- Hermetic e2e tests are expected to run in the GitHub checks workflow. External-api tests run in the integration workflow.

### 3. Scenario-local dependencies (optional)

Only needed for external packages not in `e2e/package.json`. Workspace packages (e.g. `@braintrust/langchain-js`, `@braintrust/otel`) go in `e2e/package.json` as `workspace:^` — never use `workspace:` in scenario manifests.

```json
{
  "name": "@braintrust/e2e-my-scenario",
  "private": true,
  "braintrustScenario": {
    "canary": { "dependencies": { "some-pkg": "latest" } }
  },
  "dependencies": { "some-pkg": "1.2.3" }
}
```

Generate lockfile (**must be committed**):

```bash
cd e2e/scenarios/<name> && pnpm install --ignore-workspace --lockfile-only --strict-peer-dependencies=false
```

### 4. Verify stability

Run the test **3 times** consecutively. Snapshots must be identical each run. If they aren't, normalize the non-deterministic values (see below).

## Patterns

### Version matrix

Use npm aliases to test multiple package versions. Shared logic in `scenario.impl.ts`, version-specific entries import from aliases.

```json
{
  "dependencies": { "ai-sdk-v5": "npm:ai@5.0.82", "ai-sdk-v6": "npm:ai@6.0.1" }
}
```

```typescript
// scenario.ai-sdk-v5.ts
import * as ai from "ai-sdk-v5";
import { runMyImpl } from "./scenario.impl";
```

Test loops over versions with `for (const s of scenarios) { test(...) }`. See `wrap-ai-sdk-generation-traces` or `ai-sdk-otel-export`.

### Runner-wrapper (vitest/node:test/deno)

When the wrapper runs inside a nested test runner, `scenario.ts` spawns a second process via `runNodeSubprocess`. The nested runner file must NOT be named `*.test.ts`. Tag all data with `metadata.testRunId` and use `payloadRowsForTestRunId()`. See `wrap-vitest-suite-traces`.

Use:

- `runNodeScenarioDir()` for plain Node nested runners
- `runDenoScenarioDir()` for Deno nested runners
- `runner.case.ts` for nested Deno entrypoints

Deno scenarios can have intentionally different runtime contracts from Node. Assert the actual Deno/browser behavior rather than copying Node parent-child expectations blindly. See `e2e/scenarios/deno-browser/`.

### OTEL export

Set up `BraintrustExporter`/`BraintrustSpanProcessor` pointed at the mock server, register globally, then assert on `/otel/v1/traces` requests via `requestsAfter()` + `extractOtelSpans()`. See `ai-sdk-otel-export` or `otel-span-processor-export`.

## Snapshot Stability

`normalizeForSnapshot()` handles IDs, timestamps, paths, and `system_fingerprint`. You must handle these yourself in a scenario-specific normalizer (see `e2e/scenarios/wrap-langchain-js-traces/assertions.ts` for an example):

| Non-deterministic value    | Replacement        |
| -------------------------- | ------------------ |
| LLM response text          | `"<llm-response>"` |
| Token counts               | `0`                |
| Tool call IDs (`call_xxx`) | `"<tool_call_id>"` |

## Module Resolution

Scenarios run from `e2e/.bt-tmp/run-<id>/scenarios/<name>/`. Node walks up to `e2e/node_modules/` for workspace deps (`braintrust`, `@braintrust/otel`, etc.). Scenario-local deps are in the scenario's own `node_modules/`. Helper imports (`../../helpers/...`) work because `prepareScenarioDir` copies `e2e/helpers/` into the temp dir.

Deno nested runners use `runDenoScenarioDir()`, which invokes `deno test --no-check` with the harness env vars and the prepared temp scenario path.

## Debugging

- **Subprocess error**: Read the `STDERR` section in the error message.
- **Module not found**: Is it a workspace pkg? → `e2e/package.json`. External? → scenario `package.json`.
- **Flaky snapshot**: Add normalization for the changing field.
- **Timeout**: Increase `timeoutMs` (90-120s typical for provider calls).
- **Missing lockfile**: `cd e2e/scenarios/<name> && pnpm install --ignore-workspace --lockfile-only --strict-peer-dependencies=false`
