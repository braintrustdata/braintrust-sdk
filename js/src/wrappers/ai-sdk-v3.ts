import { BraintrustAISDKV3Middleware } from "./ai-sdk-v3-middleware";
import { wrapTraced } from "../logger";

// Import AI SDK v2 types
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider";

/**
 * Wrap AI SDK v3 functions to add Braintrust tracing. Returns wrapped versions
 * of generateText, streamText, generateObject, and streamObject that automatically
 * create spans and log inputs, outputs, and metrics.
 *
 * @param ai - The AI SDK namespace (e.g., import * as ai from "ai")
 * @returns Object with wrapped functions
 *
 * @example
 * ```typescript
 * import { wrapAISDK } from "braintrust";
 * import * as ai from "ai";
 *
 * const { generateText, streamText, generateObject, streamObject } = wrapAISDK(ai);
 *
 * const result = await generateText({
 *   model: openai("gpt-4"),
 *   prompt: "Hello world"
 * });
 * ```
 */
export function wrapAISDK(ai: unknown): {
  generateText: (options: Record<string, unknown>) => Promise<any>;
  streamText: (options: Record<string, unknown>) => Promise<
    {
      stream: ReadableStream<LanguageModelV2StreamPart>;
    } & Record<string, unknown>
  >;
  generateObject: (options: Record<string, unknown>) => Promise<any>;
  streamObject: (options: Record<string, unknown>) => Promise<
    {
      stream: ReadableStream<LanguageModelV2StreamPart>;
    } & Record<string, unknown>
  >;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiSdk = ai as any;

  return {
    generateText: wrapGenerateFunction(aiSdk.generateText, "generateText"),
    streamText: wrapStreamFunction(aiSdk.streamText, "streamText"),
    generateObject: wrapGenerateFunction(
      aiSdk.generateObject,
      "generateObject",
    ),
    streamObject: wrapStreamFunction(aiSdk.streamObject, "streamObject"),
  };
}

function wrapGenerateFunction(
  originalFn: ((options: Record<string, unknown>) => Promise<any>) | undefined,
  functionName: string,
): (options: Record<string, unknown>) => Promise<any> {
  if (!originalFn) {
    return async (options: Record<string, unknown>) => {
      console.warn(`${functionName} is not available in the provided AI SDK`);
      throw new Error(`${functionName} is not supported`);
    };
  }

  return async (options: Record<string, unknown>) => {
    const middleware = BraintrustAISDKV3Middleware(`ai-sdk.${functionName}`);

    if (!middleware.wrapGenerate) {
      return await originalFn(options);
    }

    // Wrap tool executions if present
    const wrappedOptions = wrapToolExecutions(options);

    return await middleware.wrapGenerate({
      doGenerate: async () => await originalFn(wrappedOptions),
      doStream: async () => {
        throw new Error("Stream not supported in generate");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: options as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: null as any, // Not used in our middleware
    });
  };
}

function wrapStreamFunction(
  originalFn:
    | ((options: Record<string, unknown>) => Promise<
        {
          stream: ReadableStream<LanguageModelV2StreamPart>;
        } & Record<string, unknown>
      >)
    | undefined,
  functionName: string,
): (options: Record<string, unknown>) => Promise<
  {
    stream: ReadableStream<LanguageModelV2StreamPart>;
  } & Record<string, unknown>
> {
  if (!originalFn) {
    return async (options: Record<string, unknown>) => {
      console.warn(`${functionName} is not available in the provided AI SDK`);
      throw new Error(`${functionName} is not supported`);
    };
  }

  return async (options: Record<string, unknown>) => {
    const middleware = BraintrustAISDKV3Middleware(`ai-sdk.${functionName}`);

    if (!middleware.wrapStream) {
      return await originalFn(options);
    }

    // Wrap tool executions if present
    const wrappedOptions = wrapToolExecutions(options);

    return await middleware.wrapStream({
      doGenerate: async () => {
        throw new Error("Generate not supported in stream");
      },
      doStream: async () => await originalFn(wrappedOptions),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: options as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: null as any, // Not used in our middleware
    });
  };
}

function wrapToolExecutions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  if (!options.tools) {
    return options;
  }

  if (Array.isArray(options.tools)) {
    const wrappedTools = options.tools.map((tool: any) => {
      if (tool.type === "function" && tool.execute) {
        const originalExecute = tool.execute;
        const toolName = tool.function.name;

        return {
          ...tool,
          execute: wrapTraced(
            async function aiSdkToolExecute(args: unknown) {
              return await originalExecute(args);
            },
            {
              name: `ai-sdk.tool:${toolName}`,
              spanAttributes: { type: "function" },
            },
          ),
        };
      }
      return tool;
    });

    return {
      ...options,
      tools: wrappedTools,
    };
  }

  if (typeof options.tools === "object") {
    const originalTools = options.tools as Record<
      string,
      {
        description?: string;
        parameters?: unknown;
        execute?: (args: unknown) => unknown | Promise<unknown>;
      }
    >;
    const wrappedTools: typeof originalTools = {};

    for (const [name, def] of Object.entries(originalTools)) {
      if (def && typeof def === "object" && def.execute) {
        const originalExecute = def.execute;
        wrappedTools[name] = {
          ...def,
          execute: wrapTraced(
            async function aiSdkToolExecute(args: unknown) {
              return await originalExecute(args);
            },
            {
              name: `ai-sdk.tool:${name}`,
              spanAttributes: { type: "function" },
            },
          ),
        };
      } else {
        wrappedTools[name] = def;
      }
    }

    return {
      ...options,
      tools: wrappedTools,
    };
  }

  return options;
}
