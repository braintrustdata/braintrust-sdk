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
const NUMERIC_VERSION_REGEX = /^\d+$/;
const TIME_KEYS = new Set(["created", "start", "end"]);
const SPAN_ID_KEYS = new Set(["id", "span_id", "root_span_id"]);
const XACT_VERSION_KEYS = new Set([
  "currentVersion",
  "initialVersion",
  "version",
]);

function normalizeCallerFilename(value: string): string {
  const e2eIndex = value.lastIndexOf("/e2e/");
  if (e2eIndex >= 0) {
    return `<repo>${value.slice(e2eIndex)}`;
  }

  return value;
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
): Json {
  if (Array.isArray(value)) {
    if (currentKey === "span_parents") {
      return value.map((entry) =>
        typeof entry === "string"
          ? tokenFor(tokenMaps.ids, entry, "span")
          : normalizeValue(entry, tokenMaps),
      );
    }

    return value.map((entry) => normalizeValue(entry, tokenMaps));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeValue(entry as Json, tokenMaps, key),
      ]),
    );
  }

  if (typeof value === "number") {
    if (currentKey && TIME_KEYS.has(currentKey)) {
      return 0;
    }
    return value;
  }

  if (typeof value === "string") {
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

    if (
      currentKey &&
      XACT_VERSION_KEYS.has(currentKey) &&
      NUMERIC_VERSION_REGEX.test(value)
    ) {
      return tokenFor(tokenMaps.xacts, value, "xact");
    }

    if (currentKey === "testRunId") {
      return tokenFor(tokenMaps.runs, value, "run");
    }

    if (currentKey && SPAN_ID_KEYS.has(currentKey)) {
      return tokenFor(tokenMaps.ids, value, "span");
    }

    if (currentKey && TIME_KEYS.has(currentKey)) {
      return "<timestamp>";
    }

    if (ISO_DATE_REGEX.test(value)) {
      return "<timestamp>";
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
