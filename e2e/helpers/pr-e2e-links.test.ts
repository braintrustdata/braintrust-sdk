import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

it("links published runs while preserving legacy records and excluding local-only runs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "braintrust-e2e-links-"));
  const configPath = path.join(dir, "config.json");
  const shardDir = path.join(dir, "shard-1");
  try {
    await mkdir(shardDir);
    await writeFile(
      configPath,
      JSON.stringify([
        {
          scenarioDirName: "scenario",
          label: "Scenario",
          metadataScenario: "scenario",
        },
        {
          scenarioDirName: "without-metadata",
          label: "Without metadata",
          metadataScenario: "without-metadata",
        },
        {
          scenarioDirName: "experiment",
          label: "Experiment",
          metadataScenario: "experiment",
        },
      ]),
    );
    await writeFile(
      path.join(shardDir, "runs.ndjson"),
      [
        { testRunId: "e2e-published", forwardToProduction: true },
        { testRunId: "e2e-local-only", forwardToProduction: false },
        { testRunId: "e2e-legacy" },
        {
          scenarioDirName: "without-metadata",
          testRunId: "e2e-no-metadata",
          forwardToProduction: true,
          logRootSpanIds: ["root-without-metadata"],
          experimentNames: [],
        },
        {
          scenarioDirName: "experiment",
          testRunId: "e2e-experiment",
          forwardToProduction: true,
          logRootSpanIds: [],
          experimentNames: ["suite with spaces"],
        },
      ]
        .map((record) =>
          JSON.stringify({ scenarioDirName: "scenario", ...record }),
        )
        .join("\n"),
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/build-pr-e2e-links-comment.mjs", import.meta.url),
        ),
        "--config",
        configPath,
      ],
      {
        env: {
          ...process.env,
          BRAINTRUST_API_KEY: "",
          BRAINTRUST_ORG_NAME: "Test",
          BRAINTRUST_E2E_RUN_CONTEXT_DIR: dir,
        },
      },
    );
    expect(stdout).toContain("e2e-published");
    expect(stdout).toContain("e2e-legacy");
    expect(stdout).not.toContain("e2e-local-only");
    const logRow = stdout
      .split("\n")
      .find((line) => line.startsWith("| Without metadata |"))!;
    const logUrl = new URL(logRow.match(/\]\(([^)]+)\)/)![1]);
    const search = JSON.parse(logUrl.searchParams.get("search")!);
    expect(
      search.filter.map((filter: { text: string }) =>
        decodeURIComponent(filter.text),
      ),
    ).toEqual(['root_span_id IN ("root-without-metadata")']);
    const evalRow = stdout
      .split("\n")
      .find((line) => line.startsWith("| Experiment |"))!;
    expect(evalRow).toContain("/experiments/suite%20with%20spaces");
    expect(evalRow).not.toContain("/logs?");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
