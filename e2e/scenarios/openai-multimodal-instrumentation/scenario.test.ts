import { findAllSpans } from "../../helpers/trace-selectors";
import { expect, test } from "vitest";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { resolveFileSnapshotPath } from "../../helpers/file-snapshot";
import { matchSpanTreeSnapshot, spanTreeFields } from "../../helpers/span-tree";
const originalScenarioDir = resolveScenarioDir(import.meta.url);
const scenarioDir = await prepareScenarioDir({
  scenarioDir: originalScenarioDir,
});
for (const major of [4, 5, 6]) {
  for (const suffix of ["", "-latest"]) {
    const dependency = `openai-v${major}${suffix}`;
    for (const mode of ["wrapped", "auto", "both"]) {
      test(`${dependency} ${mode}`, async () => {
        await withScenarioHarness(async (harness) => {
          await harness.runNodeScenarioDir({
            scenarioDir,
            entry: "scenario.mjs",
            runContext: {
              variantKey: dependency,
              originalScenarioDir,
            },
            env: {
              OPENAI_PACKAGE_NAME: dependency,
              INSTRUMENTATION_MODE: mode === "both" ? "wrapped" : mode,
            },
            nodeArgs:
              mode !== "wrapped" ? ["--import", "braintrust/hook.mjs"] : [],
            timeoutMs: 300_000,
          });
          const events = harness.events();
          const media = [
            "openai.images.generate",
            "openai.images.edit",
            "openai.images.createVariation",
            "openai.audio.transcriptions.create",
            "openai.audio.translations.create",
            "openai.audio.speech.create",
          ].flatMap((name) => findAllSpans(events, name));
          expect(media).toHaveLength(major === 4 ? 13 : 15);
          for (const event of media) {
            const input = event.input as {
              prompt?: string;
              content?: Array<{
                image_url?: { url?: { type?: string } };
                file?: { file_data?: { type?: string } };
              }>;
            };
            for (const part of input.content ?? [])
              expect(
                part.image_url?.url?.type ?? part.file?.file_data?.type,
              ).toBe("braintrust_attachment");
            if (event.span.name === "openai.audio.speech.create") {
              if (
                ["Hello cancel.", "Hello unread."].includes(input.prompt ?? "")
              )
                expect(event.output).toEqual({ content: [] });
              else {
                expect(event.output).toMatchObject({
                  content: [
                    {
                      type: "file",
                      file: { file_data: { type: "braintrust_attachment" } },
                    },
                  ],
                });
              }
            }
          }
          if (process.env.OPENAI_API_KEY)
            expect(JSON.stringify(events)).not.toContain(
              process.env.OPENAI_API_KEY,
            );
          await matchSpanTreeSnapshot(
            events.map((event) => ({
              event,
              fields: { ...spanTreeFields(event), context: event.context },
            })),
            resolveFileSnapshotPath(
              import.meta.url,
              `${dependency}-${mode}.span-tree.json`,
            ),
          );
        });
      }, 360_000);
    }
  }
}
