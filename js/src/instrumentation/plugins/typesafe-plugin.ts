import { isObject } from "../../../util/index";
import { debugLogger } from "../../debug-logger";
import { Attachment, startSpan, withCurrent } from "../../logger";
import type { Span } from "../../logger";
import {
  INSTRUMENTATION_NAMES,
  withSpanInstrumentationName,
} from "../../span-origin";
import type {
  TypeSafeAPIPromise,
  TypeSafeImage,
  TypeSafeTextWithAssets,
  TypeSafeSystemOneRequest,
  TypeSafeSystemOneResult,
} from "../../vendor-sdk-types/typesafe";
import {
  isAutoInstrumentationSuppressed,
  runWithAutoInstrumentationSuppressed,
} from "../auto-instrumentation-suppression";
import { isAutoCaptureAttachmentsEnabled } from "../../wrappers/attachment-utils";
import { BasePlugin } from "../core";
import { unsubscribeAll } from "../core/tracing";
import { typeSafeChannels } from "./typesafe-interceptors";

export class TypeSafePlugin extends BasePlugin {
  protected onEnable(): void {
    this.unsubscribers.push(
      typeSafeChannels.systemOne.intercept((target, thisArg, args) =>
        interceptSystemOne(target, thisArg, args),
      ),
    );
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }
}

function interceptSystemOne(
  target: (
    this: unknown,
    request: TypeSafeSystemOneRequest,
    options?: unknown,
  ) => PromiseLike<TypeSafeSystemOneResult>,
  thisArg: unknown,
  args: [TypeSafeSystemOneRequest, options?: unknown],
): PromiseLike<TypeSafeSystemOneResult> {
  const invokeTarget = () => Reflect.apply(target, thisArg, args);
  if (isAutoInstrumentationSuppressed()) {
    return invokeTarget();
  }

  let span: Span;
  try {
    const request = args[0];
    const model =
      typeof request?.model === "string"
        ? request.model
        : isObject(thisArg) && typeof thisArg.defaultModel === "string"
          ? thisArg.defaultModel
          : undefined;
    span = startSpan(
      withSpanInstrumentationName(
        {
          event: {
            input: prepareTypeSafeInput(request),
            metadata: {
              ...(model ? { model } : {}),
              provider: "typesafe",
            },
          },
          name: "typesafe.systemOne",
          spanAttributes: { type: "question" },
        },
        INSTRUMENTATION_NAMES.TYPESAFE,
      ),
    );
  } catch (error) {
    debugLogger.error("Error starting span for typesafe.systemOne:", error);
    return invokeTarget();
  }

  let result: PromiseLike<TypeSafeSystemOneResult>;
  try {
    result = withCurrent(span, () =>
      runWithAutoInstrumentationSuppressed(invokeTarget),
    );
  } catch (error) {
    span.log({ error });
    span.end();
    throw error;
  }

  if (!isTypeSafeAPIPromise(result)) {
    const finished = Promise.resolve(result).then(
      (value) => finishSuccessfulSpan(span, value),
      (error) => {
        span.log({ error });
        span.end();
      },
    );
    void finished;
    return result;
  }

  const originalAsResponse = result.asResponse.bind(result);
  const captureFinished = originalAsResponse().then(
    async (response) => {
      try {
        const value = await response.clone().json();
        if (!isObject(value)) {
          throw new TypeError("Expected TypeSafe to return a JSON object");
        }
        finishSuccessfulSpan(span, value);
      } catch (error) {
        debugLogger.error(
          "Error reading response for typesafe.systemOne:",
          error,
        );
        span.end();
      }
    },
    (error) => {
      span.log({ error });
      span.end();
    },
  );
  preserveTypeSafePromise(result, captureFinished);
  return result;
}

function isTypeSafeAPIPromise(
  value: PromiseLike<TypeSafeSystemOneResult>,
): value is TypeSafeAPIPromise<TypeSafeSystemOneResult> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "asResponse") === "function" &&
    typeof Reflect.get(value, "withResponse") === "function" &&
    typeof Reflect.get(value, "map") === "function"
  );
}

function preserveTypeSafePromise<T>(
  apiPromise: TypeSafeAPIPromise<T>,
  captureFinished: Promise<void>,
): void {
  try {
    const originalThen = apiPromise.then.bind(apiPromise);
    const originalAsResponse = apiPromise.asResponse.bind(apiPromise);
    const originalWithResponse = apiPromise.withResponse.bind(apiPromise);
    const originalMap = apiPromise.map.bind(apiPromise);

    const waitForCapture = async <V>(value: V): Promise<V> => {
      await captureFinished;
      return value;
    };
    const then = <TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): Promise<TResult1 | TResult2> =>
      originalThen(
        async (value) => {
          await captureFinished;
          if (onfulfilled) {
            return onfulfilled(value);
          }
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Promise.then returns the original value when no callback is supplied.
          return value as unknown as TResult1;
        },
        async (error) => {
          await captureFinished;
          if (onrejected) {
            return onrejected(error);
          }
          throw error;
        },
      );

    Object.defineProperties(apiPromise, {
      asResponse: {
        configurable: true,
        value: () => originalAsResponse().then(waitForCapture),
      },
      catch: {
        configurable: true,
        value: <TResult = never>(
          onrejected?:
            | ((reason: unknown) => TResult | PromiseLike<TResult>)
            | null,
        ) => then(undefined, onrejected),
      },
      finally: {
        configurable: true,
        value: (onfinally?: (() => void) | null) =>
          then(
            async (value) => {
              await onfinally?.();
              return value;
            },
            async (error) => {
              await onfinally?.();
              throw error;
            },
          ),
      },
      map: {
        configurable: true,
        value: <U>(fn: (data: T) => U) => {
          const mapped = originalMap(fn);
          preserveTypeSafePromise(mapped, captureFinished);
          return mapped;
        },
      },
      then: { configurable: true, value: then },
      withResponse: {
        configurable: true,
        value: () => originalWithResponse().then(waitForCapture),
      },
    });
  } catch (error) {
    debugLogger.error("Error preserving TypeSafe APIPromise helpers:", error);
  }
}

function finishSuccessfulSpan(
  span: Span,
  result: TypeSafeSystemOneResult,
): void {
  const metrics = extractMetrics(result);
  span.log({
    output:
      isObject(result) && result.answers !== undefined
        ? { answers: addIds(result.answers) }
        : undefined,
    ...(isObject(result) && typeof result.model === "string"
      ? { metadata: { model: result.model } }
      : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
  });
  span.end();
}

function addIds(value: unknown): unknown {
  if (!isObject(value)) {
    return value;
  }

  return Object.entries(value).map(([id, entry]) =>
    isObject(entry) ? { ...entry, id } : { id, value: entry },
  );
}

function extractMetrics(
  result: TypeSafeSystemOneResult,
): Record<string, number> {
  const usage = isObject(result) && isObject(result.usage) ? result.usage : {};
  const promptTokens = validTokenCount(usage.input_tokens);
  const completionTokens = validTokenCount(usage.output_tokens);
  return {
    ...(promptTokens !== undefined ? { prompt_tokens: promptTokens } : {}),
    ...(completionTokens !== undefined
      ? { completion_tokens: completionTokens }
      : {}),
    ...(promptTokens !== undefined && completionTokens !== undefined
      ? { tokens: promptTokens + completionTokens }
      : {}),
  };
}

function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Preserve the SDK's references while capturing each asset only once. */
function prepareTypeSafeInput(request: TypeSafeSystemOneRequest): unknown {
  const capture = isAutoCaptureAttachmentsEnabled();
  const names = new Map<TypeSafeImage, string>(
    Object.entries(request.assets ?? {}).map(([name, asset]) => [asset, name]),
  );
  const assets = new Map<string, unknown>();
  const captured = new Map<TypeSafeImage, unknown>();
  const visit = (value: unknown, depth = 0, name?: string): unknown => {
    if (depth >= 128) return "<omitted>";
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    if (value === null || typeof value !== "object") return value;
    if (Symbol.for("@typesafe-ai/sdk/image") in value) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- The shared SDK brand identifies images across package copies.
      const asset = value as unknown as TypeSafeImage;
      const reference = name ?? names.get(asset) ?? asset.toString();
      if (!captured.has(asset)) {
        if (capture) {
          const data = asset.data;
          // TypeSafe accepts PNG and JPEG bytes. Blob MIME types may be absent;
          // retain that uncertainty instead of guessing a format.
          const contentType =
            data instanceof Blob
              ? data.type || "application/octet-stream"
              : data[0] === 0x89 && data[1] === 0x50
                ? "image/png"
                : data[0] === 0xff && data[1] === 0xd8
                  ? "image/jpeg"
                  : "application/octet-stream";
          captured.set(
            asset,
            new Attachment({
              data:
                data instanceof Blob ? data : new Blob([new Uint8Array(data)]),
              contentType,
              filename:
                contentType === "image/png"
                  ? "image.png"
                  : contentType === "image/jpeg"
                    ? "image.jpg"
                    : "image.bin",
            }),
          );
        } else {
          captured.set(asset, { type: "image" });
        }
      }
      assets.set(reference, captured.get(asset));
      return reference;
    }
    if (Symbol.for("@typesafe-ai/sdk/text-with-assets") in value) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- The SDK brand identifies text templates across package copies.
      const template = value as unknown as TypeSafeTextWithAssets;
      let text = template.text;
      for (const asset of template.assets) {
        const reference = visit(asset, depth + 1);
        if (typeof reference === "string")
          text = text.replaceAll(asset.toString(), reference);
      }
      return text;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        visit(child, depth + 1),
      ]),
    );
  };
  for (const [name, asset] of Object.entries(request.assets ?? {}))
    visit(asset, 0, name);
  const state = visit(request.state);
  const questions = visit(addIds(request.questions));
  return {
    state,
    questions,
    ...(assets.size ? { assets: Object.fromEntries(assets) } : {}),
  };
}
