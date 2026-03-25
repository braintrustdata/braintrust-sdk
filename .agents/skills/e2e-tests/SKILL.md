---
name: e2e-tests
description: Write, run, and debug end-to-end tests for the Braintrust SDK. Use when asked to add an e2e test, create a scenario, write an e2e scenario, add e2e coverage, debug e2e test, fix e2e snapshot, or any task involving the e2e/ directory.
---

# E2E Tests

E2E tests run SDK scenarios in subprocesses against a mock Braintrust server. Start by reading the closest existing scenario and the relevant helper in `e2e/helpers/`. Prefer extending existing patterns over inventing a new one.

Read first:

- `e2e/README.md`
- Closest `e2e/scenarios/<name>/scenario.test.ts`

## Commands

Always run from the root of the scenario - this ensures that required environment variables are picked up and that required changed packages are built before the tests are run.

```bash
pnpm run test:e2e
pnpm run test:e2e:hermetic # only run tests that don't rely on external services or llm providers
pnpm run test:e2e:update # updates snapshots
```

## Preferred Patterns

- Default to module-scope setup with `prepareScenarioDir({ scenarioDir: resolveScenarioDir(import.meta.url) })`. That keeps temp-copy and dependency-install work out of individual test bodies.
- Run every scenario through `withScenarioHarness(...)`. Use `runScenarioDir()` for `tsx`, `runNodeScenarioDir()` for plain Node and hook coverage, and `runDenoScenarioDir()` for Deno nested runners.
- Tag every test with exactly one tag from `e2e/helpers/tags.ts`.
- Keep reusable logic in `e2e/helpers/`. Keep one-off fixtures and scenario-specific files inside the scenario directory.
- Snapshot stable contracts, not raw noise. Use `normalizeForSnapshot(...)` before inline snapshots and `formatJsonFileSnapshot(...)` plus file snapshots for larger payloads or version matrices.
- Run new or updated scenario tests three times in a row before considering snapshots stable.

## Scenario Patterns

- SDK primitive scenarios: use `scenario.ts` with normal SDK calls and assert on `testRunEvents()`. See `trace-primitives-basic`.
- Wrapper scenarios: use `events()` rather than `testRunEvents()`, find the root span first, and scope payload snapshots with `payloadRowsForRootSpan(...)`. Pair span and payload snapshots when the wrapper emits merged log rows.
- Version matrix scenarios: put shared logic in `scenario.impl.*` or shared assertion helpers, then loop over versions from aliases or helper-generated scenario lists. Do not duplicate the same assertions per version by hand.
- Test runner integration scenarios (deno, vitest, jest, ...): keep the outer e2e suite in `scenario.test.ts`, the spawned entry in `scenario.ts`, and nested test files in names like `runner.case.ts`. Do not name nested runner files `*.test.ts`.

## Scenario-Local Dependencies

- Only add a scenario-local `package.json` for truly scenario-specific external dependencies.
- Workspace packages belong in `e2e/package.json` as `workspace:^`, not in scenario manifests.
- Do not use `workspace:` specs in scenario-local manifests.
- If a scenario manifest exists, commit its lockfile.

Generate the lockfile with:

```bash
cd e2e/scenarios/<name> && pnpm install --ignore-workspace --lockfile-only --strict-peer-dependencies=false
```

## Debugging

- Flaky snapshot: normalize the changing field instead of snapshotting around it.
- Request-flow assertions: grab `requestCursor()` before running the scenario, then inspect `requestsAfter(...)`.
- Deno/browser scenarios may intentionally differ from Node. Assert the real runtime contract instead of copying Node expectations blindly.
