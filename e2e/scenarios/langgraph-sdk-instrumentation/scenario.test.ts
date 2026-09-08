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

for (const dependency of ["langgraph-sdk-v1", "langgraph-sdk-v1-latest"]) {
  const version = await readInstalledPackageVersion(scenarioDir, dependency);
  describe(`LangGraph SDK ${version} (${dependency})`, () => {
    for (const module of ["esm", "cjs"]) {
      for (const mode of ["wrapped", "auto", "both", "disabled"]) {
        it(`${module} ${mode}`, async () => {
          await withScenarioHarness(async (harness) => {
            await harness.runNodeScenarioDir({
              scenarioDir,
              entry: "scenario.mjs",
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
              runContext: {
                originalScenarioDir,
                variantKey: dependency,
                cassette: false,
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
            expect(instrumented).toHaveLength(12);
            expect(
              [...new Set(instrumented.map((event) => event.span.name))].sort(),
            ).toEqual(["langgraph.runs.stream", "langgraph.runs.wait"]);
            for (const name of ["create", "thread-controller"]) {
              const parent = events.find((event) => event.span.name === name);
              expect(parent).toBeDefined();
              expect(
                instrumented.filter((event) =>
                  event.span.parentIds.includes(parent!.span.id!),
                ),
              ).toHaveLength(0);
            }
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
            for (const event of instrumented.filter(
              (event) =>
                !event.row.error && event.span.name === "langgraph.runs.wait",
            )) {
              expect(event.metrics).toMatchObject({
                prompt_tokens: 3,
                completion_tokens: 2,
                tokens: 5,
              });
            }
            const streams = instrumented.filter(
              (event) => event.span.name === "langgraph.runs.stream",
            );
            expect(streams).toHaveLength(5);
            expect(
              streams.filter(
                (event) => event.metrics?.time_to_first_token !== undefined,
              ),
            ).toHaveLength(3);
            expect(streams[0]?.output).toEqual({
              messages: [
                {
                  type: "ai",
                  id: "answer",
                  content: "Hello world",
                  usage_metadata: {
                    input_tokens: 3,
                    output_tokens: 2,
                    total_tokens: 5,
                  },
                },
              ],
            });
            expect(streams[1]?.output).toEqual({
              messages: [
                {
                  type: "AIMessageChunk",
                  id: "answer",
                  content: "Hello world",
                  usage_metadata: {
                    input_tokens: 3,
                    output_tokens: 2,
                    total_tokens: 5,
                  },
                },
              ],
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
        });
      }
    }
  });
}
