import * as path from "node:path";
import { fileURLToPath } from "node:url";

type Primitive = null | boolean | number | string;
export type Json =
  | Primitive
  | Json[]
  | {
      [key: string]: Json;
    };

type TokenMaps = {
  ids: Map<string, string>;
  runs: Map<string, string>;
  xacts: Map<string, string>;
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SUBSTRING_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const TIME_KEYS = new Set(["created", "date", "start", "end"]);
const SPAN_ID_KEYS = new Set(["id", "span_id", "root_span_id"]);
const ZERO_NUMBER_KEYS = new Set([
  "avgLogprobs",
  "caller_lineno",
  "duration",
  "time_to_first_token",
]);
const XACT_VERSION_KEYS = new Set([
  "currentVersion",
  "initialVersion",
  "version",
]);
const DYNAMIC_HEADER_KEYS = new Set([
  "cf-ray",
  "openai-processing-ms",
  "openai-project",
  "server-timing",
  "set-cookie",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  "x-request-id",
]);
const PROVIDER_ID_KEYS = new Set(["itemId", "responseId", "toolCallId"]);
const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPERS_DIR, "../..").replace(/\\/g, "/");
const STACK_FRAME_REPO_PATH_REGEX =
  /(?:[A-Za-z]:)?[^\s)\n]*braintrust-sdk-javascript(?:[\\/](?:braintrust-sdk-javascript|[^\\/\s)\n]+))?((?:[\\/](?:e2e|js)[^:\s)\n]+)):\d+:\d+/g;
const REPO_PATH_REGEX =
  /(?:[A-Za-z]:)?[^\s)\n]*braintrust-sdk-javascript(?:[\\/](?:braintrust-sdk-javascript|[^\\/\s)\n]+))?((?:[\\/](?:e2e|js)[^:\s)\n]+))/g;
const NODE_INTERNAL_FRAME_REGEX = /node:[^)\n]+:\d+:\d+/g;
const TEMP_SCENARIO_PATH_REGEX =
  /\/e2e\/\.bt-tmp\/[^/\s)]+\/scenarios\/([^/\s)]+)\/?/g;
const TEMP_HELPER_PATH_REGEX = /\/e2e\/\.bt-tmp\/[^/\s)]+\/helpers\/?/g;
const WRAP_AI_SDK_GENERATION_TRACES_SCENARIO_PATH =
  "/e2e/scenarios/wrap-ai-sdk-generation-traces/";
const PROVIDER_HELPER_CALLER_REGEX = /^<repo>\/e2e\/helpers\/.+-scenario\.mjs$/;
const ANTHROPIC_MESSAGE_STREAM_PATH_REGEX =
  /([/\\]node_modules[/\\]\.pnpm[/\\]@anthropic-ai\+sdk@[^/\\\s)]+[/\\]node_modules[/\\]@anthropic-ai[/\\]sdk[/\\])(?:src[/\\]lib[/\\]MessageStream\.ts|lib[/\\]MessageStream\.js)/g;

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSpanAttribute(
  value: { [key: string]: Json },
  key: string,
): Json | undefined {
  const spanAttributes = value.span_attributes;
  if (!isRecord(spanAttributes as Json | undefined)) {
    return undefined;
  }

  return spanAttributes[key];
}

function shouldNormalizeWrapAISDKGenerationTracesCaller(
  row: { [key: string]: Json },
  context: { [key: string]: Json },
  callerFilename: string | undefined,
): boolean {
  const normalizedCallerFilename =
    typeof callerFilename === "string"
      ? normalizeCallerFilename(callerFilename)
      : undefined;

  if (
    typeof normalizedCallerFilename !== "string" ||
    !normalizedCallerFilename.includes(
      WRAP_AI_SDK_GENERATION_TRACES_SCENARIO_PATH,
    )
  ) {
    return false;
  }

  const spanName = getSpanAttribute(row, "name");
  const execCounter = getSpanAttribute(row, "exec_counter");

  return (
    (spanName === "generateText" &&
      execCounter === 2 &&
      normalizedCallerFilename.endsWith("/scenario.impl.ts") &&
      context.caller_functionname === "logger.traced.name") ||
    (spanName === "doGenerate" &&
      execCounter === 3 &&
      normalizedCallerFilename.includes("/node_modules/.pnpm/ai@") &&
      normalizedCallerFilename.endsWith("/node_modules/ai/dist/index.js") &&
      context.caller_functionname === "fn")
  );
}

function normalizeCallerFilename(value: string): string {
  const normalizedValue = value.replace(
    TEMP_SCENARIO_PATH_REGEX,
    "/e2e/scenarios/$1/",
  );
  const helperNormalizedValue = normalizedValue.replace(
    TEMP_HELPER_PATH_REGEX,
    "/e2e/helpers/",
  );
  const e2eIndex = helperNormalizedValue.lastIndexOf("/e2e/");
  if (e2eIndex >= 0) {
    return normalizeModuleSourcePath(
      `<repo>${helperNormalizedValue.slice(e2eIndex)}`,
    );
  }

  return normalizeModuleSourcePath(helperNormalizedValue);
}

function normalizeMockServerUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      return undefined;
    }

    const suffix = `${url.pathname}${url.search}${url.hash}`;
    return suffix === "/" ? "<mock-server>" : `<mock-server>${suffix}`;
  } catch {
    return undefined;
  }
}

function normalizeStackLikeString(value: string): string {
  let normalized = value.replaceAll("file://", "");
  normalized = normalized.replaceAll(REPO_ROOT, "<repo>");
  normalized = normalized.replace(
    TEMP_SCENARIO_PATH_REGEX,
    "/e2e/scenarios/$1/",
  );
  normalized = normalized.replace(TEMP_HELPER_PATH_REGEX, "/e2e/helpers/");

  normalized = normalized.replace(
    STACK_FRAME_REPO_PATH_REGEX,
    (_, suffix: string) => `<repo>${suffix.replace(/\\/g, "/")}:0:0`,
  );
  normalized = normalized.replace(REPO_PATH_REGEX, (_, suffix: string) => {
    return `<repo>${suffix.replace(/\\/g, "/")}`;
  });
  normalized = normalized.replace(
    /(<repo>(?:\/(?:e2e|js)\/[^:\s)\n]+)):\d+:\d+/g,
    "$1:0:0",
  );
  normalized = normalized.replace(
    NODE_INTERNAL_FRAME_REGEX,
    "node:<internal>:0:0",
  );

  return normalizeModuleSourcePath(normalized);
}

function normalizeModuleSourcePath(value: string): string {
  return value.replace(
    ANTHROPIC_MESSAGE_STREAM_PATH_REGEX,
    "$1lib/MessageStream.js",
  );
}

function shouldNormalizeNodeInternalStyleCaller(
  callerFilename: string | undefined,
): boolean {
  if (typeof callerFilename !== "string") {
    return false;
  }

  if (callerFilename.startsWith("node:")) {
    return true;
  }

  return PROVIDER_HELPER_CALLER_REGEX.test(
    normalizeCallerFilename(callerFilename),
  );
}

function normalizeObject(
  value: { [key: string]: Json },
  tokenMaps: TokenMaps,
  currentKey?: string,
  parentObject?: { [key: string]: Json },
): Json {
  const callerFilename =
    typeof value.caller_filename === "string"
      ? value.caller_filename
      : undefined;
  const isNodeInternalCaller =
    shouldNormalizeNodeInternalStyleCaller(callerFilename);
  const shouldNormalizeScenarioCaller =
    currentKey === "context"
      ? shouldNormalizeWrapAISDKGenerationTracesCaller(
          parentObject ?? value,
          value,
          callerFilename,
        )
      : false;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (isNodeInternalCaller || shouldNormalizeScenarioCaller) {
        if (key === "caller_filename") {
          return [key, "<node-internal>"];
        }
        if (key === "caller_functionname") {
          return [key, "<node-internal>"];
        }
        if (key === "caller_lineno") {
          return [key, 0];
        }
      }

      return [key, normalizeValue(entry as Json, tokenMaps, key, value)];
    }),
  );
}

function tokenFor(
  map: Map<string, string>,
  rawValue: string,
  prefix: string,
): string {
  const existing = map.get(rawValue);
  if (existing) {
    return existing;
  }

  const token = `<${prefix}:${map.size + 1}>`;
  map.set(rawValue, token);
  return token;
}

function normalizeValue(
  value: Json,
  tokenMaps: TokenMaps,
  currentKey?: string,
  parentObject?: { [key: string]: Json },
): Json {
  if (Array.isArray(value)) {
    if (currentKey === "span_parents") {
      return value.map((entry) =>
        typeof entry === "string"
          ? tokenFor(tokenMaps.ids, entry, "span")
          : normalizeValue(entry, tokenMaps, undefined, parentObject),
      );
    }

    return value.map((entry) =>
      normalizeValue(entry, tokenMaps, undefined, parentObject),
    );
  }

  if (value && typeof value === "object") {
    return normalizeObject(value, tokenMaps, currentKey, parentObject);
  }

  if (typeof value === "number") {
    if (currentKey && ZERO_NUMBER_KEYS.has(currentKey)) {
      return 0;
    }
    if (currentKey && TIME_KEYS.has(currentKey)) {
      return 0;
    }
    return value;
  }

  if (typeof value === "string") {
    value = normalizeStackLikeString(value);

    const normalizedUrl = normalizeMockServerUrl(value);
    if (normalizedUrl) {
      return normalizedUrl;
    }

    if (currentKey === "caller_filename") {
      return normalizeCallerFilename(value);
    }

    if (currentKey === "_xact_id") {
      return tokenFor(tokenMaps.xacts, value, "xact");
    }

    if (currentKey && DYNAMIC_HEADER_KEYS.has(currentKey)) {
      return `<${currentKey}>`;
    }

    if (currentKey && XACT_VERSION_KEYS.has(currentKey)) {
      return tokenFor(tokenMaps.xacts, value, "xact");
    }

    if (currentKey === "testRunId") {
      return tokenFor(tokenMaps.runs, value, "run");
    }

    if (currentKey && PROVIDER_ID_KEYS.has(currentKey)) {
      return tokenFor(tokenMaps.ids, value, currentKey);
    }

    if (currentKey && SPAN_ID_KEYS.has(currentKey)) {
      return tokenFor(tokenMaps.ids, value, "span");
    }

    if (currentKey && TIME_KEYS.has(currentKey)) {
      return "<timestamp>";
    }

    if (currentKey === "system_fingerprint") {
      return "<system_fingerprint>";
    }

    if (ISO_DATE_REGEX.test(value)) {
      return "<timestamp>";
    }

    const withNormalizedUuids = value.replace(UUID_SUBSTRING_REGEX, (match) =>
      tokenFor(tokenMaps.ids, match, "uuid"),
    );
    if (withNormalizedUuids !== value) {
      return withNormalizedUuids;
    }

    if (UUID_REGEX.test(value)) {
      return tokenFor(tokenMaps.ids, value, "uuid");
    }
  }

  return value;
}

export function normalizeForSnapshot(value: Json): Json {
  return normalizeValue(value, {
    ids: new Map(),
    runs: new Map(),
    xacts: new Map(),
  });
}
