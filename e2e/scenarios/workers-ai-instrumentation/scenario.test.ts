import { describe, expect, test } from "vitest";
import {
  prepareScenarioDir,
  readInstalledPackageVersion,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import {
  findAllSpans,
  findLatestSpan,
  findChildSpans,
} from "../../helpers/trace-selectors";
import { matchSpanTreeSnapshot, spanTreeFields } from "../../helpers/span-tree";
import { resolveFileSnapshotPath } from "../../helpers/file-snapshot";

const originalScenarioDir = resolveScenarioDir(import.meta.url);
const scenarioDir = await prepareScenarioDir({
  scenarioDir: originalScenarioDir,
});

for (const dependency of ["miniflare-v4", "miniflare-v4-latest"]) {
  const version = await readInstalledPackageVersion(scenarioDir, dependency);
  describe(`Workers AI native binding (${dependency}: ${version})`, () => {
    test("preserves native binding errors and concurrent workerd context", async () => {
      await withScenarioHarness(async (harness) => {
        await harness.runScenarioDir({
          scenarioDir,
          env: {
            MINIFLARE_PACKAGE_NAME: dependency,
            WORKERS_AI_BINDING_ONLY: "true",
          },
          runContext: {
            originalScenarioDir,
            variantKey: `${dependency}-binding`,
            cassette: false,
          },
          timeoutMs: 120_000,
        });
        const events = harness.events();
        expect(findAllSpans(events, "workers_ai.run")).toHaveLength(2);
        for (const name of ["binding-a", "binding-b"]) {
          const parent = findLatestSpan(events, name)!;
          const calls = findChildSpans(
            events,
            "workers_ai.run",
            parent.span.id,
          );
          expect(calls).toHaveLength(1);
          expect(calls[0].span.type).toBe("decision");
          expect(calls[0].row.error).toContain("BigInt");
          expect(calls[0].row.context).toMatchObject({
            span_origin: { instrumentation: { name: "workers-ai" } },
          });
        }
        await matchSpanTreeSnapshot(
          events.map((event) => ({
            event,
            fields: { ...spanTreeFields(event), context: event.row.context },
          })),
          resolveFileSnapshotPath(
            import.meta.url,
            `${dependency}-binding.span-tree.json`,
          ),
        );
      });
    }, 180_000);

    test("captures real decisions, extraction, media, errors and concurrent parents", async () => {
      await withScenarioHarness(async (harness) => {
        await harness.runScenarioDir({
          scenarioDir,
          env: {
            MINIFLARE_PACKAGE_NAME: dependency,
            BRAINTRUST_CAPTURE_ATTACHMENTS: "false",
          },
          runContext: { originalScenarioDir, variantKey: dependency },
          timeoutMs: 180_000,
        });
        const events = harness.events();
        const calls = findAllSpans(events, "workers_ai.run");
        expect(calls).toHaveLength(5);
        for (const name of ["decision-a", "decision-b", "image-decision"]) {
          const parent = findLatestSpan(events, name)!;
          const [call] = findChildSpans(
            events,
            "workers_ai.run",
            parent.span.id,
          );
          expect(call.span.type).toBe("decision");
          expect(call.row.metadata).toMatchObject({
            provider: "cloudflare",
            model: "clef-flash",
          });
          expect(call.output).toMatchObject({ answers: expect.any(Array) });
          expect(call.metrics?.prompt_tokens).toBeGreaterThan(0);
          expect(call.metrics?.completion_tokens).toBe(0);
          expect(call.metrics?.tokens).toBe(call.metrics?.prompt_tokens);
          expect(call.row.context).toMatchObject({
            span_origin: { instrumentation: { name: "workers-ai" } },
          });
        }
        const mixed = findChildSpans(
          events,
          "workers_ai.run",
          findLatestSpan(events, "decision-a")!.span.id,
        )[0];
        expect(mixed.output).toMatchObject({
          answers: expect.arrayContaining([
            expect.objectContaining({
              id: "urgent",
              type: "noul",
              noul: expect.any(Number),
            }),
            expect.objectContaining({
              id: "team",
              type: "choice",
              probabilities: expect.any(Object),
            }),
            expect.objectContaining({
              id: "impact",
              type: "score",
              score: expect.any(Number),
            }),
          ]),
        });
        const extracted = findChildSpans(
          events,
          "workers_ai.run",
          findLatestSpan(events, "extraction")!.span.id,
        )[0];
        expect(extracted.span.type).toBe("task");
        expect(extracted.output).toMatchObject({
          answers: {
            invoice: {
              type: "text",
              value: expect.any(String),
              span: expect.any(Array),
            },
            total: { type: "number", value: expect.any(Number) },
            missing: { value: null },
          },
          truncated: expect.any(Boolean),
        });
        const error = findChildSpans(
          events,
          "workers_ai.run",
          findLatestSpan(events, "provider-error")!.span.id,
        )[0];
        expect(error.row.error).toBeTruthy();
        expect(error.metrics?.end).toBeGreaterThan(0);
        const raw = findLatestSpan(events, "raw-response")!;
        expect(
          findChildSpans(events, "workers_ai.run", raw.span.id),
        ).toHaveLength(0);
        const image = findChildSpans(
          events,
          "workers_ai.run",
          findLatestSpan(events, "image-decision")!.span.id,
        )[0];
        expect(image.input).toMatchObject({
          state: {
            images: [
              { type: "file", mediaType: "image/png", data: "<omitted>" },
            ],
          },
        });
        await matchSpanTreeSnapshot(
          events.map((event) => ({
            event,
            fields: { ...spanTreeFields(event), context: event.row.context },
          })),
          resolveFileSnapshotPath(
            import.meta.url,
            `${dependency}.span-tree.json`,
          ),
        );
      });
    }, 240_000);
  });
}
