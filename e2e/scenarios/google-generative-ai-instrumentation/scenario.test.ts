import { describe, expect, test } from "vitest";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { matchSpanTreeSnapshot, spanTreeFields } from "../../helpers/span-tree";
import { resolveFileSnapshotPath } from "../../helpers/file-snapshot";
import { findLatestSpan, findAllSpans } from "../../helpers/trace-selectors";

const originalScenarioDir = resolveScenarioDir(import.meta.url);
const scenarioDir = await prepareScenarioDir({
  scenarioDir: originalScenarioDir,
});

describe.concurrent("variants", () => {
  for (const variant of ["v0", "v0-latest"]) {
    describe.sequential(variant, () => {
      for (const mode of ["wrapped", "auto-cjs", "auto-esm", "wrapped-auto"]) {
        test(
          mode,
          async () => {
            await withScenarioHarness(async (harness) => {
              await harness.runNodeScenarioDir({
                scenarioDir,
                entry: "scenario.mjs",
                timeoutMs: 120_000,
                nodeArgs:
                  mode === "wrapped" ? [] : ["--import", "braintrust/hook.mjs"],
                env: {
                  GOOGLE_GENERATIVE_AI_PACKAGE_NAME: `google-generative-ai-sdk-${variant}`,
                  GOOGLE_GENERATIVE_AI_MODULE:
                    mode === "auto-esm" ? "esm" : "cjs",
                  GOOGLE_GENERATIVE_AI_WRAP: String(mode.startsWith("wrapped")),
                },
                runContext: {
                  originalScenarioDir,
                  variantKey: `google-generative-ai-${variant}`,
                },
              });
              const events = harness.events();
              const llms = [
                "generate_content",
                "embed_content",
                "batch_embed_contents",
              ].flatMap((name) => findAllSpans(events, name));
              expect(llms).toHaveLength(12);
              for (const name of [
                "generation",
                "image",
                "stream",
                "response-only",
                "chat",
                "chat-stream",
                "tools",
                "embedding",
                "batch-embedding",
                "embedding-with-usage",
                "batch-embedding-with-usage",
                "error",
              ]) {
                const operation = findLatestSpan(events, name);
                expect(operation).toBeDefined();
                const children = llms.filter((event) =>
                  event.span.parentIds?.includes(operation!.span.id!),
                );
                expect(children).toHaveLength(1);
                expect(children[0].row.metadata).toMatchObject({
                  provider: "google",
                });
                expect(children[0].context).toHaveProperty(
                  "span_origin.instrumentation.name",
                  "google-generative-ai",
                );
                expect(children[0].span.ended).toBe(true);
                if (name === "image")
                  expect(children[0].input).toHaveProperty(
                    "contents.1.parts.1.inlineData.data.type",
                    "braintrust_attachment",
                  );
                if (name === "error")
                  expect(children[0].row.error).toBeTruthy();
                else if (!name.includes("embedding")) {
                  expect(children[0].metrics?.prompt_tokens).toBeGreaterThan(0);
                  expect(children[0].output).toHaveProperty("candidates");
                }
                if (name.startsWith("embedding")) {
                  expect(children[0].output).toEqual({ count: 1 });
                  expect(children[0].input).toEqual({
                    inputs: [{ content: "Braintrust tracing" }],
                    output_dimensions: 32,
                  });
                }
                if (name.startsWith("batch-embedding"))
                  expect(children[0].output).toEqual({ count: 2 });
                if (name.includes("embedding")) {
                  expect(children[0].metrics).not.toHaveProperty(
                    "completion_tokens",
                  );
                  if (name.endsWith("-with-usage")) {
                    expect(children[0].metrics?.prompt_tokens).toBeGreaterThan(
                      0,
                    );
                    expect(children[0].metrics?.tokens).toBe(
                      children[0].metrics?.prompt_tokens,
                    );
                    expect(children[0].row.metadata).toMatchObject({
                      model: "gemini-embedding-2",
                    });
                  } else {
                    expect(children[0].metrics).not.toHaveProperty(
                      "prompt_tokens",
                    );
                    expect(children[0].metrics).not.toHaveProperty("tokens");
                  }
                }
                if (name === "stream" || name === "chat-stream")
                  expect(
                    children[0].metrics?.time_to_first_token,
                  ).toBeGreaterThanOrEqual(0);
                if (name === "chat-stream")
                  expect(children[0].input).toHaveProperty(
                    "contents.length",
                    6,
                  );
              }
              await matchSpanTreeSnapshot(
                events.map((event) => ({
                  event,
                  fields: { ...spanTreeFields(event), context: event.context },
                })),
                resolveFileSnapshotPath(
                  import.meta.url,
                  `google-generative-ai-${variant}.span-tree.json`,
                ),
              );
            });
          },
          120_000,
        );
      }
    });
  }
});
