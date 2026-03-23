import { expect, test } from "vitest";
import { assertAnthropicTraceContract } from "../../helpers/anthropic-trace-contract";
import {
  formatJsonFileSnapshot,
  resolveFileSnapshotPath,
} from "../../helpers/file-snapshot";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 90_000;
const sharedSpanSnapshotPath = resolveFileSnapshotPath(
  import.meta.url,
  "span-events.json",
);
const sharedPayloadSnapshotPath = resolveFileSnapshotPath(
  import.meta.url,
  "log-payloads.json",
);

type AnthropicContract = ReturnType<typeof assertAnthropicTraceContract>;

let wrapperContractPromise: Promise<AnthropicContract> | undefined;
let autoContractPromise: Promise<AnthropicContract> | undefined;

function getWrapperContract(): Promise<AnthropicContract> {
  wrapperContractPromise ??= (async () => {
    let contract: AnthropicContract | undefined;

    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      contract = assertAnthropicTraceContract({
        capturedEvents: events(),
        rootName: "anthropic-wrapper-root",
        scenarioName: "wrap-anthropic-message-traces",
      });
    });

    if (!contract) {
      throw new Error("Failed to capture Anthropic wrapper contract");
    }

    return contract;
  })();

  return wrapperContractPromise;
}

function getAutoContract(): Promise<AnthropicContract> {
  autoContractPromise ??= (async () => {
    let contract: AnthropicContract | undefined;

    await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: TIMEOUT_MS,
      });

      contract = assertAnthropicTraceContract({
        capturedEvents: events(),
        rootName: "anthropic-wrapper-root",
        scenarioName: "wrap-anthropic-message-traces",
      });
    });

    if (!contract) {
      throw new Error(
        "Failed to capture Anthropic auto-instrumentation contract",
      );
    }

    return contract;
  })();

  return autoContractPromise;
}

test(
  "wrap-anthropic-message-traces captures create, stream, beta, attachment, and tool spans",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    const contract = await getWrapperContract();

    await expect(
      formatJsonFileSnapshot(contract.spanSummary),
    ).toMatchFileSnapshot(sharedSpanSnapshotPath);
    await expect(
      formatJsonFileSnapshot(contract.payloadSummary),
    ).toMatchFileSnapshot(sharedPayloadSnapshotPath);
  },
);

test(
  "anthropic auto-instrumentation via node hook matches the wrapper trace contract",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    const [wrapperContract, autoContract] = await Promise.all([
      getWrapperContract(),
      getAutoContract(),
    ]);

    expect(autoContract.payloadSummary).toEqual(wrapperContract.payloadSummary);
    expect(autoContract.spanSummary).toEqual(wrapperContract.spanSummary);

    await expect(
      formatJsonFileSnapshot(autoContract.spanSummary),
    ).toMatchFileSnapshot(sharedSpanSnapshotPath);
    await expect(
      formatJsonFileSnapshot(autoContract.payloadSummary),
    ).toMatchFileSnapshot(sharedPayloadSnapshotPath);
  },
);
