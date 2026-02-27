import { tracingChannel } from "dc-browser";
import { BasePlugin, isAsyncIterable, patchStreamIfNeeded } from "../core";
import type { StartEvent } from "../core";
import { startSpan } from "../../logger";
import type { Span } from "../../logger";
import { SpanTypeAttribute } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";

/**
 * Auto-instrumentation plugin for the Google ADK (Agent Development Kit).
 *
 * This plugin subscribes to orchestrion channels for Google ADK methods
 * and creates Braintrust spans to track:
 * - Runner.runAsync (top-level invocation)
 * - BaseAgent.runAsync (agent execution)
 * - LlmAgent.callLlmAsync (LLM calls)
 * - MCPTool.runAsync (MCP tool calls)
 */
export class GoogleADKPlugin extends BasePlugin {
  protected unsubscribers: Array<() => void> = [];

  protected onEnable(): void {
    this.subscribeToRunnerRunAsync();
    this.subscribeToAgentRunAsync();
    this.subscribeToLlmCallLlmAsync();
    this.subscribeToMCPToolRunAsync();
  }

  protected onDisable(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  /**
   * Runner.runAsync - Top-level orchestration.
   * Creates a TASK span, patches the async generator stream,
   * and outputs the last final response event.
   */
  private subscribeToRunnerRunAsync(): void {
    const channelName = "orchestrion:google-adk:runner.runAsync";
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<any, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const self = event.self as any;
        const args = event.arguments as any[];
        const params = args[0] || {};

        const appName = self?.appName || "unknown";

        const span = startSpan({
          name: `invocation [${appName}]`,
          spanAttributes: {
            type: SpanTypeAttribute.TASK,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          const input: any = {};
          if (params.newMessage) {
            input.newMessage = params.newMessage;
          }

          const metadata: any = { provider: "google-adk" };
          if (params.userId) {
            metadata.userId = params.userId;
          }
          if (params.sessionId) {
            metadata.sessionId = params.sessionId;
          }

          span.log({ input, metadata });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;

        if (isAsyncIterable(event.result)) {
          patchStreamIfNeeded(event.result, {
            onComplete: (chunks: any[]) => {
              try {
                // Find the last final response event
                let lastFinalResponse: any = null;
                for (const chunk of chunks) {
                  if (isFinalResponse(chunk)) {
                    lastFinalResponse = chunk;
                  }
                }

                span.log({
                  output:
                    lastFinalResponse ||
                    (chunks.length > 0 ? chunks[chunks.length - 1] : undefined),
                });
              } catch (error) {
                console.error(
                  `Error extracting output for ${channelName}:`,
                  error,
                );
              } finally {
                span.end();
              }
            },
            onError: (error: Error) => {
              span.log({ error: error.message });
              span.end();
            },
          });
        } else {
          span.log({ output: event.result });
          span.end();
          spans.delete(event);
        }
      },

      error: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;
        span.log({ error: event.error.message });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);
    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }

  /**
   * BaseAgent.runAsync - Agent execution.
   * Creates a TASK span, patches the async generator stream,
   * and outputs the last event.
   */
  private subscribeToAgentRunAsync(): void {
    const channelName = "orchestrion:google-adk:agent.runAsync";
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<any, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const self = event.self as any;
        const agentName = self?.name || "unknown";

        const span = startSpan({
          name: `agent_run [${agentName}]`,
          spanAttributes: {
            type: SpanTypeAttribute.TASK,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          const metadata: any = { provider: "google-adk" };
          span.log({ metadata });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;

        if (isAsyncIterable(event.result)) {
          patchStreamIfNeeded(event.result, {
            onComplete: (chunks: any[]) => {
              try {
                const lastEvent =
                  chunks.length > 0 ? chunks[chunks.length - 1] : undefined;

                span.log({ output: lastEvent });
              } catch (error) {
                console.error(
                  `Error extracting output for ${channelName}:`,
                  error,
                );
              } finally {
                span.end();
              }
            },
            onError: (error: Error) => {
              span.log({ error: error.message });
              span.end();
            },
          });
        } else {
          span.log({ output: event.result });
          span.end();
          spans.delete(event);
        }
      },

      error: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;
        span.log({ error: event.error.message });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);
    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }

  /**
   * LlmAgent.callLlmAsync - Actual LLM call.
   * Creates an LLM span, patches the async generator stream,
   * and extracts token metrics from the response's usageMetadata.
   */
  private subscribeToLlmCallLlmAsync(): void {
    const channelName = "orchestrion:google-adk:llm.callLlmAsync";
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<any, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const self = event.self as any;
        const args = event.arguments as any[];
        const llmRequest = args[1];

        const span = startSpan({
          name: "llm_call",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          const metadata: any = { provider: "google-adk" };

          // Extract model name from the agent instance
          const model = self?.llm?.model || self?.model;
          if (model) {
            metadata.model = model;
          }

          span.log({
            input: llmRequest,
            metadata,
          });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span, startTime } = spanData;

        if (isAsyncIterable(event.result)) {
          patchStreamIfNeeded(event.result, {
            onComplete: (chunks: any[]) => {
              try {
                const lastEvent =
                  chunks.length > 0 ? chunks[chunks.length - 1] : undefined;

                const metrics = extractLlmMetrics(chunks, startTime);

                span.log({
                  output: lastEvent,
                  metrics,
                });
              } catch (error) {
                console.error(
                  `Error extracting output for ${channelName}:`,
                  error,
                );
              } finally {
                span.end();
              }
            },
            onError: (error: Error) => {
              span.log({ error: error.message });
              span.end();
            },
          });
        } else {
          try {
            const metrics = extractGenerateContentMetrics(
              event.result,
              startTime,
            );
            span.log({
              output: event.result,
              metrics,
            });
          } catch (error) {
            console.error(`Error extracting output for ${channelName}:`, error);
          } finally {
            span.end();
            spans.delete(event);
          }
        }
      },

      error: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;
        span.log({ error: event.error.message });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);
    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }

  /**
   * MCPTool.runAsync - MCP tool calls.
   * Creates a TOOL span for non-streaming tool invocations.
   */
  private subscribeToMCPToolRunAsync(): void {
    const channelName = "orchestrion:google-adk:mcpTool.runAsync";
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<any, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const self = event.self as any;
        const args = event.arguments as any[];
        const request = args[0] || {};

        const toolName = self?.name || "unknown";

        const span = startSpan({
          name: `mcp_tool [${toolName}]`,
          spanAttributes: {
            type: SpanTypeAttribute.TOOL,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          span.log({
            input: {
              tool_name: toolName,
              arguments: request.args,
            },
            metadata: { provider: "google-adk" },
          });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span, startTime } = spanData;

        try {
          const end = getCurrentUnixTimestamp();
          span.log({
            output: event.result,
            metrics: { duration: end - startTime },
          });
        } catch (error) {
          console.error(`Error extracting output for ${channelName}:`, error);
        } finally {
          span.end();
          spans.delete(event);
        }
      },

      error: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;
        span.log({ error: event.error.message });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);
    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }
}

/**
 * Check if an ADK event is a final response.
 * Mirrors the logic from @google/adk's isFinalResponse.
 */
function isFinalResponse(event: any): boolean {
  if (!event) {
    return false;
  }

  if (event.actions?.skipSummarization) {
    return true;
  }

  if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
    return true;
  }

  const functionCalls = getFunctionCalls(event);
  const functionResponses = getFunctionResponses(event);

  return (
    functionCalls.length === 0 &&
    functionResponses.length === 0 &&
    !event.partial
  );
}

function getFunctionCalls(event: any): any[] {
  const funcCalls: any[] = [];
  if (event.content?.parts) {
    for (const part of event.content.parts) {
      if (part.functionCall) {
        funcCalls.push(part.functionCall);
      }
    }
  }
  return funcCalls;
}

function getFunctionResponses(event: any): any[] {
  const funcResponses: any[] = [];
  if (event.content?.parts) {
    for (const part of event.content.parts) {
      if (part.functionResponse) {
        funcResponses.push(part.functionResponse);
      }
    }
  }
  return funcResponses;
}

/**
 * Extract metrics from LLM response chunks (streamed from callLlmAsync).
 * The response events from ADK use the same Gemini usageMetadata format.
 */
function extractLlmMetrics(
  chunks: any[],
  startTime: number,
): Record<string, number> {
  const end = getCurrentUnixTimestamp();
  const metrics: Record<string, number> = {
    duration: end - startTime,
  };

  // Find the last chunk with usageMetadata
  for (const chunk of chunks) {
    if (chunk?.usageMetadata) {
      Object.assign(metrics, extractUsageMetrics(chunk.usageMetadata));
    }
  }

  return metrics;
}

/**
 * Extract metrics from a non-streaming generateContent response.
 * Reuses the same Gemini usageMetadata format.
 */
function extractGenerateContentMetrics(
  response: any,
  startTime?: number,
): Record<string, number> {
  const metrics: Record<string, number> = {};

  if (startTime) {
    const end = getCurrentUnixTimestamp();
    metrics.duration = end - startTime;
  }

  if (response?.usageMetadata) {
    Object.assign(metrics, extractUsageMetrics(response.usageMetadata));
  }

  return metrics;
}

/**
 * Extract standard token metrics from Gemini usageMetadata.
 */
function extractUsageMetrics(usageMetadata: any): Record<string, number> {
  const metrics: Record<string, number> = {};

  if (usageMetadata.promptTokenCount !== undefined) {
    metrics.prompt_tokens = usageMetadata.promptTokenCount;
  }
  if (usageMetadata.candidatesTokenCount !== undefined) {
    metrics.completion_tokens = usageMetadata.candidatesTokenCount;
  }
  if (usageMetadata.totalTokenCount !== undefined) {
    metrics.tokens = usageMetadata.totalTokenCount;
  }
  if (usageMetadata.cachedContentTokenCount !== undefined) {
    metrics.prompt_cached_tokens = usageMetadata.cachedContentTokenCount;
  }
  if (usageMetadata.thoughtsTokenCount !== undefined) {
    metrics.completion_reasoning_tokens = usageMetadata.thoughtsTokenCount;
  }

  return metrics;
}
