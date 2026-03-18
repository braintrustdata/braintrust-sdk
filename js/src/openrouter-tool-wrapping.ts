import { openRouterChannels } from "./instrumentation/plugins/openrouter-channels";
import type { ChannelMessage } from "./instrumentation/core/channel-definitions";
import type {
  OpenRouterCallModelRequest,
  OpenRouterTool,
  OpenRouterToolTurnContext,
} from "./vendor-sdk-types/openrouter";

const OPENROUTER_WRAPPED_TOOL = Symbol("braintrust.openrouter.wrappedTool");

type OpenRouterToolTraceContext = ChannelMessage<
  typeof openRouterChannels.toolExecute
>;

type WrappedOpenRouterTool = OpenRouterTool & {
  [OPENROUTER_WRAPPED_TOOL]?: true;
};

export function patchOpenRouterCallModelRequestTools(
  request: OpenRouterCallModelRequest,
): (() => void) | undefined {
  if (!Array.isArray(request.tools) || request.tools.length === 0) {
    return undefined;
  }

  const originalTools = request.tools;
  const wrappedTools = originalTools.map((tool) => wrapOpenRouterTool(tool));
  const didPatch = wrappedTools.some(
    (tool, index) => tool !== originalTools[index],
  );
  if (!didPatch) {
    return undefined;
  }

  (request as { tools?: readonly OpenRouterTool[] }).tools = wrappedTools;
  return () => {
    (request as { tools?: readonly OpenRouterTool[] }).tools = originalTools;
  };
}

export function wrapOpenRouterTool(tool: OpenRouterTool): OpenRouterTool {
  if (
    isWrappedTool(tool) ||
    !tool.function ||
    typeof tool.function !== "object" ||
    typeof tool.function.execute !== "function"
  ) {
    return tool;
  }

  const toolName = tool.function.name || "tool";
  const originalExecute = tool.function.execute;
  const wrappedTool: WrappedOpenRouterTool = {
    ...tool,
    function: {
      ...tool.function,
      execute(this: unknown, ...args: unknown[]) {
        return traceToolExecution({
          args,
          execute: () => Reflect.apply(originalExecute, this, args),
          toolCallId: getToolCallId(args[1]),
          toolName,
        });
      },
    },
  };

  Object.defineProperty(wrappedTool, OPENROUTER_WRAPPED_TOOL, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  return wrappedTool;
}

function isWrappedTool(tool: OpenRouterTool): boolean {
  return Boolean((tool as WrappedOpenRouterTool)[OPENROUTER_WRAPPED_TOOL]);
}

function traceToolExecution(args: {
  args: unknown[];
  execute: () => unknown;
  toolCallId?: string;
  toolName: string;
}): unknown {
  const tracingChannel = openRouterChannels.toolExecute.tracingChannel();
  const input = args.args.length > 0 ? args.args[0] : undefined;
  const event: OpenRouterToolTraceContext = {
    arguments: [input],
    span_info: {
      name: args.toolName,
    },
    toolCallId: args.toolCallId,
    toolName: args.toolName,
  };

  tracingChannel.start!.publish(event);

  try {
    const result = args.execute();
    return publishToolResult(tracingChannel, event, result);
  } catch (error) {
    event.error = normalizeError(error);
    tracingChannel.error!.publish(event);
    throw error;
  }
}

function publishToolResult(
  tracingChannel: ReturnType<
    typeof openRouterChannels.toolExecute.tracingChannel
  >,
  event: OpenRouterToolTraceContext,
  result: unknown,
): unknown {
  if (isPromiseLike(result)) {
    return result.then(
      (resolved) => {
        event.result = resolved;
        tracingChannel.asyncEnd!.publish(event);
        return resolved;
      },
      (error) => {
        event.error = normalizeError(error);
        tracingChannel.error!.publish(event);
        throw error;
      },
    );
  }

  event.result = result;
  tracingChannel.asyncEnd!.publish(event);
  return result;
}

function getToolCallId(context: unknown): string | undefined {
  const toolContext = context as OpenRouterToolTurnContext | undefined;
  return typeof toolContext?.toolCall?.id === "string"
    ? toolContext.toolCall.id
    : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
