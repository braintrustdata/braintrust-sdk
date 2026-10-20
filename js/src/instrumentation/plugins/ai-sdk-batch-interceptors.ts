import { channel, defineInterceptor } from "../core/interceptor-definitions";
import type {
  AISDKBatchAPI,
  AISDKBatchReference,
} from "../../vendor-sdk-types/ai-sdk-batch";

type BatchHookContext = { denyOutputPaths?: string[] };

export const aiSDKBatchChannels = defineInterceptor("ai", {
  startBatch: channel<
    Parameters<AISDKBatchAPI["experimental_startBatch"]>,
    ReturnType<AISDKBatchAPI["experimental_startBatch"]>,
    BatchHookContext
  >({ channelName: "startBatch" }),
  getBatchStatus: channel<
    Parameters<AISDKBatchAPI["experimental_getBatchStatus"]>,
    ReturnType<AISDKBatchAPI["experimental_getBatchStatus"]>
  >({ channelName: "getBatchStatus" }),
  getBatchResults: channel<
    Parameters<AISDKBatchAPI["experimental_getBatchResults"]>,
    ReturnType<AISDKBatchAPI["experimental_getBatchResults"]>,
    BatchHookContext
  >({ channelName: "getBatchResults" }),
  cancelBatch: channel<
    Parameters<AISDKBatchAPI["experimental_cancelBatch"]>,
    ReturnType<AISDKBatchAPI["experimental_cancelBatch"]>
  >({ channelName: "cancelBatch" }),
  exportTrace: channel<[AISDKBatchReference], Promise<string | undefined>>({
    channelName: "batch.exportTrace",
  }),
  resumeTrace: channel<[string], Promise<void>>({
    channelName: "batch.resumeTrace",
  }),
});
