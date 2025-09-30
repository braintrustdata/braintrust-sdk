import { startSpan, traced, withCurrent } from "../logger";
import { getCurrentUnixTimestamp } from "../util";
import { SpanTypeAttribute } from "../../util/index";
import {
  extractAnthropicCacheTokens,
  finalizeAnthropicTokens,
} from "./anthropic-tokens-util";
import { getNumberProperty } from "./ai-sdk-shared";

/**
 * Types from @anthropic-ai/claude-agent-sdk
 */
type SDKMessage = {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type QueryOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type Query = AsyncGenerator<SDKMessage, void, unknown> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type CallToolResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Array<any>;
  isError?: boolean;
};

type ToolHandler<T> = (
  args: T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra: any,
) => Promise<CallToolResult>;

type SdkMcpToolDefinition<T> = {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any;
  handler: ToolHandler<T>;
};

/**
 * Wraps the Claude Agent SDK's query function to add Braintrust tracing.
 * Traces the entire agent interaction including all streaming messages.
 *
 * @param queryFn - The original query function from @anthropic-ai/claude-agent-sdk
 * @returns A wrapped query function with tracing
 *
 * @example
 * ```typescript
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { wrapClaudeAgentQuery } from "braintrust";
 *
 * const wrappedQuery = wrapClaudeAgentQuery(query);
 *
 * const result = wrappedQuery({
 *   prompt: "Write a hello world function",
 *   options: { model: "claude-3-5-sonnet-20241022" }
 * });
 *
 * for await (const message of result) {
 *   console.log(message);
 * }
 * ```
 */
export function wrapClaudeAgentQuery<
  T extends (...args: unknown[]) => AsyncGenerator<SDKMessage, void, unknown>,
>(queryFn: T, defaultThis?: unknown): T {
  const proxy = new Proxy(queryFn, {
    apply(target, thisArg, argArray) {
      const params = (argArray[0] ?? {}) as {
        prompt?: string | AsyncIterable<SDKMessage>;
        options?: QueryOptions;
      };

      const { prompt, options = {} } = params;

      const span = startSpan({
        name: "Claude Agent",
        spanAttributes: {
          type: SpanTypeAttribute.TASK,
        },
        event: {
          input:
            typeof prompt === "string"
              ? prompt
              : { type: "streaming", description: "AsyncIterable<SDKMessage>" },
          metadata: options,
        },
      });

      let ended = false;
      const finalResults: Array<{ content: unknown; role: string }> = [];

      // Track messages by message.message.id to group streaming updates
      let currentMessageId: string | undefined;
      let currentMessageStartTime = getCurrentUnixTimestamp();
      const currentMessages: SDKMessage[] = [];

      const endSpan = () => {
        if (!ended) {
          ended = true;
          span.end();
        }
      };

      // Create an LLM span for accumulated messages with the same message ID.
      // LLM spans can contain multiple streaming message updates. We create the span
      // when we proceed to a new message ID or when the query completes.
      const createLLMSpan = async () => {
        const finalMessageContent = await _createLLMSpanForMessages(
          currentMessages,
          prompt,
          finalResults,
          options,
          currentMessageStartTime,
          await span.export(),
        );

        if (finalMessageContent) {
          finalResults.push(finalMessageContent);
        }

        currentMessages.length = 0;
      };

      // Create wrapped async generator that maintains span context
      const wrappedGenerator = (async function* () {
        try {
          const invocationTarget =
            thisArg === proxy || thisArg === undefined
              ? defaultThis ?? thisArg
              : thisArg;

          const generator = withCurrent(span, () =>
            Reflect.apply(target, invocationTarget, argArray),
          );

          for await (const message of generator) {
            const currentTime = getCurrentUnixTimestamp();

            // Check if this is a new message ID
            const messageId = message.message?.id;
            if (messageId && messageId !== currentMessageId) {
              // Create span for previous message group
              await createLLMSpan();

              // Start new message group
              currentMessageId = messageId;
              currentMessageStartTime = currentTime;
            }

            // Accumulate messages for the current message ID
            if (message.type === "assistant" && message.message?.usage) {
              currentMessages.push(message);
            }

            yield message;
          }

          // Create span for final message group
          await createLLMSpan();

          // Log final output to top-level span - just the last message content
          span.log({
            output:
              finalResults.length > 0
                ? finalResults[finalResults.length - 1]
                : undefined,
          });
        } catch (error) {
          span.log({
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          endSpan();
        }
      })();

      // Return the generator directly - avoid Proxy for compatibility
      return wrappedGenerator as ReturnType<T>;
    },
  });

  return proxy;
}

/**
 * Wraps a Claude Agent SDK tool definition to add Braintrust tracing for tool executions.
 *
 * @param toolDef - The tool definition created with the SDK's `tool()` function
 * @returns A wrapped tool definition with traced handler
 *
 * @example
 * ```typescript
 * import { tool } from "@anthropic-ai/claude-agent-sdk";
 * import { wrapClaudeAgentTool } from "braintrust";
 * import { z } from "zod";
 *
 * const myTool = tool(
 *   "calculator",
 *   "Performs basic arithmetic",
 *   { operation: z.enum(["add", "subtract"]), a: z.number(), b: z.number() },
 *   async (args) => ({
 *     content: [{ type: "text", text: String(args.a + args.b) }]
 *   })
 * );
 *
 * const wrappedTool = wrapClaudeAgentTool(myTool);
 * ```
 */
export function wrapClaudeAgentTool<T>(
  toolDef: SdkMcpToolDefinition<T>,
): SdkMcpToolDefinition<T> {
  const originalHandler = toolDef.handler;

  const wrappedHandler: ToolHandler<T> = (args, extra) =>
    traced(
      async (span) => {
        span.log({
          input: args,
          metadata: {
            tool_name: toolDef.name,
            tool_description: toolDef.description,
          },
        });

        const result = await originalHandler(args, extra);

        span.log({
          output: result.content,
          metadata: {
            is_error: result.isError ?? false,
          },
        });

        return result;
      },
      {
        name: `${toolDef.name}`,
        spanAttributes: {
          type: SpanTypeAttribute.TOOL,
        },
      },
    );

  return {
    ...toolDef,
    handler: wrappedHandler,
  };
}

/**
 * Wraps all tools in an array of Claude Agent SDK tool definitions.
 *
 * @param tools - Array of tool definitions
 * @returns Array of wrapped tool definitions with tracing
 */
export function wrapClaudeAgentTools<T>(
  tools: Array<SdkMcpToolDefinition<T>>,
): Array<SdkMcpToolDefinition<T>> {
  return tools.map(wrapClaudeAgentTool);
}

/**
 * Builds the input array for an LLM span from the initial prompt and conversation history.
 */
function _buildLLMInput(
  prompt: string | AsyncIterable<SDKMessage> | undefined,
  conversationHistory: Array<{ content: unknown; role: string }>,
): Array<{ content: unknown; role: string }> | undefined {
  const promptMessage =
    typeof prompt === "string" ? { content: prompt, role: "user" } : undefined;

  const inputParts = [
    ...(promptMessage ? [promptMessage] : []),
    ...conversationHistory,
  ];

  return inputParts.length > 0 ? inputParts : undefined;
}

/**
 * Extracts content from multiple SDK messages, filtering out undefined values.
 */
function _extractMessagesContent(
  messages: SDKMessage[],
): Array<{ content: unknown; role: string }> {
  return messages
    .map(_extractMessageContent)
    .filter((c): c is { content: unknown; role: string } => c !== undefined);
}

/**
 * Extracts content and role from SDK messages.
 */
function _extractMessageContent(
  message: SDKMessage,
): { content: unknown; role: string } | undefined {
  if (message.message?.content && message.message?.role) {
    return {
      content: message.message.content,
      role: message.message.role,
    };
  }

  return undefined;
}

/**
 * Extracts and normalizes usage metrics from a Claude Agent SDK message.
 * Handles Anthropic's cache token format from both assistant and result messages.
 */
function _extractUsageFromMessage(message: SDKMessage): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Assistant messages contain usage in message.message.usage
  // Result messages contain usage in message.usage
  let usage: unknown;
  if (message.type === "assistant" && message.message?.usage) {
    usage = message.message.usage;

    // Standard token counts
    const inputTokens = getNumberProperty(usage, "input_tokens");
    if (inputTokens !== undefined) {
      metrics.prompt_tokens = inputTokens;
    }

    const outputTokens = getNumberProperty(usage, "output_tokens");
    if (outputTokens !== undefined) {
      metrics.completion_tokens = outputTokens;
    }

    // Anthropic cache tokens
    const cacheReadTokens =
      getNumberProperty(usage, "cache_read_input_tokens") || 0;
    const cacheCreationTokens =
      getNumberProperty(usage, "cache_creation_input_tokens") || 0;

    if (cacheReadTokens > 0 || cacheCreationTokens > 0) {
      const cacheTokens = extractAnthropicCacheTokens(
        cacheReadTokens,
        cacheCreationTokens,
      );
      Object.assign(metrics, cacheTokens);
    }

    // Finalize Anthropic token calculations
    if (Object.keys(metrics).length > 0) {
      Object.assign(metrics, finalizeAnthropicTokens(metrics));
    }
  }

  return metrics;
}

/**
 * Creates an LLM span for a group of messages with the same message ID.
 * Returns the final message content to add to conversation history.
 */
async function _createLLMSpanForMessages(
  messages: SDKMessage[],
  prompt: string | AsyncIterable<SDKMessage> | undefined,
  conversationHistory: Array<{ content: unknown; role: string }>,
  options: QueryOptions,
  startTime: number,
  parentSpan: Awaited<ReturnType<typeof startSpan>>["export"] extends (
    ...args: infer _
  ) => Promise<infer R>
    ? R
    : never,
): Promise<{ content: unknown; role: string } | undefined> {
  if (messages.length === 0) return undefined;

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.type !== "assistant" || !lastMessage.message?.usage) {
    return undefined;
  }

  const model = lastMessage.message.model || options.model;
  const usage = _extractUsageFromMessage(lastMessage);
  const input = _buildLLMInput(prompt, conversationHistory);
  const outputs = _extractMessagesContent(messages);

  await traced(
    (llmSpan) => {
      llmSpan.log({
        input,
        output: outputs,
        metadata: model ? { model } : undefined,
        metrics: usage,
      });
    },
    {
      name: "anthropic.messages.create",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      startTime,
      parent: parentSpan,
    },
  );

  return _extractMessageContent(lastMessage);
}

/**
 * Wraps the Claude Agent SDK with Braintrust tracing. This returns wrapped versions
 * of query and tool that automatically trace all agent interactions.
 *
 * @param sdk - The Claude Agent SDK module
 * @returns Object with wrapped query, tool, and createSdkMcpServer functions
 *
 * @example
 * ```typescript
 * import * as claudeSDK from "@anthropic-ai/claude-agent-sdk";
 * import { wrapClaudeAgentSDK } from "braintrust";
 *
 * // Wrap once - returns { query, tool, createSdkMcpServer } with tracing built-in
 * const { query, tool, createSdkMcpServer } = wrapClaudeAgentSDK(claudeSDK);
 *
 * // Use normally - tracing is automatic
 * for await (const message of query({
 *   prompt: "Hello, Claude!",
 *   options: { model: "claude-3-5-sonnet-20241022" }
 * })) {
 *   console.log(message);
 * }
 *
 * // Tools created with wrapped tool() are automatically traced
 * const calculator = tool("calculator", "Does math", schema, handler);
 * ```
 */
export function wrapClaudeAgentSDK<T extends object>(sdk: T): T {
  const cache = new Map<PropertyKey, unknown>();

  return new Proxy(sdk, {
    get(target, prop, receiver) {
      if (cache.has(prop)) {
        return cache.get(prop);
      }

      const value = Reflect.get(target, prop, receiver);

      if (prop === "query" && typeof value === "function") {
        const wrappedQuery = wrapClaudeAgentQuery(
          value as (
            ...args: unknown[]
          ) => AsyncGenerator<SDKMessage, void, unknown>,
          target,
        );
        cache.set(prop, wrappedQuery);
        return wrappedQuery;
      }

      if (prop === "tool" && typeof value === "function") {
        const toolFn = value as typeof value;

        const wrappedToolFactory = new Proxy(toolFn, {
          apply(toolTarget, thisArg, argArray) {
            const invocationTarget =
              thisArg === receiver || thisArg === undefined ? target : thisArg;

            const toolDef = Reflect.apply(
              toolTarget,
              invocationTarget,
              argArray,
            );
            if (
              toolDef &&
              typeof toolDef === "object" &&
              "handler" in toolDef
            ) {
              return wrapClaudeAgentTool(
                toolDef as SdkMcpToolDefinition<unknown>,
              );
            }
            return toolDef;
          },
        });

        cache.set(prop, wrappedToolFactory);
        return wrappedToolFactory;
      }

      if (typeof value === "function") {
        const bound = (value as Function).bind(target);
        cache.set(prop, bound);
        return bound;
      }

      return value;
    },
  }) as T;
}
