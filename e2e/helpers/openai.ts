import type { CapturedLogEvent } from "./mock-braintrust-server";
import type { Json } from "./normalize";
import { readInstalledPackageVersion } from "./scenario-installer";

interface OpenAIScenario {
  chatHelperNamespace: "beta" | "ga";
  dependencyName: string;
  entry: string;
  version: string;
}

const OPENAI_VERSION_SPECS = [
  {
    chatHelperNamespace: "beta",
    dependencyName: "openai-v4",
    suffix: "v4",
  },
  {
    chatHelperNamespace: "ga",
    dependencyName: "openai-v5",
    suffix: "v5",
  },
  {
    chatHelperNamespace: "ga",
    dependencyName: "openai",
    suffix: "v6",
  },
] as const;

export const OPENAI_SCENARIO_TIMEOUT_MS = 60_000;

export async function getOpenAIAutoHookScenarios(
  scenarioDir: string,
): Promise<
  Array<Pick<OpenAIScenario, "dependencyName" | "entry" | "version">>
> {
  return await Promise.all(
    OPENAI_VERSION_SPECS.map(async ({ dependencyName, suffix }) => ({
      dependencyName,
      entry: `scenario.openai-${suffix}.mjs`,
      version: await readInstalledPackageVersion(scenarioDir, dependencyName),
    })),
  );
}

export async function getWrapOpenAIScenarios(
  scenarioDir: string,
): Promise<OpenAIScenario[]> {
  return await Promise.all(
    OPENAI_VERSION_SPECS.map(
      async ({ chatHelperNamespace, dependencyName, suffix }) => ({
        chatHelperNamespace,
        dependencyName,
        entry: `scenario.openai-${suffix}.ts`,
        version: await readInstalledPackageVersion(scenarioDir, dependencyName),
      }),
    ),
  );
}

export function summarizeOpenAIContract(event: CapturedLogEvent): Json {
  const metadata = event.row.metadata as
    | {
        metadata?: { operation?: string };
        model?: string;
        openaiSdkVersion?: string;
        provider?: string;
        scenario?: string;
      }
    | undefined;

  return {
    has_input: event.input !== undefined && event.input !== null,
    has_output: event.output !== undefined && event.output !== null,
    metadata: {
      has_model: typeof metadata?.model === "string",
      openaiSdkVersion: metadata?.openaiSdkVersion ?? null,
      operation: metadata?.metadata?.operation ?? null,
      provider: metadata?.provider ?? null,
      scenario: metadata?.scenario ?? null,
    },
    metric_keys: Object.keys(event.metrics ?? {})
      .filter((key) => key !== "start" && key !== "end")
      .sort(),
    name: event.span.name ?? null,
    root_span_id: event.span.rootId ?? null,
    span_id: event.span.id ?? null,
    span_parents: event.span.parentIds,
    type: event.span.type ?? null,
  } satisfies Json;
}
