import { findAllSpans } from "../../helpers/trace-selectors";
import { describe, expect, it } from "vitest";
import {
  prepareScenarioDir,
  readInstalledPackageVersion,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { matchSpanTreeSnapshot, spanTreeFields } from "../../helpers/span-tree";
import { resolveFileSnapshotPath } from "../../helpers/file-snapshot";

const originalScenarioDir = resolveScenarioDir(import.meta.url);
const scenarioDir = await prepareScenarioDir({
  scenarioDir: originalScenarioDir,
});

const variants = await Promise.all(
  ["langgraph-sdk-v1", "langgraph-sdk-v1-latest"].map(async (dependency) => ({
    dependency,
    version: await readInstalledPackageVersion(scenarioDir, dependency),
  })),
);

describe.concurrent("variants", () => {
  for (const { dependency, version } of variants) {
    describe.sequential(`LangGraph SDK ${version} (${dependency})`, () => {
      for (const module of ["esm", "cjs"]) {
        for (const mode of ["wrapped", "auto", "both", "disabled"]) {
          it(`${module} ${mode}`, async () => {
            await withScenarioHarness(async (harness) => {
              await harness.runNodeScenarioDir({
                scenarioDir,
                entry: "scenario.mjs",
                timeoutMs: 120_000,
                env: {
                  LANGGRAPH_SDK_PACKAGE: dependency,
                  LANGGRAPH_SDK_MODULE: module,
                  LANGGRAPH_SDK_MODE: mode,
                  ...(mode === "disabled"
                    ? { BRAINTRUST_DISABLE_INSTRUMENTATION: "langgraph-sdk" }
                    : {}),
                },
                nodeArgs:
                  mode === "wrapped" ? [] : ["--import", "braintrust/hook.mjs"],
                // Re-run the real server/graph in every lane. Only the model
                // HTTP responses are recorded and replayed by the harness.
                runContext: {
                  originalScenarioDir,
                  variantKey: dependency,
                },
              });
              const rawEvents = harness.events();
              const events = [
                ...new Set(rawEvents.map((event) => event.span.name)),
              ].flatMap((name) => (name ? findAllSpans(rawEvents, name) : []));
              const instrumented = events.filter((event) =>
                event.span.name?.startsWith("langgraph."),
              );
              if (mode === "disabled") {
                expect(instrumented).toHaveLength(0);
                return;
              }
              expect(instrumented).toHaveLength(13);
              expect(
                [
                  ...new Set(instrumented.map((event) => event.span.name)),
                ].sort(),
              ).toEqual(["langgraph.runs.stream", "langgraph.runs.wait"]);
              const create = events.find(
                (event) => event.span.name === "create",
              );
              expect(create).toBeDefined();
              expect(
                instrumented.filter((event) =>
                  event.span.parentIds.includes(create!.span.id!),
                ),
              ).toHaveLength(0);
              for (const event of instrumented) {
                expect(event.span.type).toBe("task");
                expect(event.span.ended).toBe(true);
                expect(event.context?.span_origin).toMatchObject({
                  instrumentation: { name: "langgraph-sdk" },
                });
                expect(event.span.parentIds).toHaveLength(1);
              }
              expect(JSON.stringify(instrumented)).not.toContain(
                "DO_NOT_CAPTURE",
              );
              expect(
                instrumented.filter((event) => event.row.error),
              ).toHaveLength(4);
              const childOf = (name: string) => {
                const parent = events.find(
                  (event) => event.span.name === name,
                )!;
                return instrumented.find((event) =>
                  event.span.parentIds.includes(parent.span.id!),
                )!;
              };
              for (const name of [
                "wait",
                "resume",
                "values",
                "messages",
                "updates",
                "left",
                "right",
              ]) {
                const event = childOf(name);
                const metrics = event.metrics as Record<string, number>;
                expect(metrics.prompt_tokens).toBeGreaterThan(0);
                expect(metrics.completion_tokens).toBeGreaterThan(0);
                expect(metrics.tokens).toBe(
                  metrics.prompt_tokens + metrics.completion_tokens,
                );
                const state =
                  name === "updates"
                    ? (event.output as Array<{ agent: unknown }>).find(
                        (update) => update.agent,
                      )!.agent
                    : event.output;
                const messages = (
                  state as {
                    messages: Array<{
                      content: string;
                      usage_metadata?: { total_tokens: number };
                    }>;
                  }
                ).messages;
                expect(messages.at(-1)?.content.length).toBeGreaterThan(0);
                expect(messages.at(-1)?.usage_metadata?.total_tokens).toBe(
                  event.metrics?.tokens,
                );
              }
              // State and message streaming must expose the real model output,
              // and observing both must not count the same message's usage twice.
              for (const name of ["values", "messages", "updates"]) {
                expect(
                  childOf(name).metrics?.time_to_first_token,
                ).toBeGreaterThanOrEqual(0);
                expect(JSON.stringify(childOf(name).output)).toContain(
                  "hello from langgraph",
                );
              }
              expect(childOf("updates").output).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({ agent: expect.any(Object) }),
                ]),
              );
              expect(childOf("interrupt").output).toMatchObject({
                __interrupt__: [{ value: "Approve the model call?" }],
              });
              expect(childOf("resume").input).toEqual({
                command: { resume: "yes" },
              });
              for (const event of events.filter(
                (event) => event.span.name === "after-stream",
              )) {
                expect(
                  instrumented.some((span) =>
                    event.span.parentIds.includes(span.span.id!),
                  ),
                ).toBe(false);
              }
              await matchSpanTreeSnapshot(
                events.map((event) => ({
                  event,
                  fields: { ...spanTreeFields(event), context: event.context },
                })),
                resolveFileSnapshotPath(
                  import.meta.url,
                  `${dependency}-${module}.span-tree.json`,
                ),
              );
            });
          }, 120_000);
        }
      }
    });
  }
});
