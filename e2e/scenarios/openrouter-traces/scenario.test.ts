import { expect, test } from "vitest";
import { assertOpenRouterTraceContract } from "../../helpers/openrouter-trace-contract";
import { resolveFileSnapshotPath } from "../../helpers/file-snapshot";
import {
  prepareScenarioDir,
  readInstalledPackageVersion,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const openrouterSdkVersion = await readInstalledPackageVersion(
  scenarioDir,
  "@openrouter/sdk",
);
const TIMEOUT_MS = 90_000;
const sharedSpanSnapshotPath = resolveFileSnapshotPath(
  import.meta.url,
  "span-events.json",
);

type OpenRouterContract = ReturnType<typeof assertOpenRouterTraceContract>;

let wrapperContractPromise: Promise<OpenRouterContract> | undefined;
let autoContractPromise: Promise<OpenRouterContract> | undefined;

function getWrapperContract(): Promise<OpenRouterContract> {
  wrapperContractPromise ??= (async () => {
    let contract: OpenRouterContract | undefined;

    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      contract = assertOpenRouterTraceContract({
        capturedEvents: events(),
        rootName: "openrouter-wrapper-root",
        scenarioName: "openrouter-traces",
        snapshotRootName: "openrouter-root",
        version: openrouterSdkVersion,
      });
    });

    if (!contract) {
      throw new Error("Failed to capture OpenRouter wrapper contract");
    }

    return contract;
  })();

  return wrapperContractPromise;
}

function getAutoContract(): Promise<OpenRouterContract> {
  autoContractPromise ??= (async () => {
    let contract: OpenRouterContract | undefined;

    await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: TIMEOUT_MS,
      });

      contract = assertOpenRouterTraceContract({
        capturedEvents: events(),
        rootName: "openrouter-auto-hook-root",
        scenarioName: "openrouter-traces",
        snapshotRootName: "openrouter-root",
        version: openrouterSdkVersion,
      });
    });

    if (!contract) {
      throw new Error(
        "Failed to capture OpenRouter auto-instrumentation contract",
      );
    }

    return contract;
  })();

  return autoContractPromise;
}

test(
  "wrap-openrouter-traces captures wrapper instrumentation",
  {
    tags: [E2E_TAGS.externalApi],
  },
  async () => {
    const contract = await getWrapperContract();

    await expect(
      `${JSON.stringify(contract.spanSummary, null, 2)}\n`,
    ).toMatchFileSnapshot(sharedSpanSnapshotPath);
  },
  TIMEOUT_MS,
);

test(
  "openrouter auto-instrumentation via node hook collects traces without manual wrapping",
  {
    tags: [E2E_TAGS.externalApi],
  },
  async () => {
    const [wrapperContract, autoContract] = await Promise.all([
      getWrapperContract(),
      getAutoContract(),
    ]);

    expect(autoContract.spanSummary).toEqual(wrapperContract.spanSummary);

    await expect(
      `${JSON.stringify(autoContract.spanSummary, null, 2)}\n`,
    ).toMatchFileSnapshot(sharedSpanSnapshotPath);
  },
  TIMEOUT_MS,
);
