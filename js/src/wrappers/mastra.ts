import { startSpan, traced, withCurrent } from "../logger";
import {
  detectProviderFromResult,
  extractModelFromResult,
  extractModelParameters,
  extractInput,
  normalizeFinishReason,
  wrapTools,
} from "./ai-sdk-shared";
import { SpanTypeAttribute } from "../../util/index";

/*
MastraAgentMethods is a neutral interface for the Mastra agent methods we use.
This avoids importing `typeof import("mastra")`, which can cause type-identity
conflicts when multiple copies/versions of `mastra` exist in the workspace.
*/
interface MastraAgentMethods {
  name?: string;
  tools?: Record<string, unknown> | unknown[];
  generate?: (...args: unknown[]) => Promise<unknown>;
  generateVNext?: (...args: unknown[]) => Promise<unknown>;
  stream?: (...args: unknown[]) => unknown;
  streamVNext?: (...args: unknown[]) => unknown;
}

function hasAllMethods(a: MastraAgentMethods): a is MastraAgentMethods & {
  generate: (...args: unknown[]) => Promise<unknown>;
  generateVNext: (...args: unknown[]) => Promise<unknown>;
  stream: (...args: unknown[]) => unknown;
  streamVNext: (...args: unknown[]) => unknown;
} {
  return (
    typeof a.generate === "function" &&
    typeof a.generateVNext === "function" &&
    typeof a.stream === "function" &&
    typeof a.streamVNext === "function"
  );
}

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

export function wrapMastraAgent(
  agent: MastraAgentMethods,
  options?: { name?: string },
): MastraAgentMethods {
  const prefix = options?.name ?? agent.name ?? "mastraAgent";

  // Note: Do not assign to agent.tools (it may be a getter-only property).
  // Instead, wrap tools at call time using either params.tools or agent.tools.

  function maybeInjectWrappedTools(args: unknown[]) {
    if (!Array.isArray(args)) return;
    const rawParams: any = isObject(args[0]) ? args[0] : {};
    if (!isObject(rawParams) || rawParams.tools === undefined) return;
    const toolsSource: unknown = (rawParams as any).tools;
    const wrapped = Array.isArray(toolsSource)
      ? wrapTools(toolsSource)
      : isObject(toolsSource)
        ? wrapTools(toolsSource)
        : toolsSource;
    args[0] = { ...rawParams, tools: wrapped } as any;
  }

  function remapMessagesParamToVariadic(args: unknown[]): unknown[] {
    if (!Array.isArray(args)) return args;
    const first: any = args[0];
    if (isObject(first) && Array.isArray(first.messages)) {
      const msgs = first.messages as unknown[];
      // Preserve additional args if any
      return [...msgs, ...args.slice(1)];
    }
    return args;
  }

  // Guard upfront that all methods exist, then override
  if (!hasAllMethods(agent)) {
    return agent;
  }
  const _originalGenerate = agent.generate.bind(agent);
  const _originalGenerateVNext = agent.generateVNext.bind(agent);
  const _originalStream = agent.stream.bind(agent);
  const _originalStreamVNext = agent.streamVNext.bind(agent);

  // generate (explicit override with _original style)
  agent.generate = function (...args: unknown[]) {
    const input = extractInput(Array.isArray(args) ? args[0] : undefined);
    maybeInjectWrappedTools(args);
    return traced(
      async (span) => {
        const callArgs = remapMessagesParamToVariadic(args);
        const r: any = await _originalGenerate(...callArgs);
        const provider = detectProviderFromResult(r);
        const model = extractModelFromResult(r);
        const finishReason = normalizeFinishReason(r?.finishReason);
        const output = r?.text ?? r?.message ?? r;
        const params: any = isObject(args[0]) ? args[0] : {};
        span.log({
          input,
          output,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params, EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
        });
        return r;
      },
      {
        name: `${prefix}.generate`,
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  // generateVNext (explicit override with _original style)
  agent.generateVNext = function (...args: unknown[]) {
    const input = extractInput(Array.isArray(args) ? args[0] : undefined);
    maybeInjectWrappedTools(args);
    return traced(
      async (span) => {
        const callArgs = remapMessagesParamToVariadic(args);
        const r: any = await _originalGenerateVNext(...callArgs);
        const provider = detectProviderFromResult(r);
        const model = extractModelFromResult(r);
        const finishReason = normalizeFinishReason(r?.finishReason);
        const params: any = isObject(args[0]) ? args[0] : {};
        span.log({
          input,
          output: r?.text ?? r?.message ?? r,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params, EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
        });
        return r;
      },
      {
        name: `${prefix}.generateVNext`,
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  type StreamOptions = {
    onChunk?: (c: unknown) => void | Promise<void>;
    onFinish?: (e: unknown) => void | Promise<void>;
    onError?: (e: unknown) => void | Promise<void>;
  } & Record<string, unknown>;

  // stream and streamVNext (explicit overrides with hooks)
  agent.stream = function (...args: unknown[]) {
    const input = extractInput(Array.isArray(args) ? args[0] : undefined);
    maybeInjectWrappedTools(args);
    const params: any = isObject(args[0]) ? args[0] : {};
    const span = startSpan({
      name: `${prefix}.stream`,
      spanAttributes: { type: SpanTypeAttribute.LLM },
      event: {
        input,
        metadata: extractModelParameters(params, EXCLUDE_KEYS),
      },
    });

    const baseOpts: any =
      typeof args[1] === "object" && args[1] !== null ? args[1] : undefined;
    const userOnChunk = baseOpts?.onChunk;
    const userOnFinish = baseOpts?.onFinish;
    const userOnError = baseOpts?.onError;
    const opts: StreamOptions = baseOpts ? { ...baseOpts } : {};
    args[1] = opts;

    try {
      const startTime = Date.now();
      let receivedFirst = false;
      let ended = false;

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
        const e: any = event;
        const provider = detectProviderFromResult(e);
        const model = extractModelFromResult(e);
        const finishReason = normalizeFinishReason(e?.finishReason);
        const text = e?.text;
        span.log({
          output: text ?? e,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params, EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
        });
        ended = true;
        span.end();
      };

      opts.onError = async (err: unknown) => {
        if (typeof userOnError === "function") await userOnError(err);
        span.log({ error: err instanceof Error ? err.message : String(err) });
        ended = true;
        span.end();
      };

      const callArgs = remapMessagesParamToVariadic(args);
      const out: any = withCurrent(span, () => _originalStream(...callArgs));
      if (out && out.text && typeof out.text.then === "function") {
        out.text.then((text: unknown) => {
          if (ended) return;
          const provider = detectProviderFromResult(out);
          const model = extractModelFromResult(out);
          const finishReason = normalizeFinishReason(out?.finishReason);
          span.log({
            output: text,
            metadata: {
              agent_name: agent.name ?? prefix,
              ...extractModelParameters(params, EXCLUDE_KEYS),
              ...(provider ? { provider } : {}),
              ...(model ? { model } : {}),
              ...(finishReason ? { finish_reason: finishReason } : {}),
            },
          });
          ended = true;
          span.end();
        });
      }
      return out;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };

  agent.streamVNext = function (...args: unknown[]) {
    const input = extractInput(Array.isArray(args) ? args[0] : undefined);
    maybeInjectWrappedTools(args);
    const params: any = isObject(args[0]) ? args[0] : {};
    const span = startSpan({
      name: `${prefix}.streamVNext`,
      spanAttributes: { type: SpanTypeAttribute.LLM },
      event: {
        input,
        metadata: extractModelParameters(params, EXCLUDE_KEYS),
      },
    });

    const baseOpts: any =
      typeof args[1] === "object" && args[1] !== null ? args[1] : undefined;
    const userOnChunk = baseOpts?.onChunk;
    const userOnFinish = baseOpts?.onFinish;
    const userOnError = baseOpts?.onError;
    const opts: StreamOptions = baseOpts ? { ...baseOpts } : {};
    args[1] = opts;

    try {
      const startTime = Date.now();
      let receivedFirst = false;
      let ended = false;

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
        const e: any = event;
        const provider = detectProviderFromResult(e);
        const model = extractModelFromResult(e);
        const finishReason = normalizeFinishReason(e?.finishReason);
        const text = e?.text;
        span.log({
          output: text ?? e,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params, EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
        });
        ended = true;
        span.end();
      };

      opts.onError = async (err: unknown) => {
        if (typeof userOnError === "function") await userOnError(err);
        span.log({ error: err instanceof Error ? err.message : String(err) });
        ended = true;
        span.end();
      };

      const callArgs = remapMessagesParamToVariadic(args);
      const out: any = withCurrent(span, () =>
        _originalStreamVNext(...callArgs),
      );
      if (out && out.text && typeof out.text.then === "function") {
        out.text.then((text: unknown) => {
          if (ended) return;
          const provider = detectProviderFromResult(out);
          const model = extractModelFromResult(out);
          const finishReason = normalizeFinishReason(out?.finishReason);
          span.log({
            output: text,
            metadata: {
              agent_name: agent.name ?? prefix,
              ...extractModelParameters(params, EXCLUDE_KEYS),
              ...(provider ? { provider } : {}),
              ...(model ? { model } : {}),
              ...(finishReason ? { finish_reason: finishReason } : {}),
            },
          });
          ended = true;
          span.end();
        });
      }
      return out;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };

  return agent;
}
