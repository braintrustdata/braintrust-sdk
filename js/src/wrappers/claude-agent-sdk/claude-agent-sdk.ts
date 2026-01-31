import { startSpan, traced, withCurrent } from "../../logger";
import { getCurrentUnixTimestamp } from "../../util";
import { SpanTypeAttribute } from "../../../util/index";
import {
  extractAnthropicCacheTokens,
  finalizeAnthropicTokens,
} from "../anthropic-tokens-util";

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
 * Hook types from @anthropic-ai/claude-agent-sdk
 */
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SubagentStart"
  | "SubagentStop";

type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
};

type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;
};

type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
};

type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  error: string;
  is_interrupt?: boolean;
};

type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
};

type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: "SubagentStop";
  agent_id: string;
  agent_transcript_path?: string;
  stop_hook_active?: boolean;
};

type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput;

type HookJSONOutput = {
  continue?: boolean;
  decision?: "approve" | "block";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput>;

type HookCallbackMatcher = {
  matcher?: string;
  hooks: HookCallback[];
};

/**
 * Parsed MCP tool name components.
 */
type ParsedToolName = {
  /** Display name for spans (e.g., "math/calculator" or raw name if not MCP) */
  displayName: string;
  /** The actual tool name without MCP prefix */
  toolName: string;
  /** MCP server name, if this is an MCP tool */
  mcpServer?: string;
  /** The raw tool name as provided by the SDK */
  rawToolName: string;
};

/**
 * Parses MCP tool names in the format "mcp__<server>__<tool>" into components.
 * Falls back to using the raw name if parsing fails.
 */
function parseToolName(rawToolName: string): ParsedToolName {
  // MCP tools follow the pattern: mcp__<server>__<tool>
  const mcpMatch = rawToolName.match(/^mcp__([^_]+)__(.+)$/);

  if (mcpMatch) {
    const [, mcpServer, toolName] = mcpMatch;
    return {
      displayName: `tool: ${mcpServer}/${toolName}`,
      toolName,
      mcpServer,
      rawToolName,
    };
  }

  // Not an MCP tool, use raw name with "tool:" prefix
  return {
    displayName: `tool: ${rawToolName}`,
    toolName: rawToolName,
    rawToolName,
  };
}

/**
 * Creates PreToolUse, PostToolUse, and PostToolUseFailure hooks for tracing all tool calls (including remote MCPs).
 * The hooks use toolUseID to correlate pre/post events and manage span lifecycle.
 */
function createToolTracingHooks(
  parentSpanExportPromise: Promise<
    Awaited<ReturnType<ReturnType<typeof startSpan>["export"]>>
  >,
  activeToolSpans: Map<string, ReturnType<typeof startSpan>>,
): {
  preToolUse: HookCallback;
  postToolUse: HookCallback;
  postToolUseFailure: HookCallback;
} {
  const preToolUse: HookCallback = async (input, toolUseID) => {
    if (input.hook_event_name !== "PreToolUse" || !toolUseID) {
      return {};
    }

    const parsed = parseToolName(input.tool_name);
    const parentExport = await parentSpanExportPromise;
    const toolSpan = startSpan({
      name: parsed.displayName,
      spanAttributes: { type: SpanTypeAttribute.TOOL },
      event: {
        input: input.tool_input,
        metadata: {
          // GenAI semantic conventions
          "gen_ai.tool.name": parsed.toolName,
          "gen_ai.tool.call.id": toolUseID,
          // MCP-specific metadata (if applicable)
          ...(parsed.mcpServer && { "mcp.server": parsed.mcpServer }),
          // Raw tool name for debugging
          raw_tool_name: parsed.rawToolName,
          // Session context
          session_id: input.session_id,
          cwd: input.cwd,
        },
      },
      parent: parentExport,
    });

    activeToolSpans.set(toolUseID, toolSpan);
    return {};
  };

  const postToolUse: HookCallback = async (input, toolUseID) => {
    if (input.hook_event_name !== "PostToolUse" || !toolUseID) {
      return {};
    }

    const toolSpan = activeToolSpans.get(toolUseID);
    if (!toolSpan) {
      return {};
    }

    try {
      toolSpan.log({ output: input.tool_response });
      toolSpan.end();
    } finally {
      activeToolSpans.delete(toolUseID);
    }
    return {};
  };

  const postToolUseFailure: HookCallback = async (input, toolUseID) => {
    if (input.hook_event_name !== "PostToolUseFailure" || !toolUseID) {
      return {};
    }

    const toolSpan = activeToolSpans.get(toolUseID);
    if (!toolSpan) {
      return {};
    }

    const parsed = parseToolName(input.tool_name);
    try {
      toolSpan.log({
        error: input.error,
        metadata: {
          "gen_ai.tool.name": parsed.toolName,
          "gen_ai.tool.call.id": toolUseID,
          ...(parsed.mcpServer && { "mcp.server": parsed.mcpServer }),
          is_interrupt: input.is_interrupt,
          session_id: input.session_id,
        },
      });
      toolSpan.end();
    } finally {
      activeToolSpans.delete(toolUseID);
    }
    return {};
  };

  return { preToolUse, postToolUse, postToolUseFailure };
}

/**
 * Creates SubagentStart and SubagentStop hooks for tracing subagent executions.
 * The hooks use agent_id to correlate start/stop events and manage span lifecycle.
 */
function createSubagentTracingHooks(
  parentSpanExportPromise: Promise<
    Awaited<ReturnType<ReturnType<typeof startSpan>["export"]>>
  >,
  activeSubagentSpans: Map<string, ReturnType<typeof startSpan>>,
  activeToolSpans: Map<string, ReturnType<typeof startSpan>>,
): { subagentStart: HookCallback; subagentStop: HookCallback } {
  // Note: SubagentStart hook is not reliably called by the SDK (see GitHub issue #14859).
  // The Task tool spawn is already traced via PreToolUse/PostToolUse.
  const subagentStart: HookCallback = async (input) => {
    if (input.hook_event_name !== "SubagentStart") {
      return {};
    }

    const parentExport = await parentSpanExportPromise;
    const subagentSpan = startSpan({
      name: `Subagent: ${input.agent_type}`,
      spanAttributes: { type: SpanTypeAttribute.TASK },
      event: {
        metadata: {
          agent_id: input.agent_id,
          agent_type: input.agent_type,
          session_id: input.session_id,
          cwd: input.cwd,
          transcript_path: input.transcript_path,
        },
      },
      parent: parentExport,
    });

    activeSubagentSpans.set(input.agent_id, subagentSpan);
    return {};
  };

  // SubagentStop is called but without agent_id in current SDK (GitHub issue #14859).
  // We use toolUseID to add metadata to the existing Task tool span.
  const subagentStop: HookCallback = async (input, toolUseID) => {
    if (input.hook_event_name !== "SubagentStop") {
      return {};
    }

    // If SubagentStart was called, close the subagent span
    if (input.agent_id) {
      const subagentSpan = activeSubagentSpans.get(input.agent_id);
      if (!subagentSpan) {
        return {};
      }

      try {
        subagentSpan.log({
          metadata: {
            agent_id: input.agent_id,
            agent_transcript_path: input.agent_transcript_path,
            stop_hook_active: input.stop_hook_active,
            session_id: input.session_id,
          },
        });
        subagentSpan.end();
      } finally {
        activeSubagentSpans.delete(input.agent_id);
      }
      return {};
    }

    // Fallback: SubagentStart wasn't called (current SDK behavior).
    // Add subagent metadata to the Task tool span instead.
    if (!toolUseID) {
      return {};
    }

    const toolSpan = activeToolSpans.get(toolUseID);
    if (!toolSpan) {
      return {};
    }

    toolSpan.log({
      metadata: {
        is_subagent: true,
        subagent_session_id: input.session_id,
        subagent_transcript_path: input.transcript_path,
        subagent_stop_hook_active: input.stop_hook_active,
      },
    });
    return {};
  };

  return { subagentStart, subagentStop };
}

/**
 * Injects tracing hooks into query options, preserving any user-provided hooks.
 */
function injectTracingHooks(
  options: QueryOptions,
  parentSpanExportPromise: Promise<
    Awaited<ReturnType<ReturnType<typeof startSpan>["export"]>>
  >,
  activeToolSpans: Map<string, ReturnType<typeof startSpan>>,
  activeSubagentSpans: Map<string, ReturnType<typeof startSpan>>,
): QueryOptions {
  const { preToolUse, postToolUse, postToolUseFailure } =
    createToolTracingHooks(parentSpanExportPromise, activeToolSpans);

  const { subagentStart, subagentStop } = createSubagentTracingHooks(
    parentSpanExportPromise,
    activeSubagentSpans,
    activeToolSpans,
  );

  const existingHooks = options.hooks ?? {};

  return {
    ...options,
    hooks: {
      ...existingHooks,
      PreToolUse: [
        ...(existingHooks.PreToolUse ?? []),
        { hooks: [preToolUse] } as HookCallbackMatcher,
      ],
      PostToolUse: [
        ...(existingHooks.PostToolUse ?? []),
        { hooks: [postToolUse] } as HookCallbackMatcher,
      ],
      PostToolUseFailure: [
        ...(existingHooks.PostToolUseFailure ?? []),
        { hooks: [postToolUseFailure] } as HookCallbackMatcher,
      ],
      SubagentStart: [
        ...(existingHooks.SubagentStart ?? []),
        { hooks: [subagentStart] } as HookCallbackMatcher,
      ],
      SubagentStop: [
        ...(existingHooks.SubagentStop ?? []),
        { hooks: [subagentStop] } as HookCallbackMatcher,
      ],
    },
  };
}

/**
 * Filters options to include only specific serializable fields for logging.
 */
function filterSerializableOptions(
  options: QueryOptions,
): Record<string, unknown> {
  const allowedKeys = [
    "model",
    "maxTurns",
    "cwd",
    "continue",
    "allowedTools",
    "disallowedTools",
    "additionalDirectories",
    "permissionMode",
    "debug",
    "apiKey",
    "apiKeySource",
    "agentName",
    "instructions",
  ];

  const filtered: Record<string, unknown> = {};

  for (const key of allowedKeys) {
    if (options[key] !== undefined) {
      filtered[key] = options[key];
    }
  }

  return filtered;
}

/**
 * Wraps the Claude Agent SDK's query function to add Braintrust tracing.
 * Traces the entire agent interaction including all streaming messages.
 * Internal use only - use wrapClaudeAgentSDK instead.
 */
function wrapClaudeAgentQuery<
  T extends (...args: unknown[]) => AsyncGenerator<SDKMessage, void, unknown>,
>(queryFn: T, defaultThis?: unknown): T {
  const proxy: T = new Proxy(queryFn, {
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
          metadata: filterSerializableOptions(options),
        },
      });

      const finalResults: Array<{ content: unknown; role: string }> = [];
      let finalUsageMetrics: Record<string, number> | undefined;
      let accumulatedOutputTokens = 0;

      // Track messages by message.message.id to group streaming updates
      let currentMessageId: string | undefined;
      let currentMessageStartTime = getCurrentUnixTimestamp();
      const currentMessages: SDKMessage[] = [];

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

        // Track accumulated output tokens
        const lastMessage = currentMessages[currentMessages.length - 1];
        if (lastMessage?.message?.usage) {
          const outputTokens =
            getNumberProperty(lastMessage.message.usage, "output_tokens") || 0;
          accumulatedOutputTokens += outputTokens;
        }

        currentMessages.length = 0;
      };

      // Eagerly create the original generator so methods like interrupt() work immediately
      // (before iteration starts). This is important because callers may want to call
      // interrupt() right after query() without consuming any messages first.
      const invocationTarget: unknown =
        thisArg === proxy || thisArg === undefined
          ? defaultThis ?? thisArg
          : thisArg;

      // Track active tool and subagent spans for hook-based tracing
      const activeToolSpans = new Map<string, ReturnType<typeof startSpan>>();
      const activeSubagentSpans = new Map<
        string,
        ReturnType<typeof startSpan>
      >();

      // Inject tracing hooks into options to trace ALL tool calls (including remote MCPs) and subagents
      const optionsWithHooks = injectTracingHooks(
        options,
        span.export(),
        activeToolSpans,
        activeSubagentSpans,
      );

      // Create modified argArray with injected hooks
      const modifiedArgArray = [{ ...params, options: optionsWithHooks }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalGenerator: any = withCurrent(span, () =>
        Reflect.apply(target, invocationTarget, modifiedArgArray),
      );

      // Create wrapped async generator that maintains span context
      const wrappedGenerator: AsyncGenerator<SDKMessage, void, unknown> =
        (async function* () {
          try {
            for await (const message of originalGenerator) {
              const currentTime = getCurrentUnixTimestamp();

              const messageId = message.message?.id;
              if (messageId && messageId !== currentMessageId) {
                await createLLMSpan();

                currentMessageId = messageId;
                currentMessageStartTime = currentTime;
              }
              if (message.type === "assistant" && message.message?.usage) {
                currentMessages.push(message);
              }

              // Capture final usage metrics from result message
              if (message.type === "result" && message.usage) {
                finalUsageMetrics = _extractUsageFromMessage(message);

                // HACK: Adjust the last assistant message's output_tokens to match result total.
                // The result message contains aggregated totals, so we calculate the difference:
                // last message tokens = total result tokens - previously accumulated tokens
                // The other metrics already accumulate correctly.
                if (
                  currentMessages.length > 0 &&
                  finalUsageMetrics.completion_tokens !== undefined
                ) {
                  const lastMessage =
                    currentMessages[currentMessages.length - 1];
                  if (lastMessage?.message?.usage) {
                    const adjustedTokens =
                      finalUsageMetrics.completion_tokens -
                      accumulatedOutputTokens;
                    if (adjustedTokens >= 0) {
                      lastMessage.message.usage.output_tokens = adjustedTokens;
                    }
                  }
                }

                // Log result metadata
                const result_metadata: Record<string, unknown> = {};
                if (message.num_turns !== undefined) {
                  result_metadata.num_turns = message.num_turns;
                }
                if (message.session_id !== undefined) {
                  result_metadata.session_id = message.session_id;
                }
                if (Object.keys(result_metadata).length > 0) {
                  span.log({
                    metadata: result_metadata,
                  });
                }
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
            span.end();
          }
        })();

      // Create a Proxy that forwards unknown properties (like interrupt()) to the original Query object
      const proxiedGenerator = new Proxy(wrappedGenerator, {
        get(target, prop, receiver) {
          // First check if the property exists on the wrapped generator (async iterator protocol)
          if (prop in target) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function") {
              return value.bind(target);
            }
            return value;
          }

          // Forward to original generator if it exists and has the property
          // This handles methods like interrupt() that exist on the Query object
          if (originalGenerator && prop in originalGenerator) {
            const value = originalGenerator[prop];
            if (typeof value === "function") {
              return value.bind(originalGenerator);
            }
            return value;
          }

          return undefined;
        },
      });

      return proxiedGenerator as ReturnType<T>;
    },
  });

  return proxy;
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
 * Extracts and normalizes usage metrics from a Claude Agent SDK message.
 */
function _extractUsageFromMessage(message: SDKMessage): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Assistant messages contain usage in message.message.usage
  // Result messages contain usage in message.usage
  let usage: unknown;
  if (message.type === "assistant") {
    usage = message.message?.usage;
  } else if (message.type === "result") {
    usage = message.usage;
  }

  if (!usage || typeof usage !== "object") {
    return metrics;
  }

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
  const outputs = messages
    .map((m) =>
      m.message?.content && m.message?.role
        ? { content: m.message.content, role: m.message.role }
        : undefined,
    )
    .filter((c): c is { content: unknown; role: string } => c !== undefined);

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

  return lastMessage.message?.content && lastMessage.message?.role
    ? { content: lastMessage.message.content, role: lastMessage.message.role }
    : undefined;
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
 *   options: { model: "claude-haiku-4-5-20251001" }
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

      // Tool tracing is now handled via PreToolUse/PostToolUse hooks injected in wrapClaudeAgentQuery.
      // We just pass through the original tool function - no need to wrap it.
      if (prop === "tool" && typeof value === "function") {
        const bound = (value as Function).bind(target);
        cache.set(prop, bound);
        return bound;
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

function getNumberProperty(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) {
    return undefined;
  }
  const value = Reflect.get(obj, key);
  return typeof value === "number" ? value : undefined;
}
