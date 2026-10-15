# SDK packaging and the Vite+ migration

This is a major-release migration to ESM, explicit instrumentation setup, and tree-shaking through the existing public entrypoints.
The runtime floor is Node 22.18; browser, workerd, and edge-light builds remain separate targets.

## Consumer imports

Import SDK APIs from `braintrust`:

```ts
import {
  initLogger,
  traced,
  Eval,
  initDataset,
  loadPrompt,
  invoke,
  wrapOpenAI,
} from "braintrust";
```

The package retains its existing public subpaths and adds only `braintrust/auto` for explicit instrumentation setup.
Feature implementations and provider registration modules stay internal.
Consumers do not need separate feature or provider imports to get tree-shaking.
ESM exports, separate internal modules, and accurate side-effect metadata let consumer bundlers remove unused code from root imports.

Public JavaScript entrypoints are ESM.
CommonJS applications can use dynamic `import()`; Jest applications should enable its ESM runner.
The private Webpack loader remains CommonJS because Webpack loads it through that interface.
Node loader instrumentation still handles CommonJS provider dependencies.

## Instrumentation setup

Importing the root does not register instrumentation.
Calling a manual wrapper registers that provider once, using a registry shared by compatible SDK copies.

```ts
import OpenAI from "openai";
import { wrapOpenAI } from "braintrust";

const client = wrapOpenAI(new OpenAI());
```

For automatic instrumentation, the code transform and the runtime consumers must both be enabled.
The Node hook enables both:

```sh
node --import braintrust/hook.mjs app.mjs
```

Bundled applications should keep their Braintrust bundler plugin and add `import "braintrust/auto"` to their instrumentation setup.
Configuration must precede registration.
Use a dynamic import when configuring the all-provider entrypoint:

```ts
import { configureInstrumentation } from "braintrust/instrumentation";

configureInstrumentation({ integrations: { openai: false } });
await import("braintrust/auto");
```

Static imports are evaluated before the body of the importing module, regardless of where the import statement appears.
The existing `BRAINTRUST_DISABLE_INSTRUMENTATION` provider list remains supported.

## Output layout and side effects

Runtime builds preserve internal ESM module boundaries with [Vite+ Pack’s unbundle mode](https://tsdown.dev/options/unbundle).
This keeps unused modules removable even when their class definitions or dependencies prevent statement-level tree-shaking after flattening.
These internal files are not public package exports.
Each runtime has its own output graph under `dist/node`, `dist/browser`, `dist/workerd`, or `dist/edge-light`.
Build-time resolution selects a platform adapter; the runtime never chooses an adapter by mutating a shared singleton during import.
Conditional exports select workerd and edge-light before the generic browser and Node conditions, with a portable default.
See Node's [conditional exports documentation](https://nodejs.org/api/packages.html#conditional-exports).

Only the explicit auto entrypoints and Node hook are marked as side effects in the main package.
Logger state, evaluation registration, prompt caches, and template registration are initialized on use.
`flush()` before initialization is a no-op.
Pure annotations are limited to inert schema and channel definitions; registration calls remain observable.

Tracing, datasets, prompts, experiments, and object fetching now have separate implementation modules.
Tracing does not import the prompt/template feature, schema conversion, or provider consumers.
Runtime dependencies remain external, except the private `async` implementation.
Consumer bundlers can optimize those dependencies for their own target and deduplicate them with the application.
`esbuild` is a development dependency used by compatibility tests, rather than an SDK runtime dependency.

Deep imports into `dist` are unsupported.
The old `BraintrustState` prompt-cache fields were internal implementation details; cache ownership now lives in the prompt feature.

## Maintainer workflow

[Vite+ Pack](https://viteplus.dev/guide/pack) drives tsdown/Rolldown builds through each package's `vite.config.ts`.
Vite+ also runs tests, linting, formatting, and workspace tasks.
The repository retains pnpm, mise, Changesets, Knip, and the secret-scanning hook.
Consumer fixtures intentionally exercise other bundlers and older supported test runners.

```sh
pnpm run build
pnpm run check:typings
pnpm run check
pnpm run fix:formatting
pnpm run knip
pnpm run test:e2e
```

Vite+ is pinned to 1.1.0, which cleared the repository's three-day release quarantine when this migration was implemented.
Build tasks clean their output, track dependencies, and preserve the managed shell environment.
Tests, recordings, and benchmarks are not cached.

Build configs rely on Pack's defaults for ESM, `src/index.ts`, `dist`, cleaning, tree-shaking, and dependency externalization where those defaults match the package.
Node builds infer their target from `engines.node`; portable builds retain an explicit ES2022 target.
See the upstream [target](https://tsdown.dev/options/target) and [dependency](https://tsdown.dev/options/dependencies) defaults.
Workspace scripts use `vp run -r`, with explicit filters only when selecting or excluding particular packages.
The [task runner defaults](https://viteplus.dev/guide/run#caching) cache configured compile tasks and leave package scripts uncached.

The remaining build overrides serve specific requirements:

- `fixedExtension: false` follows `type: module` for `.js` and `.d.ts` output; hooks retain `.mjs` and the Webpack loader retains CommonJS.
- `clean: ["dist"]` removes obsolete files across the main SDK's multiple output directories through Pack itself.
- Oxc declaration generation, source maps, runtime-specific outputs, and internal ESM module boundaries remain explicit.
- The platform resolver runs before TypeScript path aliases so browser and Worker builds cannot select the Node adapter used by source tests.
- The bundled `async` dependency has an explicit allowlist and output filename normalization to keep it within the SDK's ESM package scope.
- The hook's runtime import uses standard externalization and output-path mapping instead of a resolver plugin.

Declaration generation uses Oxc inside `vp pack` for the SDK and integration packages.
Explicit annotations preserve public signatures, and SDK validators expose compact types rather than expanded Zod graphs.
TypeScript remains the semantic checker and consumer compatibility baseline; builds emit declarations through Oxc.
See tsdown's [declaration generation documentation](https://tsdown.dev/options/dts).

## Performance measurements

Build and lint changes are validated by running the tools directly.
The migration's added packed-package test script, consumer fixture, and CI gate were removed to avoid maintaining tests for build tooling.
The consumer checks recorded below describe validation performed during the migration.

For fresh-process import measurements:

```sh
node js/scripts/benchmark-imports.mjs /path/to/baseline/index.mjs
```

The benchmark reports import time, first `currentSpan()` use, RSS, and bundled sizes across 15 fresh processes.
The baseline and candidate use the same installed runtime dependencies.
It does not claim to clear the operating system's filesystem cache.
Compare import plus first-use time because lazy initialization moves work between those phases.

A Node 26 measurement on the development sandbox reduced the tracing fixture from 664,568 to 175,026 minified bytes (74%), and from 185,047 to 49,961 gzip bytes (73%).
This fixture imports `traced` from the root and retains it with `globalThis.run = traced`.

| Native ESM import | Median import | Median first use | Median RSS |
| ----------------- | ------------: | ---------------: | ---------: |
| Previous root     |         85 ms |            <1 ms |      91 MB |
| New root          |        116 ms |             9 ms |     103 MB |

Native Node imports do not tree-shake: they load the root's static dependency graph.
The new root is slower and uses more memory than the previous root in this measurement.
Preserving internal modules improves consumer tree-shaking but adds native module-loading work.
Server startup remains an optimization target; this migration does not yet improve unbundled root-import latency.
Lazy initialization remains, but the measured bundle-size improvement does not imply faster unbundled imports.
These are fixture results, not a universal size or latency guarantee.

## Migration review

The follow-up used the pinned CLI from the workspace root: `pnpm dlx --package=vite-plus@1.1.0 vp help migrate`, then `pnpm dlx --package=vite-plus@1.1.0 vp migrate --no-interactive`.
This was an upgrade of the existing setup, without `--full`.
The original repository already used Vite 8 and Vitest 4.
The upgrade reported no blockers and two `unawaited-assertion` review items in `js/src/framework.test.ts` and `js/src/logger.test.ts`.
Both assertions store a promise and await it after advancing timers; both tests pass without changing their assertions.

The migrator moved pnpm settings into `pnpm-workspace.yaml`, created a shared toolchain catalog and `vite@*`/`vitest@*` overrides, and removed unnecessary direct Vitest dependencies.
The existing dependency security overrides and three-day release quarantine remain in effect; the generated quarantine exemptions were removed.
Public reporter declarations keep `vitest/node`, with a direct development dependency, so SDK consumers do not need Vite+.
The isolated Vite and Vitest consumer fixtures keep their upstream imports and version matrices.
Other internal test imports use `vite-plus/test`.

Build and test settings now share each package's `vite.config.ts`.
The e2e recording launcher also uses `vp test`.
`pnpm run check` and the static-check CI job run `vp check` with `lint.options.typeAware` and `typeCheck` enabled.
The existing lint scope and warning policy are preserved.
The separate TypeScript checks remain because they also cover test configurations and supported consumer compiler versions.
Enabling the newer checker required explicit Pack config typing, iterator and credential narrowing, and ArrayBuffer-owned attachment bytes.
The baseline tests also caught a stale export expectation and the auto-instrumentation loader's relative path after preserving internal modules; both were corrected.

Compatibility cleanup was tested one setting at a time:

| Config                                               | Setting                   | Decision and validation                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/vite.config.ts` (formerly `js/vitest.config.js`) | `clearMocks: false`       | Removed; `pnpm --dir js test` passed all 1,919 tests before and after removal, without test changes.                                                                                                                        |
| `js/vite.config.ts`                                  | `sharedViteServer: false` | Removed separately; the same 1,919 tests passed.                                                                                                                                                                            |
| `js/src/wrappers/vitest/vite.config.ts`              | `clearMocks: false`       | Removed; `pnpm --dir js/src/wrappers/vitest test` retained 61 passing tests and the same three existing skips.                                                                                                              |
| `js/src/wrappers/vitest/vite.config.ts`              | `sharedViteServer: false` | Removed separately; the same wrapper suite passed.                                                                                                                                                                          |
| `e2e/vite.config.ts`                                 | `clearMocks: false`       | Retained: all 60 non-Claude/non-Docker files completed with this removed, and the separate Claude run passed 56 tests, but the Docker Harness cases could not complete. The trial was interrupted and the setting restored. |
| `e2e/vite.config.ts`                                 | `sharedViteServer: false` | Retained without a removal trial because the same required Docker coverage remains unavailable. This is unvalidated cleanup, not a demonstrated dependency on v4 behavior.                                                  |

The pinned migrator inserted `deps.resolveDepSubpath: true` in seven configs: Seinfeld, browser, DeepSeek Harness, OpenTelemetry, Nunjucks, Temporal, and the shared smoke package.
After a passing baseline build, each setting and its comment was removed separately and `pnpm exec vp pack` was run in that package.
All seven builds passed and all 17 emitted JavaScript/declaration files were byte-for-byte identical to the compatibility baseline.
No `attw.profile: 'strict'` setting was inserted; the migration's packed consumer checks validated modern ESM resolution and declarations with library checking enabled.
There were no generated browser-locator, Temporal fake-timer, inline-project inheritance, or coverage-threshold settings to remove.
No coverage thresholds or test assertions were relaxed.

With the accepted removals combined, `vp install --frozen-lockfile`, `pnpm run check`, all 12 configured `check:typings` tasks, `pnpm run knip`, and the root `pnpm run test` passed.
The root test command rebuilt the workspace and ran all five configured test tasks; all 1,459 SDK JavaScript/declaration outputs matched the previously checked package byte-for-byte.
The packed consumer matrix passed on Node 22.18, including esbuild, Rollup, Vite/Rolldown, Webpack, TypeScript 5.4/current, and Zod 3/4.
The browser smoke test used a freshly packed SDK, and both isolated OpenTelemetry version suites and the queue benchmark passed.
`vp check` reported zero errors and 1,176 existing warnings under the preserved lint policy.

## Validation limits

The migration was checked with the workspace build, configured TypeScript checks, core and integration suites, the packed consumer matrix, browser smoke tests, and Temporal's workflow bundler.
The e2e summary now records actual project-log root span IDs and experiment names, so its links work for traces without scenario metadata and for experiment-only scenarios.
The final configuration passed three broad replay runs with 1,939 tests each on Node 26, plus three runs of the 56 Claude tests on Node 24 and three runs of the separate subprocess handoff test.
An interrupted third broad run was repeated to obtain a complete result.
The Claude snapshots were regenerated for the internal module paths earlier in the migration; this follow-up did not change snapshots.
Eight existing Hugging Face cases were skipped by the scenario matrix.
Production forwarding and all 124 generated log links, 1,005 referenced root spans, and 44 experiment links were verified through read-only queries against the existing `tmp-luca` project.
The summary includes metadata from the completed runs and the interrupted run; one root span appeared on a second lookup after ingestion caught up.

The four Docker-backed HarnessAgent cases could not complete in this workspace because its remote Docker containers cannot reach the local replay server.
The separate subprocess handoff case passes.
The broad replay suite runs on Node 26; the Claude Agent SDK matrix is checked separately on Node 24.
The pinned Claude SDK 0.2.76 reports `UND_ERR_INVALID_ARG` on Node 26 in this workspace.
The pinned Mistral SDK 1.3.4 truncates replayed streams on Node 22 and 24, including in an unwrapped reproduction; its full replay passes on Node 26.
Provider snapshots retain the full output and token-count contracts.

An additional standalone TypeScript check of `e2e/` is not clean: it reports scenario-local dependencies, Deno globals, and scenario typing errors.
The configured workspace type checks and the isolated consumer declaration matrix pass.
