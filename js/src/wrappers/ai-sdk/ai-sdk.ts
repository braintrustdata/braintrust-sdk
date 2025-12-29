/* eslint-disable @typescript-eslint/no-explicit-any */

import { startSpan, traced, withCurrent, Attachment } from "../../logger";
import { SpanTypeAttribute } from "../../../util";
import {
  convertDataToBlob,
  getExtensionFromMediaType,
} from "../attachment-utils";
import { safeZodToJsonSchema } from "../../../util/zod-compat";

// list of json paths to remove from output field
const DENY_OUTPUT_PATHS: string[] = [
  // v3
  "roundtrips[].request.body",
  "roundtrips[].response.headers",
  "rawResponse.headers",
  "responseMessages",
  // v5
  "request.body",
  "response.body",
  "response.headers",
  "steps[].request.body",
  "steps[].response.body",
  "steps[].response.headers",
];

interface WrapAISDKOptions {
  denyOutputPaths?: string[];
}

/**
 * Wraps Vercel AI SDK methods with Braintrust tracing. Returns wrapped versions
 * of generateText, streamText, generateObject, streamObject, Agent, experimental_Agent,
 * and ToolLoopAgent that automatically create spans and log inputs, outputs, and metrics.
 *
 * @param ai - The AI SDK namespace (e.g., import * as ai from "ai")
 * @returns Object with AI SDK methods with Braintrust tracing
 *
 * @example
 * ```typescript
 * import { wrapAISDK } from "braintrust";
 * import * as ai from "ai";
 *
 * const { generateText, streamText, generateObject, streamObject, Agent } = wrapAISDK(ai);
 *
 * const result = await generateText({
 *   model: openai("gpt-4"),
 *   prompt: "Hello world"
 * });
 *
 * const agent = new Agent({ model: openai("gpt-4") });
 * const agentResult = await agent.generate({ prompt: "Hello from agent" });
 * ```
 */
export function wrapAISDK<T>(aiSDK: T, options: WrapAISDKOptions = {}): T {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return new Proxy(aiSDK as unknown as any, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      switch (prop) {
        case "generateText":
          return wrapGenerateText(original, options, aiSDK);
        case "streamText":
          return wrapStreamText(original, options, aiSDK);
        case "generateObject":
          return wrapGenerateObject(original, options, aiSDK);
        case "streamObject":
          return wrapStreamObject(original, options, aiSDK);
        case "Agent":
        case "Experimental_Agent":
        case "ToolLoopAgent":
          return original ? wrapAgentClass(original, options) : original;
      }
      return original;
    },
  }) as T;
}

const wrapAgentClass = (AgentClass: any, options: WrapAISDKOptions = {}) => {
  return new Proxy(AgentClass, {
    construct(target, args) {
      const instance = new target(...args);
      return new Proxy(instance, {
        get(instanceTarget, prop, instanceReceiver) {
          const original = Reflect.get(instanceTarget, prop, instanceReceiver);

          if (prop === "generate") {
            return wrapAgentGenerate(original, instanceTarget, options);
          }

          if (prop === "stream") {
            return wrapAgentStream(original, instanceTarget, options);
          }

          return original;
        },
      });
    },
  });
};

const wrapAgentGenerate = (
  generate: any,
  instance: any,
  options: WrapAISDKOptions = {},
) => {
  return async (params: any) =>
    makeGenerateTextWrapper(
      `${instance.constructor.name}.generate`,
      options,
      generate.bind(instance), // as of v5 this is just streamText under the hood
      // Follows what the AI SDK does under the hood when calling generateText
    )({ ...instance.settings, ...params });
};

const wrapAgentStream = (
  stream: any,
  instance: any,
  options: WrapAISDKOptions = {},
) => {
  return (params: any) =>
    makeStreamTextWrapper(
      `${instance.constructor.name}.stream`,
      options,
      stream.bind(instance), // as of v5 this is just streamText under the hood
      undefined, // aiSDK not needed since model is already on instance
    )({ ...instance.settings, ...params });
};

const makeGenerateTextWrapper = (
  name: string,
  options: WrapAISDKOptions,
  generateText: any,
  aiSDK?: any,
) => {
  const wrapper = async function (params: any) {
    const { model: initialModel, provider: initialProvider } =
      serializeModelWithProvider(params.model);

    return traced(
      async (span) => {
        const result = await generateText({
          ...params,
          model: wrapModel(params.model, aiSDK),
          tools: wrapTools(params.tools),
        });

        // Extract resolved model/provider from gateway routing if available
        const gatewayInfo = extractGatewayRoutingInfo(result);
        const resolvedMetadata: Record<string, unknown> = {};
        if (gatewayInfo?.provider) {
          resolvedMetadata.provider = gatewayInfo.provider;
        }
        if (gatewayInfo?.model) {
          resolvedMetadata.model = gatewayInfo.model;
        }

        span.log({
          output: await processOutput(result, options.denyOutputPaths),
          metrics: extractTokenMetrics(result),
          ...(Object.keys(resolvedMetadata).length > 0
            ? { metadata: resolvedMetadata }
            : {}),
        });

        return result;
      },
      {
        name,
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(params),
          metadata: {
            model: initialModel,
            ...(initialProvider ? { provider: initialProvider } : {}),
            braintrust: {
              integration_name: "ai-sdk",
              sdk_language: "typescript",
            },
          },
        },
      },
    );
  };
  Object.defineProperty(wrapper, "name", { value: name, writable: false });
  return wrapper;
};

/**
 * Resolves a model string ID to a model instance using AI SDK's global provider.
 * This mirrors the internal resolveLanguageModel function in AI SDK.
 */
const resolveModel = (model: any, ai: any): any => {
  if (typeof model !== "string") {
    return model;
  }
  // Use AI SDK's global provider if set, otherwise fall back to gateway
  const provider =
    (globalThis as any).AI_SDK_DEFAULT_PROVIDER ?? ai?.gateway ?? null;
  if (provider && typeof provider.languageModel === "function") {
    return provider.languageModel(model);
  }
  // If no provider available, return as-is (AI SDK will resolve it)
  return model;
};

/**
 * Wraps a model's doGenerate method to create a span for each LLM call.
 * This allows visibility into each step of a multi-round tool interaction.
 */
const wrapModel = (model: any, ai?: any): any => {
  // Resolve string model IDs to model instances
  const resolvedModel = resolveModel(model, ai);

  if (
    !resolvedModel ||
    typeof resolvedModel !== "object" ||
    typeof resolvedModel.doGenerate !== "function"
  ) {
    return model; // Return original if we can't wrap
  }

  // Already wrapped - avoid double wrapping
  if (resolvedModel._braintrustWrapped) {
    return resolvedModel;
  }

  const originalDoGenerate = resolvedModel.doGenerate.bind(resolvedModel);
  const originalDoStream = resolvedModel.doStream?.bind(resolvedModel);

  const { model: initialModel, provider: initialProvider } =
    serializeModelWithProvider(resolvedModel.modelId);
  const effectiveProvider = resolvedModel.provider || initialProvider;

  const wrappedDoGenerate = async (options: any) => {
    return traced(
      async (span) => {
        const result = await originalDoGenerate(options);

        // Extract resolved model/provider from gateway routing if available
        const gatewayInfo = extractGatewayRoutingInfo(result);
        const resolvedMetadata: Record<string, unknown> = {};
        if (gatewayInfo?.provider) {
          resolvedMetadata.provider = gatewayInfo.provider;
        }
        if (gatewayInfo?.model) {
          resolvedMetadata.model = gatewayInfo.model;
        }

        span.log({
          output: await processOutput(result),
          metrics: extractTokenMetrics(result),
          ...(Object.keys(resolvedMetadata).length > 0
            ? { metadata: resolvedMetadata }
            : {}),
        });

        return result;
      },
      {
        name: "doGenerate",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(options),
          metadata: {
            model: initialModel,
            ...(effectiveProvider ? { provider: effectiveProvider } : {}),
            braintrust: {
              integration_name: "ai-sdk",
              sdk_language: "typescript",
            },
          },
        },
      },
    );
  };

  const wrappedDoStream = async (options: any) => {
    const startTime = Date.now();
    let receivedFirst = false;

    const span = startSpan({
      name: "doStream",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: {
        input: processInputAttachments(options),
        metadata: {
          model: initialModel,
          ...(effectiveProvider ? { provider: effectiveProvider } : {}),
          braintrust: {
            integration_name: "ai-sdk",
            sdk_language: "typescript",
          },
        },
      },
    });

    const result = await originalDoStream(options);

    // Accumulate streamed content for output logging
    const output: Record<string, unknown> = {};
    let text = "";
    let reasoning = "";
    const toolCalls: unknown[] = [];
    let object: unknown = undefined; // For structured output / streamObject

    // Helper to extract text from various chunk formats
    const extractTextDelta = (chunk: any): string => {
      // Try all known property names for text deltas
      if (typeof chunk.textDelta === "string") return chunk.textDelta;
      if (typeof chunk.delta === "string") return chunk.delta;
      if (typeof chunk.text === "string") return chunk.text;
      // For content property (some providers use this)
      if (typeof chunk.content === "string") return chunk.content;
      return "";
    };

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        // Track time to first token on any chunk type
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: {
              time_to_first_token: (Date.now() - startTime) / 1000,
            },
          });
        }

        switch (chunk.type) {
          case "text-delta":
            text += extractTextDelta(chunk);
            break;
          case "reasoning-delta":
            // Reasoning chunks use delta or text property
            if (chunk.delta) {
              reasoning += chunk.delta;
            } else if (chunk.text) {
              reasoning += chunk.text;
            }
            break;
          case "tool-call":
            toolCalls.push(chunk);
            break;
          case "object":
            // Structured output - capture the final object
            object = chunk.object;
            break;
          case "raw":
            // Raw chunks may contain text content for structured output / JSON mode
            // The rawValue often contains the delta text from the provider
            if (chunk.rawValue) {
              const rawVal = chunk.rawValue as any;
              // OpenAI format: rawValue.delta.content or rawValue.choices[0].delta.content
              if (rawVal.delta?.content) {
                text += rawVal.delta.content;
              } else if (rawVal.choices?.[0]?.delta?.content) {
                text += rawVal.choices[0].delta.content;
              } else if (typeof rawVal.text === "string") {
                text += rawVal.text;
              } else if (typeof rawVal.content === "string") {
                text += rawVal.content;
              }
            }
            break;
          case "finish":
            output.text = text;
            output.reasoning = reasoning;
            output.toolCalls = toolCalls;
            output.finishReason = chunk.finishReason;
            output.usage = chunk.usage;

            // Include object for structured output if captured
            if (object !== undefined) {
              output.object = object;
            }

            // Extract resolved model/provider from gateway routing if available
            const gatewayInfo = extractGatewayRoutingInfo(output);
            const resolvedMetadata: Record<string, unknown> = {};
            if (gatewayInfo?.provider) {
              resolvedMetadata.provider = gatewayInfo.provider;
            }
            if (gatewayInfo?.model) {
              resolvedMetadata.model = gatewayInfo.model;
            }

            span.log({
              output: await processOutput(output),
              metrics: extractTokenMetrics(output),
              ...(Object.keys(resolvedMetadata).length > 0
                ? { metadata: resolvedMetadata }
                : {}),
            });
            span.end();
            break;
        }
        controller.enqueue(chunk);
      },
    });

    return {
      ...result,
      stream: result.stream.pipeThrough(transformStream),
    };
  };

  return new Proxy(resolvedModel, {
    get(target, prop, receiver) {
      if (prop === "_braintrustWrapped") {
        return true;
      }
      if (prop === "doGenerate") {
        return wrappedDoGenerate;
      }
      if (prop === "doStream" && originalDoStream) {
        return wrappedDoStream;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
};

const wrapGenerateText = (
  generateText: any,
  options: WrapAISDKOptions = {},
  aiSDK?: any,
) => {
  return makeGenerateTextWrapper("generateText", options, generateText, aiSDK);
};

const wrapGenerateObject = (
  generateObject: any,
  options: WrapAISDKOptions = {},
  aiSDK?: any,
) => {
  return async function generateObjectWrapper(params: any) {
    const { model: initialModel, provider: initialProvider } =
      serializeModelWithProvider(params.model);

    return traced(
      async (span) => {
        const result = await generateObject({
          ...params,
          model: wrapModel(params.model, aiSDK),
          tools: wrapTools(params.tools),
        });

        const output = await processOutput(result, options.denyOutputPaths);

        // Extract resolved model/provider from gateway routing if available
        const gatewayInfo = extractGatewayRoutingInfo(result);
        const resolvedMetadata: Record<string, unknown> = {};
        if (gatewayInfo?.provider) {
          resolvedMetadata.provider = gatewayInfo.provider;
        }
        if (gatewayInfo?.model) {
          resolvedMetadata.model = gatewayInfo.model;
        }

        span.log({
          output,
          metrics: extractTokenMetrics(result),
          ...(Object.keys(resolvedMetadata).length > 0
            ? { metadata: resolvedMetadata }
            : {}),
        });

        return result;
      },
      {
        name: "generateObject",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(params),
          metadata: {
            model: initialModel,
            ...(initialProvider ? { provider: initialProvider } : {}),
            braintrust: {
              integration_name: "ai-sdk",
              sdk_language: "typescript",
            },
          },
        },
      },
    );
  };
};

const makeStreamTextWrapper = (
  name: string,
  options: WrapAISDKOptions,
  streamText: any,
  aiSDK?: any,
) => {
  const wrapper = function (params: any) {
    const { model: initialModel, provider: initialProvider } =
      serializeModelWithProvider(params.model);

    const span = startSpan({
      name,
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: {
        input: processInputAttachments(params),
        metadata: {
          model: initialModel,
          ...(initialProvider ? { provider: initialProvider } : {}),
          braintrust: {
            integration_name: "ai-sdk",
            sdk_language: "typescript",
          },
        },
      },
    });

    try {
      const startTime = Date.now();
      let receivedFirst = false;
      const result = withCurrent(span, () =>
        streamText({
          ...params,
          model: wrapModel(params.model, aiSDK),
          tools: wrapTools(params.tools),
          onChunk: (chunk: any) => {
            if (!receivedFirst) {
              receivedFirst = true;
              span.log({
                metrics: {
                  time_to_first_token: (Date.now() - startTime) / 1000,
                },
              });
            }

            params.onChunk?.(chunk);
          },
          onFinish: async (event: any) => {
            params.onFinish?.(event);

            // Extract resolved model/provider from gateway routing if available
            const gatewayInfo = extractGatewayRoutingInfo(event);
            const resolvedMetadata: Record<string, unknown> = {};
            if (gatewayInfo?.provider) {
              resolvedMetadata.provider = gatewayInfo.provider;
            }
            if (gatewayInfo?.model) {
              resolvedMetadata.model = gatewayInfo.model;
            }

            span.log({
              output: await processOutput(event, options.denyOutputPaths),
              metrics: extractTokenMetrics(event),
              ...(Object.keys(resolvedMetadata).length > 0
                ? { metadata: resolvedMetadata }
                : {}),
            });

            span.end();
          },
          onError: async (err: unknown) => {
            params.onError?.(err);

            span.log({
              error: serializeError(err),
            });

            span.end();
          },
        }),
      );

      // Use stream tee to track first token regardless of consumption method
      const trackFirstToken = () => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: {
              time_to_first_token: (Date.now() - startTime) / 1000,
            },
          });
        }
      };

      if (result && result.baseStream) {
        const [stream1, stream2] = result.baseStream.tee();
        result.baseStream = stream2;

        stream1
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                trackFirstToken();
                controller.enqueue(chunk);
              },
            }),
          )
          .pipeTo(
            new WritableStream({
              write() {
                // Discard chunks - we only care about the side effect
              },
            }),
          )
          .catch(() => {
            // Silently ignore errors from the tracking stream
          });
      }

      return result;
    } catch (error) {
      span.log({
        error: serializeError(error),
      });
      span.end();
      throw error;
    }
  };
  Object.defineProperty(wrapper, "name", { value: name, writable: false });
  return wrapper;
};

const wrapStreamText = (
  streamText: any,
  options: WrapAISDKOptions = {},
  aiSDK?: any,
) => {
  return makeStreamTextWrapper("streamText", options, streamText, aiSDK);
};

const wrapStreamObject = (
  streamObject: any,
  options: WrapAISDKOptions = {},
  aiSDK?: any,
) => {
  return function streamObjectWrapper(params: any) {
    const { model: initialModel, provider: initialProvider } =
      serializeModelWithProvider(params.model);

    const span = startSpan({
      name: "streamObject",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: {
        input: processInputAttachments(params),
        metadata: {
          model: initialModel,
          ...(initialProvider ? { provider: initialProvider } : {}),
          braintrust: {
            integration_name: "ai-sdk",
            sdk_language: "typescript",
          },
        },
      },
    });

    try {
      const startTime = Date.now();
      let receivedFirst = false;

      const result = withCurrent(span, () =>
        streamObject({
          ...params,
          model: wrapModel(params.model, aiSDK),
          tools: wrapTools(params.tools),
          onChunk: (chunk: any) => {
            if (!receivedFirst) {
              receivedFirst = true;
              span.log({
                metrics: {
                  time_to_first_token: (Date.now() - startTime) / 1000,
                },
              });
            }
            params.onChunk?.(chunk);
          },
          onFinish: async (event: any) => {
            params.onFinish?.(event);

            // Extract resolved model/provider from gateway routing if available
            const gatewayInfo = extractGatewayRoutingInfo(event);
            const resolvedMetadata: Record<string, unknown> = {};
            if (gatewayInfo?.provider) {
              resolvedMetadata.provider = gatewayInfo.provider;
            }
            if (gatewayInfo?.model) {
              resolvedMetadata.model = gatewayInfo.model;
            }

            span.log({
              output: await processOutput(event, options.denyOutputPaths),
              metrics: extractTokenMetrics(event),
              ...(Object.keys(resolvedMetadata).length > 0
                ? { metadata: resolvedMetadata }
                : {}),
            });

            span.end();
          },
          onError: async (err: unknown) => {
            params.onError?.(err);

            span.log({
              error: serializeError(err),
            });

            span.end();
          },
        }),
      );

      // Use stream tee to track first token regardless of consumption method
      const trackFirstToken = () => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: {
              time_to_first_token: (Date.now() - startTime) / 1000,
            },
          });
        }
      };

      if (result && result.baseStream) {
        const [stream1, stream2] = result.baseStream.tee();
        result.baseStream = stream2;

        stream1
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                trackFirstToken();
                controller.enqueue(chunk);
              },
            }),
          )
          .pipeTo(
            new WritableStream({
              write() {
                // Discard chunks - we only care about the side effect
              },
            }),
          )
          .catch(() => {
            // Silently ignore errors from the tracking stream
          });
      }

      return result;
    } catch (error) {
      span.log({
        error: serializeError(error),
      });
      span.end();
      throw error;
    }
  };
};

/**
 * Wraps AI SDK tools with tracing support
 *
 * Supports all AI SDK versions (v3-v6):
 * - Tools created with ai.tool() or tool() helper (have execute function)
 * - Raw tool definitions with parameters only (v3-v4)
 * - RSC tools with render function (v3-v4)
 *
 * Tools with execute are wrapped with tracing; others are passed through as-is.
 */
const wrapTools = (tools: any) => {
  if (!tools) return tools;

  const inferName = (tool: any, fallback: string) =>
    (tool && (tool.name || tool.toolName || tool.id)) || fallback;

  if (Array.isArray(tools)) {
    return tools.map((tool, idx) => {
      const name = inferName(tool, `tool[${idx}]`);
      return wrapToolExecute(tool, name);
    });
  }

  const wrappedTools: Record<string, any> = {};
  for (const [key, tool] of Object.entries(tools)) {
    wrappedTools[key] = wrapToolExecute(tool, key);
  }
  return wrappedTools;
};

/**
 * Checks if a value is an AsyncGenerator.
 * AsyncGenerators are returned by async generator functions (async function* () {})
 * and must be iterated to consume their yielded values.
 */
const isAsyncGenerator = (value: any): value is AsyncGenerator => {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value[Symbol.asyncIterator] === "function" &&
    typeof value.next === "function" &&
    typeof value.return === "function" &&
    typeof value.throw === "function"
  );
};

const wrapToolExecute = (tool: any, name: string) => {
  // Only wrap tools that have an execute function (created with tool() helper)
  // AI SDK v3-v6: tool({ description, inputSchema/parameters, execute })
  if (
    tool != null &&
    typeof tool === "object" &&
    "execute" in tool &&
    typeof tool.execute === "function"
  ) {
    // Use Proxy with full transparency to wrap execute without breaking Zod schemas
    // The Proxy must implement all traps to be fully transparent for object iteration
    const originalExecute = tool.execute;
    return new Proxy(tool, {
      get(target, prop) {
        if (prop === "execute") {
          // Return a function that handles both regular async functions and async generators
          const wrappedExecute = (...args: any[]) => {
            const result = originalExecute.apply(target, args);

            // Check if the result is an async generator (from async function* () {})
            // AI SDK v5 supports async generator tools that yield intermediate status updates
            if (isAsyncGenerator(result)) {
              // Return a wrapper async generator that:
              // 1. Iterates through the original generator
              // 2. Yields all intermediate values (so consumers see status updates)
              // 3. Tracks and logs the final yielded value as the tool output
              return (async function* () {
                const span = startSpan({
                  name,
                  spanAttributes: {
                    type: SpanTypeAttribute.TOOL,
                  },
                });
                span.log({ input: args.length === 1 ? args[0] : args });

                try {
                  let lastValue: any;
                  for await (const value of result) {
                    lastValue = value;
                    yield value;
                  }
                  // Log the final yielded value as the output
                  span.log({ output: lastValue });
                } catch (error) {
                  span.log({ error: serializeError(error) });
                  throw error;
                } finally {
                  span.end();
                }
              })();
            }

            // For regular async functions, use traced as before
            return traced(
              async (span) => {
                span.log({ input: args.length === 1 ? args[0] : args });
                const awaitedResult = await result;
                span.log({ output: awaitedResult });
                return awaitedResult;
              },
              {
                name,
                spanAttributes: {
                  type: SpanTypeAttribute.TOOL,
                },
              },
            );
          };
          return wrappedExecute;
        }
        return target[prop];
      },
      // Implement additional traps for full transparency
      has(target, prop) {
        return prop in target;
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
      deleteProperty(target, prop) {
        delete target[prop];
        return true;
      },
      defineProperty(target, prop, descriptor) {
        Object.defineProperty(target, prop, descriptor);
        return true;
      },
      getPrototypeOf(target) {
        return Object.getPrototypeOf(target);
      },
      setPrototypeOf(target, proto) {
        Object.setPrototypeOf(target, proto);
        return true;
      },
      isExtensible(target) {
        return Object.isExtensible(target);
      },
      preventExtensions(target) {
        Object.preventExtensions(target);
        return true;
      },
    });
  }
  // Pass through tools without execute (e.g., RSC tools with only render, raw definitions)
  return tool;
};

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {}
  }

  return String(error);
};

const serializeModel = (model: any) => {
  return typeof model === "string" ? model : model?.modelId;
};

/**
 * Parses a gateway model string like "openai/gpt-5-mini" into provider and model.
 * Returns { provider, model } if parseable, otherwise { model } only.
 */
function parseGatewayModelString(modelString: string): {
  model: string;
  provider?: string;
} {
  if (!modelString || typeof modelString !== "string") {
    return { model: modelString };
  }
  const slashIndex = modelString.indexOf("/");
  if (slashIndex > 0 && slashIndex < modelString.length - 1) {
    return {
      provider: modelString.substring(0, slashIndex),
      model: modelString.substring(slashIndex + 1),
    };
  }
  return { model: modelString };
}

/**
 * Extracts model and provider info from a model, parsing gateway-style strings.
 */
function serializeModelWithProvider(model: any): {
  model: string;
  provider?: string;
} {
  const modelId = typeof model === "string" ? model : model?.modelId;
  if (!modelId) {
    return { model: modelId };
  }
  return parseGatewayModelString(modelId);
}

/**
 * Extracts gateway routing info from the result's providerMetadata.
 * This provides the actual resolved provider and model used by the gateway.
 */
function extractGatewayRoutingInfo(result: any): {
  model?: string;
  provider?: string;
} | null {
  // Check steps for gateway routing info (multi-step results)
  if (result?.steps && Array.isArray(result.steps) && result.steps.length > 0) {
    const routing = result.steps[0]?.providerMetadata?.gateway?.routing;
    if (routing) {
      return {
        provider: routing.resolvedProvider || routing.finalProvider,
        model: routing.resolvedProviderApiModelId,
      };
    }
  }

  // Check direct providerMetadata (single-step results)
  const routing = result?.providerMetadata?.gateway?.routing;
  if (routing) {
    return {
      provider: routing.resolvedProvider || routing.finalProvider,
      model: routing.resolvedProviderApiModelId,
    };
  }

  return null;
}

/**
 * Detects if an object is a Zod schema
 * Zod schemas have a _def property and are objects
 */
const isZodSchema = (value: any): boolean => {
  return (
    value != null &&
    typeof value === "object" &&
    "_def" in value &&
    typeof value._def === "object"
  );
};

/**
 * Converts a Zod schema to JSON Schema for serialization
 * This prevents errors when logging tools with Zod schemas
 * Supports both Zod v3 and v4
 */
const serializeZodSchema = (schema: any): any => {
  return safeZodToJsonSchema(schema);
};

/**
 * Processes tools to convert Zod schemas to JSON Schema
 * AI SDK v3-v6 tools can have inputSchema or parameters fields with Zod schemas
 */
const processTools = (tools: any): any => {
  if (!tools || typeof tools !== "object") return tools;

  if (Array.isArray(tools)) {
    return tools.map(processTool);
  }

  const processed: Record<string, any> = {};
  for (const [key, tool] of Object.entries(tools)) {
    processed[key] = processTool(tool);
  }
  return processed;
};

const processTool = (tool: any): any => {
  if (!tool || typeof tool !== "object") return tool;

  const processed = { ...tool };

  // Convert inputSchema if it's a Zod schema (v3-v4 with ai.tool())
  if (isZodSchema(processed.inputSchema)) {
    processed.inputSchema = serializeZodSchema(processed.inputSchema);
  }

  // Convert parameters if it's a Zod schema (v3-v4 raw definitions)
  if (isZodSchema(processed.parameters)) {
    processed.parameters = serializeZodSchema(processed.parameters);
  }

  // Remove execute function from logs (not serializable and not useful)
  if ("execute" in processed) {
    processed.execute = "[Function]";
  }

  // Remove render function from logs (not serializable and not useful)
  if ("render" in processed) {
    processed.render = "[Function]";
  }

  return processed;
};

const processInputAttachments = (input: any) => {
  if (!input) return input;

  const processed: any = { ...input };

  // Process messages array if present
  if (input.messages && Array.isArray(input.messages)) {
    processed.messages = input.messages.map(processMessage);
  }

  // Process prompt - can be an array of messages (provider-level format) or an object
  if (input.prompt && typeof input.prompt === "object") {
    if (Array.isArray(input.prompt)) {
      // Provider-level format: prompt is an array of messages
      processed.prompt = input.prompt.map(processMessage);
    } else {
      // High-level format: prompt is an object with potential attachments
      processed.prompt = processPromptContent(input.prompt);
    }
  }

  // Process tools to convert Zod schemas to JSON Schema
  if (input.tools) {
    processed.tools = processTools(input.tools);
  }

  // Process callOptionsSchema (used by ToolLoopAgent and other agents)
  if (input.callOptionsSchema && isZodSchema(input.callOptionsSchema)) {
    processed.callOptionsSchema = serializeZodSchema(input.callOptionsSchema);
  }

  // TODO: Process output schema for ToolLoopAgent with Output.object()
  // The output field contains an Output object with a responseFormat Promise that resolves
  // to an object with type: "json" and schema: {...JSON Schema...}
  // We need to:
  // 1. Await the responseFormat Promise (requires making this function async)
  // 2. Extract the resolved schema from responseFormat.schema
  // 3. Log it in a useful format for users to recreate the output configuration
  // Currently logs as output: {} which is not useful

  // Remove prepareCall function from logs (not serializable and not useful)
  if (
    "prepareCall" in processed &&
    typeof processed.prepareCall === "function"
  ) {
    processed.prepareCall = "[Function]";
  }

  return processed;
};

const processMessage = (message: any): any => {
  if (!message || typeof message !== "object") return message;

  // If content is an array, process each content part
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map(processContentPart),
    };
  }

  // If content is an object (single content part), process it
  if (typeof message.content === "object" && message.content !== null) {
    return {
      ...message,
      content: processContentPart(message.content),
    };
  }

  return message;
};

const processPromptContent = (prompt: any): any => {
  // Handle prompt objects that might contain content arrays
  if (Array.isArray(prompt)) {
    return prompt.map(processContentPart);
  }

  if (prompt.content) {
    if (Array.isArray(prompt.content)) {
      return {
        ...prompt,
        content: prompt.content.map(processContentPart),
      };
    } else if (typeof prompt.content === "object") {
      return {
        ...prompt,
        content: processContentPart(prompt.content),
      };
    }
  }

  return prompt;
};

const processContentPart = (part: any): any => {
  if (!part || typeof part !== "object") return part;

  try {
    // Process image content with data URLs (these have explicit mime types)
    if (part.type === "image" && part.image) {
      const imageAttachment = convertImageToAttachment(
        part.image,
        part.mimeType || part.mediaType,
      );
      if (imageAttachment) {
        return {
          ...part,
          image: imageAttachment,
        };
      }
    }

    // Process file content with explicit mime type
    if (
      part.type === "file" &&
      part.data &&
      (part.mimeType || part.mediaType)
    ) {
      const fileAttachment = convertDataToAttachment(
        part.data,
        part.mimeType || part.mediaType,
        part.name || part.filename,
      );
      if (fileAttachment) {
        return {
          ...part,
          data: fileAttachment,
        };
      }
    }

    // Process image_url format (OpenAI style)
    if (part.type === "image_url" && part.image_url) {
      if (typeof part.image_url === "object" && part.image_url.url) {
        const imageAttachment = convertImageToAttachment(part.image_url.url);
        if (imageAttachment) {
          return {
            ...part,
            image_url: {
              ...part.image_url,
              url: imageAttachment,
            },
          };
        }
      }
    }
  } catch (error) {
    console.warn("Error processing content part:", error);
  }

  return part;
};

const convertImageToAttachment = (
  image: any,
  explicitMimeType?: string,
): Attachment | null => {
  try {
    // Handle data URLs (they contain their own mime type)
    if (typeof image === "string" && image.startsWith("data:")) {
      const [mimeTypeSection, base64Data] = image.split(",");
      const mimeType = mimeTypeSection.match(/data:(.*?);/)?.[1];
      if (mimeType && base64Data) {
        const blob = convertDataToBlob(base64Data, mimeType);
        if (blob) {
          return new Attachment({
            data: blob,
            filename: `image.${getExtensionFromMediaType(mimeType)}`,
            contentType: mimeType,
          });
        }
      }
    }

    // Only convert binary data if we have an explicit mime type
    if (explicitMimeType) {
      // Handle Uint8Array
      if (image instanceof Uint8Array) {
        return new Attachment({
          data: new Blob([image], { type: explicitMimeType }),
          filename: `image.${getExtensionFromMediaType(explicitMimeType)}`,
          contentType: explicitMimeType,
        });
      }

      // Handle Buffer (Node.js)
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(image)) {
        return new Attachment({
          data: new Blob([image], { type: explicitMimeType }),
          filename: `image.${getExtensionFromMediaType(explicitMimeType)}`,
          contentType: explicitMimeType,
        });
      }
    }

    // Handle Blob (has its own type)
    if (image instanceof Blob && image.type) {
      return new Attachment({
        data: image,
        filename: `image.${getExtensionFromMediaType(image.type)}`,
        contentType: image.type,
      });
    }

    // If already an Attachment, return as-is
    if (image instanceof Attachment) {
      return image;
    }
  } catch (error) {
    console.warn("Error converting image to attachment:", error);
  }

  return null;
};

const convertDataToAttachment = (
  data: any,
  mimeType: string,
  filename?: string,
): Attachment | null => {
  if (!mimeType) return null; // Don't convert without explicit mime type

  try {
    let blob: Blob | null = null;

    // Handle data URLs
    if (typeof data === "string" && data.startsWith("data:")) {
      const [, base64Data] = data.split(",");
      if (base64Data) {
        blob = convertDataToBlob(base64Data, mimeType);
      }
    }
    // Handle plain base64 strings
    else if (typeof data === "string" && data.length > 0) {
      blob = convertDataToBlob(data, mimeType);
    }
    // Handle Uint8Array
    else if (data instanceof Uint8Array) {
      blob = new Blob([data], { type: mimeType });
    }
    // Handle Buffer (Node.js)
    else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
      blob = new Blob([data], { type: mimeType });
    }
    // Handle Blob
    else if (data instanceof Blob) {
      blob = data;
    }

    if (blob) {
      return new Attachment({
        data: blob,
        filename: filename || `file.${getExtensionFromMediaType(mimeType)}`,
        contentType: mimeType,
      });
    }
  } catch (error) {
    console.warn("Error converting data to attachment:", error);
  }

  return null;
};

const extractGetterValues = (obj: any): any => {
  // Extract common getter values from AI SDK result objects
  // These are typically on the prototype and not enumerable
  const getterValues: Record<string, any> = {};

  // List of known getters from AI SDK result objects
  const getterNames = [
    "text",
    "object",
    "finishReason",
    "usage",
    "toolCalls",
    "toolResults",
    "warnings",
    "experimental_providerMetadata",
    "rawResponse",
    "response",
  ];

  for (const name of getterNames) {
    try {
      if (obj && name in obj && typeof obj[name] !== "function") {
        getterValues[name] = obj[name];
      }
    } catch {
      // Ignore errors accessing getters
    }
  }

  return getterValues;
};

const processOutput = async (output: any, denyOutputPaths?: string[]) => {
  // Extract getter values before processing
  const getterValues = extractGetterValues(output);

  // Process attachments
  const processed = await processOutputAttachments(output);

  // Merge getter values into the processed output
  const merged = { ...processed, ...getterValues };

  // Apply omit to the merged result to ensure paths are omitted
  return omit(merged, denyOutputPaths ?? DENY_OUTPUT_PATHS);
};

const processOutputAttachments = async (output: any) => {
  try {
    return await doProcessOutputAttachments(output);
  } catch (error) {
    console.error("Error processing output attachments:", error);
    return output;
  }
};

const doProcessOutputAttachments = async (output: any) => {
  if (!output || !("files" in output)) {
    return output;
  }

  if (output.files && typeof output.files.then === "function") {
    return {
      ...output,
      files: output.files.then(async (files: any[]) => {
        if (!files || !Array.isArray(files) || files.length === 0) {
          return files;
        }
        return files.map(convertFileToAttachment);
      }),
    };
  } else if (
    output.files &&
    Array.isArray(output.files) &&
    output.files.length > 0
  ) {
    return {
      ...output,
      files: output.files.map(convertFileToAttachment),
    };
  }

  return output;
};

const convertFileToAttachment = (file: any, index: number): any => {
  try {
    const mediaType = file.mediaType || "application/octet-stream";
    const filename = `generated_file_${index}.${getExtensionFromMediaType(mediaType)}`;

    let blob: Blob | null = null;

    if (file.base64) {
      blob = convertDataToBlob(file.base64, mediaType);
    } else if (file.uint8Array) {
      blob = new Blob([file.uint8Array], { type: mediaType });
    }

    if (!blob) {
      console.warn(`Failed to convert file at index ${index} to Blob`);
      return file; // Return original if conversion fails
    }

    return new Attachment({
      data: blob,
      filename: filename,
      contentType: mediaType,
    });
  } catch (error) {
    console.warn(`Error processing file at index ${index}:`, error);
    return file; // Return original on error
  }
};

function firstNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number") {
      return v;
    }
  }
  return undefined;
}

/**
 * Extracts all token metrics from usage data.
 * Handles various provider formats and naming conventions for token counts.
 */
export function extractTokenMetrics(result: any): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Agent results use totalUsage, other results use usage
  // Try totalUsage first (for Agent calls), then fall back to usage
  let usage = result?.totalUsage || result?.usage;

  // If usage is not directly accessible, try as a getter
  if (!usage && result) {
    try {
      if ("totalUsage" in result && typeof result.totalUsage !== "function") {
        usage = result.totalUsage;
      } else if ("usage" in result && typeof result.usage !== "function") {
        usage = result.usage;
      }
    } catch {
      // Ignore errors accessing getters
    }
  }

  if (!usage) {
    return metrics;
  }

  // Prompt tokens (AI SDK v5 uses inputTokens, which can be a number or object with .total)
  const promptTokens = firstNumber(
    usage.inputTokens?.total,
    usage.inputTokens,
    usage.promptTokens,
    usage.prompt_tokens,
  );
  if (promptTokens !== undefined) {
    metrics.prompt_tokens = promptTokens;
  }

  // Completion tokens (AI SDK v5 uses outputTokens, which can be a number or object with .total)
  const completionTokens = firstNumber(
    usage.outputTokens?.total,
    usage.outputTokens,
    usage.completionTokens,
    usage.completion_tokens,
  );
  if (completionTokens !== undefined) {
    metrics.completion_tokens = completionTokens;
  }

  // Total tokens
  const totalTokens = firstNumber(
    usage.totalTokens,
    usage.tokens,
    usage.total_tokens,
  );
  if (totalTokens !== undefined) {
    metrics.tokens = totalTokens;
  }

  // Prompt cached tokens (can be nested in inputTokens.cacheRead or top-level)
  const promptCachedTokens = firstNumber(
    usage.inputTokens?.cacheRead,
    usage.cachedInputTokens,
    usage.promptCachedTokens,
    usage.prompt_cached_tokens,
  );
  if (promptCachedTokens !== undefined) {
    metrics.prompt_cached_tokens = promptCachedTokens;
  }

  // Prompt cache creation tokens
  const promptCacheCreationTokens = firstNumber(
    usage.promptCacheCreationTokens,
    usage.prompt_cache_creation_tokens,
  );
  if (promptCacheCreationTokens !== undefined) {
    metrics.prompt_cache_creation_tokens = promptCacheCreationTokens;
  }

  // Prompt reasoning tokens
  const promptReasoningTokens = firstNumber(
    usage.promptReasoningTokens,
    usage.prompt_reasoning_tokens,
  );
  if (promptReasoningTokens !== undefined) {
    metrics.prompt_reasoning_tokens = promptReasoningTokens;
  }

  // Completion cached tokens
  const completionCachedTokens = firstNumber(
    usage.completionCachedTokens,
    usage.completion_cached_tokens,
  );
  if (completionCachedTokens !== undefined) {
    metrics.completion_cached_tokens = completionCachedTokens;
  }

  // Completion reasoning tokens (can be nested in outputTokens.reasoning)
  const reasoningTokenCount = firstNumber(
    usage.outputTokens?.reasoning,
    usage.reasoningTokens,
    usage.completionReasoningTokens,
    usage.completion_reasoning_tokens,
    usage.reasoning_tokens,
    usage.thinkingTokens,
    usage.thinking_tokens,
  );
  if (reasoningTokenCount !== undefined) {
    metrics.completion_reasoning_tokens = reasoningTokenCount;
    metrics.reasoning_tokens = reasoningTokenCount;
  }

  // Completion audio tokens
  const completionAudioTokens = firstNumber(
    usage.completionAudioTokens,
    usage.completion_audio_tokens,
  );
  if (completionAudioTokens !== undefined) {
    metrics.completion_audio_tokens = completionAudioTokens;
  }

  // Extract cost from providerMetadata.gateway.cost (e.g., from Vercel AI Gateway)
  // For multi-step results, sum up costs from all steps
  const cost = extractCostFromResult(result);
  if (cost !== undefined) {
    metrics.estimated_cost = cost;
  }

  return metrics;
}

function extractCostFromResult(result: any): number | undefined {
  // Check for cost in steps (multi-step results like generateText with tools)
  if (result?.steps && Array.isArray(result.steps) && result.steps.length > 0) {
    let totalCost = 0;
    let foundCost = false;
    for (const step of result.steps) {
      const gateway = step?.providerMetadata?.gateway;
      // Check cost first, then fall back to marketCost (Vercel AI Gateway)
      const stepCost =
        parseGatewayCost(gateway?.cost) ||
        parseGatewayCost(gateway?.marketCost);
      if (stepCost !== undefined && stepCost > 0) {
        totalCost += stepCost;
        foundCost = true;
      }
    }
    if (foundCost) {
      return totalCost;
    }
  }

  // Check for cost directly on result.providerMetadata (single-step results)
  const gateway = result?.providerMetadata?.gateway;
  // Check cost first, then fall back to marketCost (Vercel AI Gateway)
  const directCost =
    parseGatewayCost(gateway?.cost) || parseGatewayCost(gateway?.marketCost);
  if (directCost !== undefined && directCost > 0) {
    return directCost;
  }

  return undefined;
}

function parseGatewayCost(cost: unknown): number | undefined {
  if (cost === undefined || cost === null) {
    return undefined;
  }
  if (typeof cost === "number") {
    return cost;
  }
  if (typeof cost === "string") {
    const parsed = parseFloat(cost);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

const deepCopy = (obj: Record<string, unknown>) => {
  return JSON.parse(JSON.stringify(obj));
};

const parsePath = (path: string): (string | number)[] => {
  const keys: (string | number)[] = [];
  let current = "";

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === ".") {
      if (current) {
        keys.push(current);
        current = "";
      }
    } else if (char === "[") {
      if (current) {
        keys.push(current);
        current = "";
      }
      let bracketContent = "";
      i++;
      while (i < path.length && path[i] !== "]") {
        bracketContent += path[i];
        i++;
      }
      if (bracketContent === "") {
        keys.push("[]");
      } else {
        const index = parseInt(bracketContent, 10);
        keys.push(isNaN(index) ? bracketContent : index);
      }
    } else {
      current += char;
    }
  }

  if (current) {
    keys.push(current);
  }

  return keys;
};

const omitAtPath = (obj: any, keys: (string | number)[]): void => {
  if (keys.length === 0) return;

  const firstKey = keys[0];
  const remainingKeys = keys.slice(1);

  if (firstKey === "[]") {
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (remainingKeys.length > 0) {
          omitAtPath(item, remainingKeys);
        }
      });
    }
  } else if (remainingKeys.length === 0) {
    if (obj && typeof obj === "object" && firstKey in obj) {
      obj[firstKey] = "<omitted>";
    }
  } else {
    if (obj && typeof obj === "object" && firstKey in obj) {
      omitAtPath(obj[firstKey], remainingKeys);
    }
  }
};

export const omit = (obj: Record<string, unknown>, paths: string[]) => {
  const result = deepCopy(obj);

  for (const path of paths) {
    const keys = parsePath(path);
    omitAtPath(result, keys);
  }

  return result;
};
