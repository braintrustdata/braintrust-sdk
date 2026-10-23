import { isObject } from "../../../util/index";
import { prepareDecisionAttachments } from "../../decision-attachments";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  WorkersAIInput,
  WorkersAIResult,
} from "../../vendor-sdk-types/workers-ai";
import {
  isAutoCaptureAttachmentsEnabled,
  processInputAttachments,
} from "../../wrappers/attachment-utils";
import { BasePlugin } from "../core";
import { traceAsyncCall, unsubscribeAll } from "../core/tracing";
import { workersAIChannels } from "./workers-ai-interceptors";

const DECISION_MODELS = new Set([
  "@cf/cloudflare/clef",
  "@cf/cloudflare/clef-flash",
  "@cf/cloudflare/clef-omni",
]);

export class WorkersAIPlugin extends BasePlugin {
  protected onEnable(): void {
    this.unsubscribers.push(
      workersAIChannels.run.intercept((target, receiver, args, additional) => {
        const extraction = args[0] === "@cf/cloudflare/clairic";
        return traceAsyncCall<typeof workersAIChannels.run>(
          () => Reflect.apply(target, receiver, args),
          { ...additional, arguments: args, self: receiver },
          {
            name: "workers_ai.run",
            type: extraction ? "task" : "decision",
            instrumentationName: INSTRUMENTATION_NAMES.WORKERS_AI,
            // These models return JSON directly. Do not consume raw bodies or
            // claim to trace an asynchronous submission or unsupported stream.
            shouldTrace: () =>
              (extraction || DECISION_MODELS.has(args[0])) &&
              !args[1]?.stream &&
              !args[2]?.returnRawResponse &&
              !args[2]?.websocket &&
              !args[2]?.queueRequest,
            extractInput: ([model, input]) => ({
              input: prepareWorkersAIInput(input, extraction),
              metadata: {
                model,
                provider: "cloudflare",
                operation: extraction ? "extraction" : "decision",
              },
            }),
            extractOutput: (result) =>
              extraction
                ? {
                    answers: result.answers,
                    ...(result.truncated !== undefined
                      ? { truncated: result.truncated }
                      : {}),
                    ...(result.state_text !== undefined
                      ? { state_text: result.state_text }
                      : {}),
                  }
                : {
                    answers: Object.entries(result.answers ?? {}).map(
                      ([id, answer]) => ({ ...answer, id }),
                    ),
                  },
            extractMetadata: (result) => ({
              ...(typeof result.model === "string"
                ? { model: result.model }
                : {}),
              ...(extraction && result.usage?.passes !== undefined
                ? { passes: result.usage.passes }
                : {}),
            }),
            extractMetrics: extractWorkersAIUsage,
          },
        );
      }),
    );
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }
}

function prepareWorkersAIInput(
  input: WorkersAIInput,
  extraction: boolean,
): unknown {
  const media = Object.fromEntries(
    (["images", "audio", "videos"] as const)
      .filter((key) => input[key] !== undefined)
      .map((key) => [
        key,
        input[key]?.map((item) => {
          const mediaType =
            typeof item === "string"
              ? item.match(/^data:([^;,]+);base64,/i)?.[1]
              : item.content_type;
          return {
            type: "file",
            ...(mediaType ? { mediaType } : {}),
            data: typeof item === "string" ? item : item.base64,
          };
        }),
      ]),
  );
  if (extraction) {
    return processInputAttachments(
      {
        state: input.state,
        fields: input.fields,
        ...media,
        ...(input.reference_date !== undefined
          ? { reference_date: input.reference_date }
          : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
      },
      isAutoCaptureAttachmentsEnabled(),
    );
  }
  // The decision contract keeps all supplied context in state. Keep the
  // provider's separate media arrays alongside its original state there.
  return prepareDecisionAttachments({
    state: Object.keys(media).length
      ? { state: input.state, ...media }
      : input.state,
    questions: Object.entries(input.questions ?? {}).map(([id, question]) => ({
      id,
      type: question.type,
      instructions: question.instructions,
      ...(question.criteria !== undefined
        ? { criteria: question.criteria }
        : {}),
    })),
  });
}

function extractWorkersAIUsage(
  result: WorkersAIResult,
): Record<string, number> {
  const usage = isObject(result.usage) ? result.usage : {};
  const metrics: Record<string, number> = {};
  for (const [source, target] of [
    ["input_tokens", "prompt_tokens"],
    ["output_tokens", "completion_tokens"],
  ] as const) {
    const value = usage[source];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0)
      metrics[target] = value;
  }
  if (
    metrics.prompt_tokens !== undefined &&
    metrics.completion_tokens !== undefined
  ) {
    metrics.tokens = metrics.prompt_tokens + metrics.completion_tokens;
  }
  return metrics;
}
