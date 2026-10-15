import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  LangSmithBatchIngestRuns,
  LangSmithClient,
  LangSmithRun,
} from "../../vendor-sdk-types/langsmith";

export const langSmithChannels: {
  createRun: MaterializedChannel<
    ChannelSpec<
      [run: LangSmithRun, options?: unknown],
      Awaited<ReturnType<NonNullable<LangSmithClient["createRun"]>>>,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  updateRun: MaterializedChannel<
    ChannelSpec<
      [runId: string, run: LangSmithRun, options?: unknown],
      Awaited<ReturnType<NonNullable<LangSmithClient["updateRun"]>>>,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  batchIngestRuns: MaterializedChannel<
    ChannelSpec<
      [runs: LangSmithBatchIngestRuns, options?: unknown],
      Awaited<ReturnType<NonNullable<LangSmithClient["batchIngestRuns"]>>>,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "langsmith",
    {
      createRun: channel<
        [run: LangSmithRun, options?: unknown],
        Awaited<ReturnType<NonNullable<LangSmithClient["createRun"]>>>
      >({
        channelName: "Client.createRun",
        kind: "async",
      }),
      updateRun: channel<
        [runId: string, run: LangSmithRun, options?: unknown],
        Awaited<ReturnType<NonNullable<LangSmithClient["updateRun"]>>>
      >({
        channelName: "Client.updateRun",
        kind: "async",
      }),
      batchIngestRuns: channel<
        [runs: LangSmithBatchIngestRuns, options?: unknown],
        Awaited<ReturnType<NonNullable<LangSmithClient["batchIngestRuns"]>>>
      >({
        channelName: "Client.batchIngestRuns",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.LANGSMITH },
  ))();
