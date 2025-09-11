import { startSpan, traced, withCurrent } from "../logger";
import {
  detectProviderFromResult,
  extractModelFromResult,
  extractModelParameters,
  normalizeFinishReason,
  wrapTools,
} from "./ai-sdk-shared";
import { SpanTypeAttribute } from "../../util/index";

type Fn = (...args: unknown[]) => unknown;

const EXCLUDE_KEYS = new Set([
  "prompt",
  "system",
  "messages",
  "model",
  "providerOptions",
  "tools",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(obj: unknown, key: string): string | undefined {
  if (!isObject(obj)) return undefined;
  const v = Reflect.get(obj as object, key);
  return typeof v === "string" ? v : undefined;
}

function objOrEmpty(value: unknown): Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function wrapMastraAgent<T>(agent: T, options?: { name?: string }): T {
  const prefix = options?.name ?? getString(agent, "name") ?? "mastraAgent";

  // Auto-wrap tools (object or array)
  if (isObject(agent)) {
    const tools = Reflect.get(agent as object, "tools");
    if (Array.isArray(tools)) {
      Reflect.set(agent as object, "tools", wrapTools(tools));
    } else if (isObject(tools)) {
      Reflect.set(agent as object, "tools", wrapTools(tools));
    }
  }

  // generate
  if (isObject(agent)) {
    const gen = Reflect.get(agent as object, "generate");
    if (typeof gen === "function") {
      const original = (gen as Fn).bind(agent);
      const wrapped: Fn = (...args) =>
        traced(
          async (span) => {
            const result = await original(...args);
            const provider = detectProviderFromResult(
              result as { providerMetadata?: Record<string, unknown> },
            );
            const model = extractModelFromResult(
              result as {
                response?: { modelId?: string };
                request?: { body?: { model?: string } };
              },
            );
            const finishReason = normalizeFinishReason(
              (isObject(result)
                ? (result as { finishReason?: unknown }).finishReason
                : undefined) as unknown,
            );
            const output =
              getString(result, "text") ??
              getString(result, "message") ??
              result;
            span.log({
              input: Array.isArray(args) ? args[0] : undefined,
              output,
              metadata: {
                agent_name: getString(agent, "name") ?? prefix,
                ...extractModelParameters(objOrEmpty(args[0]), EXCLUDE_KEYS),
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(finishReason ? { finish_reason: finishReason } : {}),
              },
            });
            return result;
          },
          {
            name: `${prefix}.generate`,
            spanAttributes: { type: SpanTypeAttribute.LLM },
          },
        );
      Reflect.set(agent as object, "generate", wrapped);
    }
  }

  // generateVNext
  if (isObject(agent)) {
    const genNext = Reflect.get(agent as object, "generateVNext");
    if (typeof genNext === "function") {
      const original = (genNext as Fn).bind(agent);
      const wrapped: Fn = (...args) =>
        traced(
          async (span) => {
            const result = await original(...args);
            const provider = detectProviderFromResult(
              result as { providerMetadata?: Record<string, unknown> },
            );
            const model = extractModelFromResult(
              result as {
                response?: { modelId?: string };
                request?: { body?: { model?: string } };
              },
            );
            const finishReason = normalizeFinishReason(
              (isObject(result)
                ? (result as { finishReason?: unknown }).finishReason
                : undefined) as unknown,
            );
            const output =
              getString(result, "text") ??
              getString(result, "message") ??
              result;
            span.log({
              input: Array.isArray(args) ? args[0] : undefined,
              output,
              metadata: {
                agent_name: getString(agent, "name") ?? prefix,
                ...extractModelParameters(objOrEmpty(args[0]), EXCLUDE_KEYS),
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(finishReason ? { finish_reason: finishReason } : {}),
              },
            });
            return result;
          },
          {
            name: `${prefix}.generateVNext`,
            spanAttributes: { type: SpanTypeAttribute.LLM },
          },
        );
      Reflect.set(agent as object, "generateVNext", wrapped);
    }
  }

  type StreamOptions = {
    onChunk?: (c: unknown) => void | Promise<void>;
    onFinish?: (e: unknown) => void | Promise<void>;
    onError?: (e: unknown) => void | Promise<void>;
  } & Record<string, unknown>;

  function overrideStream(methodName: string) {
    if (!isObject(agent)) return;
    const m = Reflect.get(agent as object, methodName);
    if (typeof m !== "function") return;
    const original = (m as Fn).bind(agent);
    const wrapped: Fn = (...args) => {
      const span = startSpan({
        name: `${prefix}.${methodName}`,
        spanAttributes: { type: SpanTypeAttribute.LLM },
        event: {
          input: Array.isArray(args) ? args[0] : undefined,
          metadata: extractModelParameters(objOrEmpty(args[0]), EXCLUDE_KEYS),
        },
      });

      const opts: StreamOptions = isObject(args[1])
        ? (args[1] as StreamOptions)
        : {};
      if (!isObject(args[1])) {
        (args as unknown[])[1] = opts;
      }

      const userOnChunk = opts.onChunk;
      const userOnFinish = opts.onFinish;
      const userOnError = opts.onError;

      try {
        const startTime = Date.now();
        let receivedFirst = false;

        opts.onChunk = (chunk: unknown) => {
          if (!receivedFirst) {
            receivedFirst = true;
            span.log({
              metrics: { time_to_first_token: (Date.now() - startTime) / 1000 },
            });
          }
          if (typeof userOnChunk === "function") userOnChunk(chunk);
        };

        opts.onFinish = async (event: unknown) => {
          if (typeof userOnFinish === "function") await userOnFinish(event);
          const provider = detectProviderFromResult(
            event as { providerMetadata?: Record<string, unknown> },
          );
          const model = extractModelFromResult(
            event as {
              response?: { modelId?: string };
              request?: { body?: { model?: string } };
            },
          );
          const finishReason = normalizeFinishReason(
            (isObject(event)
              ? (event as { finishReason?: unknown }).finishReason
              : undefined) as unknown,
          );
          const text = getString(event, "text");
          span.log({
            output: text ?? event,
            metadata: {
              agent_name: getString(agent, "name") ?? prefix,
              ...extractModelParameters(objOrEmpty(args[0]), EXCLUDE_KEYS),
              ...(provider ? { provider } : {}),
              ...(model ? { model } : {}),
              ...(finishReason ? { finish_reason: finishReason } : {}),
            },
          });
          span.end();
        };

        opts.onError = async (err: unknown) => {
          if (typeof userOnError === "function") await userOnError(err);
          span.log({ error: err instanceof Error ? err.message : String(err) });
          span.end();
        };

        return withCurrent(span, () => original(...args));
      } catch (error) {
        span.log({
          error: error instanceof Error ? error.message : String(error),
        });
        span.end();
        throw error;
      }
    };
    Reflect.set(agent as object, methodName, wrapped);
  }

  overrideStream("stream");
  overrideStream("streamVNext");

  return agent;
}
