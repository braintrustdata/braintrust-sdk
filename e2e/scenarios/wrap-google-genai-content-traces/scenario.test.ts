import { expect, test } from "vitest";
import { assertGoogleGenAITraceContract } from "../../helpers/google-genai-trace-contract";
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

const TIMEOUT_MS = 90_000;
const SHARED_ROOT_NAME = "google-genai-root";
const SHARED_SCENARIO_NAME = "google-genai-traces";
const sharedSpanSnapshotPath = resolveFileSnapshotPath(
  import.meta.url,
  "span-events.json",
);
const sharedPayloadSnapshotPath = resolveFileSnapshotPath(
  import.meta.url,
  "log-payloads.json",
);

type GoogleGenAIContract = ReturnType<typeof assertGoogleGenAITraceContract>;

let wrapperScenarioDirPromise: Promise<string> | undefined;
let autoScenarioDirPromise: Promise<string> | undefined;
let wrapperContractPromise: Promise<GoogleGenAIContract> | undefined;
let autoContractPromise: Promise<GoogleGenAIContract> | undefined;

function getWrapperScenarioDir(): Promise<string> {
  wrapperScenarioDirPromise ??= prepareScenarioDir({
    scenarioDir: resolveScenarioDir(import.meta.url),
  });

  return wrapperScenarioDirPromise;
}

function getAutoScenarioDir(): Promise<string> {
  autoScenarioDirPromise ??= prepareScenarioDir({
    scenarioDir: resolveScenarioDir(
      new URL(
        "../google-genai-auto-instrumentation-node-hook/scenario.mjs",
        import.meta.url,
      ).href,
    ),
  });

  return autoScenarioDirPromise;
}

function getWrapperContract(): Promise<GoogleGenAIContract> {
  wrapperContractPromise ??= (async () => {
    let contract: GoogleGenAIContract | undefined;
    const wrapperScenarioDir = await getWrapperScenarioDir();

    await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
      await runScenarioDir({
        scenarioDir: wrapperScenarioDir,
        timeoutMs: TIMEOUT_MS,
      });

      contract = assertGoogleGenAITraceContract({
        capturedEvents: events(),
        payloads: payloads(),
        rootName: "google-genai-wrapper-root",
        scenarioName: "wrap-google-genai-content-traces",
        snapshotRootName: SHARED_ROOT_NAME,
        snapshotScenarioName: SHARED_SCENARIO_NAME,
      });
    });

    if (!contract) {
      throw new Error("Failed to capture Google GenAI wrapper contract");
    }

    return contract;
  })();

  return wrapperContractPromise;
}

function getAutoContract(): Promise<GoogleGenAIContract> {
  autoContractPromise ??= (async () => {
    let contract: GoogleGenAIContract | undefined;
    const autoScenarioDir = await getAutoScenarioDir();

    await withScenarioHarness(
      async ({ events, payloads, runNodeScenarioDir }) => {
        await runNodeScenarioDir({
          nodeArgs: ["--import", "braintrust/hook.mjs"],
          scenarioDir: autoScenarioDir,
          timeoutMs: TIMEOUT_MS,
        });

        contract = assertGoogleGenAITraceContract({
          capturedEvents: events(),
          payloads: payloads(),
          rootName: "google-genai-auto-hook-root",
          scenarioName: "google-genai-auto-instrumentation-node-hook",
          snapshotRootName: SHARED_ROOT_NAME,
          snapshotScenarioName: SHARED_SCENARIO_NAME,
        });
      },
    );

    if (!contract) {
      throw new Error(
        "Failed to capture Google GenAI auto-instrumentation contract",
      );
    }

    return contract;
  })();

  return autoContractPromise;
}

test(
  "wrap-google-genai-content-traces captures the shared Google GenAI trace contract",
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
  "google genai auto-instrumentation via node hook matches wrapper instrumentation",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    const [wrapperContract, autoContract] = await Promise.all([
      getWrapperContract(),
      getAutoContract(),
    ]);

    expect(autoContract.spanSummary).toEqual(wrapperContract.spanSummary);
    expect(autoContract.payloadSummary).toEqual(wrapperContract.payloadSummary);

    await expect(
      formatJsonFileSnapshot(autoContract.spanSummary),
    ).toMatchFileSnapshot(sharedSpanSnapshotPath);
    await expect(
      formatJsonFileSnapshot(autoContract.payloadSummary),
    ).toMatchFileSnapshot(sharedPayloadSnapshotPath);
  },
);
