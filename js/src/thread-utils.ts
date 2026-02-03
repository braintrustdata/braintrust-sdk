/**
 * Thread utilities for working with preprocessed conversation messages.
 *
 * This module provides:
 * - IncrementalMerger for deduplicating preprocessor results
 * - Formatting functions for converting messages to human-readable text
 * - computeThreadTemplateVars for creating template variables from threads
 */

import iso from "./isomorph";
import {
  isObject,
  stringToUint8Array,
  uint8ArrayToString,
} from "../util/index";

/**
 * A message with role and content fields (LLM chat message format).
 */
export interface LLMMessage {
  role: string;
  content: unknown;
}

export type StringifyOptions = {
  maxBytes?: number;
};

const DEFAULT_PREPROCESSOR_MAX_BYTES = 100_000;
const TRUNCATION_MARKER = "[middle truncated]";

/**
 * Result of running a preprocessor.
 */
export type PreprocessorResult = unknown | null;

/**
 * Check if an item looks like an LLM message (has role and content).
 */
export function isRoleContentMessage(item: unknown): item is LLMMessage {
  return isObject(item) && "role" in item && "content" in item;
}

/**
 * Check if a value is an array of LLM messages.
 */
export function isLLMMessageArray(value: unknown): value is LLMMessage[] {
  return Array.isArray(value) && value.every(isRoleContentMessage);
}

function utf8ByteLength(text: string): number {
  return stringToUint8Array(text).length;
}

function sliceStringByBytes(
  text: string,
  maxBytes: number,
  fromStart: boolean,
): string {
  if (maxBytes <= 0) {
    return "";
  }

  const encoded = stringToUint8Array(text);
  if (encoded.length <= maxBytes) {
    return text;
  }

  return uint8ArrayToString(
    fromStart
      ? encoded.subarray(0, maxBytes)
      : encoded.subarray(encoded.length - maxBytes),
  );
}

function truncateRawStringByBytes(text: string, maxBytes: number): string {
  const encoded = stringToUint8Array(text);
  if (encoded.length <= maxBytes) {
    return text;
  }

  const marker = `\n\n${TRUNCATION_MARKER}\n\n`;
  const markerBytes = utf8ByteLength(marker);
  if (markerBytes >= maxBytes) {
    return sliceStringByBytes(marker, maxBytes, true);
  }

  const remaining = maxBytes - markerBytes;
  const headBytes = Math.floor(remaining * 0.6);
  const tailBytes = remaining - headBytes;

  const head = uint8ArrayToString(encoded.subarray(0, headBytes));
  const tail = uint8ArrayToString(encoded.subarray(encoded.length - tailBytes));
  return head + marker + tail;
}

function takeFromStart(
  parts: string[],
  joinerBytes: number,
  budget: number,
): { parts: string[]; nextIndex: number } {
  const selected: string[] = [];
  let used = 0;
  let index = 0;

  while (index < parts.length) {
    const part = parts[index];
    const partBytes = utf8ByteLength(part);
    const extra = selected.length > 0 ? joinerBytes : 0;
    if (used + extra + partBytes <= budget) {
      selected.push(part);
      used += extra + partBytes;
      index++;
      continue;
    }

    const remaining = budget - used - extra;
    if (remaining > 0) {
      selected.push(sliceStringByBytes(part, remaining, true));
    }
    index++;
    break;
  }

  return { parts: selected, nextIndex: index };
}

function takeFromEnd(
  parts: string[],
  joinerBytes: number,
  budget: number,
  minIndex: number,
): string[] {
  const selected: string[] = [];
  let used = 0;
  let index = parts.length - 1;

  while (index >= minIndex) {
    const part = parts[index];
    const partBytes = utf8ByteLength(part);
    const extra = selected.length > 0 ? joinerBytes : 0;
    if (used + extra + partBytes <= budget) {
      selected.unshift(part);
      used += extra + partBytes;
      index--;
      continue;
    }

    const remaining = budget - used - extra;
    if (remaining > 0) {
      selected.unshift(sliceStringByBytes(part, remaining, false));
    }
    break;
  }

  return selected;
}

function joinPartsWithTruncation(
  parts: string[],
  joiner: string,
  maxBytes: number,
): string {
  if (parts.length === 0) {
    return "";
  }

  if (!Number.isFinite(maxBytes)) {
    return parts.join(joiner);
  }

  const joinerBytes = utf8ByteLength(joiner);
  let totalBytes = 0;
  for (let i = 0; i < parts.length; i++) {
    totalBytes += utf8ByteLength(parts[i]);
    if (i > 0) {
      totalBytes += joinerBytes;
    }
  }

  if (totalBytes <= maxBytes) {
    return parts.join(joiner);
  }

  if (parts.length === 1) {
    return truncateRawStringByBytes(parts[0], maxBytes);
  }

  const markerBytes = utf8ByteLength(TRUNCATION_MARKER);
  const overhead = markerBytes + 2 * joinerBytes;
  if (overhead >= maxBytes) {
    return sliceStringByBytes(TRUNCATION_MARKER, maxBytes, true);
  }

  const available = maxBytes - overhead;
  const headBudget = Math.floor(available * 0.6);
  const tailBudget = available - headBudget;

  const head = takeFromStart(parts, joinerBytes, headBudget);
  const tail = takeFromEnd(parts, joinerBytes, tailBudget, head.nextIndex);

  const combined = [...head.parts, TRUNCATION_MARKER, ...tail];
  return combined.join(joiner);
}

function resolveMaxBytes(options?: StringifyOptions): number {
  return options?.maxBytes ?? DEFAULT_PREPROCESSOR_MAX_BYTES;
}

/**
 * Indent text with a prefix (default: two spaces).
 */
function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : prefix))
    .join("\n");
}

/**
 * Truncate text from the middle, preserving start and end.
 */
function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const charsRemoved = text.length - maxLen + 30;
  const ellipsis = ` [...${charsRemoved} chars truncated...] `;
  const avail = maxLen - ellipsis.length;
  if (avail <= 0) return text.slice(0, maxLen);
  const left = Math.floor(avail / 2);
  const right = avail - left;
  return text.slice(0, left) + ellipsis + text.slice(-right);
}

interface PendingToolCall {
  name: string;
  args: string;
}

function isTypedPart(
  part: unknown,
): part is { type: string; [key: string]: unknown } {
  return isObject(part) && typeof part.type === "string";
}

function extractToolCalls(content: unknown[]): Map<string, PendingToolCall> {
  const toolCalls = new Map<string, PendingToolCall>();

  for (const part of content) {
    if (!isTypedPart(part) || part.type !== "tool_call") continue;

    const id = typeof part.tool_call_id === "string" ? part.tool_call_id : "";
    if (!id) continue;

    const name =
      typeof part.tool_name === "string" ? part.tool_name : "unknown";

    let args = "";
    if (isObject(part.arguments)) {
      const argsObj = part.arguments;
      if (argsObj.type === "valid") {
        args = JSON.stringify(argsObj.value);
      } else if (typeof argsObj.value === "string") {
        args = argsObj.value;
      } else {
        args = JSON.stringify(argsObj.value);
      }
    }

    toolCalls.set(id, { name, args });
  }

  return toolCalls;
}

function unwrapContent(content: unknown): string {
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return unwrapContent(parsed);
    } catch {
      const errorMatch = content.match(/^error:\s*'(.+)'$/s);
      if (errorMatch) {
        return errorMatch[1];
      }
      return content;
    }
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const item of content) {
      if (isObject(item) && typeof item.text === "string") {
        textParts.push(unwrapContent(item.text));
      } else if (typeof item === "string") {
        textParts.push(unwrapContent(item));
      }
    }
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  if (isObject(content) && typeof content.text === "string") {
    return unwrapContent(content.text);
  }

  return typeof content === "string" ? content : JSON.stringify(content);
}

function formatToolResult(
  toolCallId: string,
  toolName: string,
  output: unknown,
  pendingToolCalls: Map<string, PendingToolCall>,
): string {
  const pendingCall = pendingToolCalls.get(toolCallId);
  const name = toolName || pendingCall?.name || "tool";
  const args = pendingCall?.args || "";

  const resultContent = unwrapContent(output);
  const lines = [`Tool (${name}):`];

  if (args) {
    lines.push(`  Args:`);
    lines.push(`    ${truncateMiddle(args, 500)}`);
  }

  const isError =
    resultContent.toLowerCase().includes("error:") ||
    resultContent.toLowerCase().includes('"error"') ||
    resultContent.toLowerCase().startsWith("error");

  if (isError) {
    lines.push(`  Error:`);
    lines.push(`    ${truncateMiddle(resultContent, 500)}`);
  } else {
    lines.push(`  Result:`);
    lines.push(`    ${truncateMiddle(resultContent, 500)}`);
  }

  if (pendingCall) {
    pendingToolCalls.delete(toolCallId);
  }

  return lines.join("\n");
}

function formatToolResults(
  content: unknown[],
  pendingToolCalls: Map<string, PendingToolCall>,
): string[] {
  const results: string[] = [];

  for (const part of content) {
    if (!isTypedPart(part) || part.type !== "tool_result") continue;

    const toolCallId =
      typeof part.tool_call_id === "string" ? part.tool_call_id : "";
    const toolName = typeof part.tool_name === "string" ? part.tool_name : "";

    results.push(
      formatToolResult(toolCallId, toolName, part.output, pendingToolCalls),
    );
  }

  return results;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim() ? content : "";
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string" && part.trim()) {
      parts.push(part);
    } else if (isTypedPart(part)) {
      if (part.type === "text" && typeof part.text === "string") {
        parts.push(part.text);
      } else if (part.type === "reasoning" && typeof part.text === "string") {
        parts.push(`[thinking: ${part.text.slice(0, 100)}...]`);
      }
    } else if (isObject(part) && typeof part.text === "string") {
      parts.push(part.text);
    }
  }

  return parts.join("\n");
}

/**
 * Format an array of LLM messages as human-readable text.
 */
function formatMessageArrayAsTextInternal(
  messages: LLMMessage[],
  options: StringifyOptions | undefined,
  allowTruncate: boolean,
): string {
  const pendingToolCalls = new Map<string, PendingToolCall>();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const calls = extractToolCalls(msg.content);
      for (const [id, call] of calls) {
        pendingToolCalls.set(id, call);
      }
    }
  }

  const parts: string[] = [];
  for (const msg of messages) {
    const role = msg.role;
    const capitalizedRole = role.charAt(0).toUpperCase() + role.slice(1);

    if (role === "tool" && Array.isArray(msg.content)) {
      const toolResults = formatToolResults(msg.content, pendingToolCalls);
      parts.push(...toolResults);
    } else {
      const text = extractTextContent(msg.content);
      if (text) {
        parts.push(`${capitalizedRole}:\n${indent(text)}`);
      }
    }
  }

  return allowTruncate
    ? joinPartsWithTruncation(parts, "\n\n", resolveMaxBytes(options))
    : parts.join("\n\n");
}

export function formatMessageArrayAsText(
  messages: LLMMessage[],
  options?: StringifyOptions,
): string {
  return formatMessageArrayAsTextInternal(messages, options, true);
}

/**
 * Format a single value as text.
 */
function formatValueAsTextInternal(
  value: unknown,
  options: StringifyOptions | undefined,
  allowTruncate: boolean,
): string {
  if (typeof value === "string") {
    return allowTruncate
      ? truncateRawStringByBytes(value, resolveMaxBytes(options))
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    if (isLLMMessageArray(value)) {
      return formatMessageArrayAsTextInternal(value, options, allowTruncate);
    }
    const parts = value.map((item) =>
      formatValueAsTextInternal(item, options, false),
    );
    return allowTruncate
      ? joinPartsWithTruncation(parts, "\n---\n", resolveMaxBytes(options))
      : parts.join("\n---\n");
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    const allSimple = entries.every(
      ([, v]) =>
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null,
    );
    if (allSimple && entries.length > 0) {
      const parts = entries.map(
        ([k, v]) => `${k}: ${v === null ? "null" : String(v)}`,
      );
      return allowTruncate
        ? joinPartsWithTruncation(parts, "\n", resolveMaxBytes(options))
        : parts.join("\n");
    }
    const json = JSON.stringify(value);
    return allowTruncate
      ? truncateRawStringByBytes(json, resolveMaxBytes(options))
      : json;
  }
  return String(value);
}

export function formatValueAsText(
  value: unknown,
  options?: StringifyOptions,
): string {
  return formatValueAsTextInternal(value, options, true);
}

/**
 * Convert a preprocessor result to a human-readable string.
 */
export function stringifyPreprocessorResult(
  result: PreprocessorResult,
  options?: StringifyOptions,
): string | null {
  if (result === null) {
    return null;
  }
  if (typeof result === "string") {
    return truncateRawStringByBytes(result, resolveMaxBytes(options));
  }
  if (Array.isArray(result)) {
    if (isLLMMessageArray(result)) {
      return formatMessageArrayAsText(result, options);
    }
    const allStrings = result.every((item) => typeof item === "string");
    if (allStrings) {
      return joinPartsWithTruncation(
        result.map((item) => String(item)),
        "\n",
        resolveMaxBytes(options),
      );
    }
    const parts = result.map((item) =>
      formatValueAsTextInternal(item, options, false),
    );
    return joinPartsWithTruncation(parts, "\n---\n", resolveMaxBytes(options));
  }
  return formatValueAsTextInternal(result, options, true);
}

function computeHash(value: unknown): string {
  const hashFn = iso.hash;
  if (!hashFn) {
    return JSON.stringify(value);
  }
  return hashFn(JSON.stringify(value));
}

function extractItems(result: PreprocessorResult): unknown[] {
  if (result === null || result === undefined) {
    return [];
  } else if (Array.isArray(result)) {
    return result;
  } else {
    return [result];
  }
}

/**
 * Incremental merger for preprocessor results.
 * Maintains state across multiple add() calls for memory-efficient
 * page-by-page processing of large result sets.
 */
export class IncrementalMerger {
  private seen = new Set<string>();
  private merged: unknown[] = [];
  private maxBytes?: number;

  constructor(options?: StringifyOptions) {
    this.maxBytes = options?.maxBytes;
  }

  add(result: PreprocessorResult): void {
    const items = extractItems(result);
    for (const item of items) {
      const hash = computeHash(item);
      if (!this.seen.has(hash)) {
        this.seen.add(hash);
        this.merged.push(item);
      }
    }
  }

  getResults(): unknown[] {
    return this.merged;
  }

  hasResults(): boolean {
    return this.merged.length > 0;
  }

  stringify(options?: StringifyOptions): string | null {
    if (this.merged.length === 0) {
      return null;
    }

    if (isLLMMessageArray(this.merged)) {
      return formatMessageArrayAsText(this.merged, {
        maxBytes: options?.maxBytes ?? this.maxBytes,
      });
    }

    const parts = this.merged.map((item) =>
      formatValueAsTextInternal(
        item,
        { maxBytes: options?.maxBytes ?? this.maxBytes },
        false,
      ),
    );
    return joinPartsWithTruncation(
      parts,
      "\n---\n",
      resolveMaxBytes({
        maxBytes: options?.maxBytes ?? this.maxBytes,
      }),
    );
  }

  toJSON(): unknown[] | null {
    if (this.merged.length === 0) {
      return null;
    }
    return this.merged;
  }
}

/**
 * Merge and deduplicate preprocessor results.
 */
export function mergeAndDeduplicateResults(
  results: PreprocessorResult[],
): unknown[] {
  const merger = new IncrementalMerger();
  for (const result of results) {
    merger.add(result);
  }
  return merger.getResults();
}

/**
 * Full pipeline: merge results, then stringify.
 */
export function mergeAndStringify(
  results: PreprocessorResult[],
  options?: StringifyOptions,
): string | null {
  const merger = new IncrementalMerger(options);
  for (const result of results) {
    merger.add(result);
  }
  return merger.stringify(options);
}

/**
 * Template variables computed from a thread for use in LLM-as-a-judge scorers.
 *
 * Note: When used with autoevals' LLMClassifierFromTemplate, `thread` and other
 * message variables automatically render as human-readable text in Mustache
 * templates via the smart escape function.
 */
export interface ThreadTemplateVars {
  thread: unknown[];
  thread_count: number;
  first_message: unknown | null;
  last_message: unknown | null;
  user_messages: unknown[];
  assistant_messages: unknown[];
  human_ai_pairs: Array<{ human: unknown; assistant: unknown }>;
}

/**
 * Compute template variables from a thread for use in mustache/jinja templates.
 * Uses lazy getters so expensive computations only run when accessed.
 */
export function computeThreadTemplateVars(
  thread: unknown[],
): ThreadTemplateVars {
  let _user_messages: unknown[] | undefined;
  let _assistant_messages: unknown[] | undefined;
  let _human_ai_pairs:
    | Array<{ human: unknown; assistant: unknown }>
    | undefined;

  return {
    thread,
    thread_count: thread.length,

    get first_message(): unknown | null {
      return thread[0] ?? null;
    },

    get last_message(): unknown | null {
      return thread[thread.length - 1] ?? null;
    },

    get user_messages(): unknown[] {
      if (_user_messages === undefined) {
        _user_messages = thread.filter(
          (m) => isRoleContentMessage(m) && m.role === "user",
        );
      }
      return _user_messages;
    },

    get assistant_messages(): unknown[] {
      if (_assistant_messages === undefined) {
        _assistant_messages = thread.filter(
          (m) => isRoleContentMessage(m) && m.role === "assistant",
        );
      }
      return _assistant_messages;
    },

    get human_ai_pairs(): Array<{ human: unknown; assistant: unknown }> {
      if (_human_ai_pairs === undefined) {
        _human_ai_pairs = [];
        const users = thread.filter(
          (m) => isRoleContentMessage(m) && m.role === "user",
        );
        const assistants = thread.filter(
          (m) => isRoleContentMessage(m) && m.role === "assistant",
        );
        const pairCount = Math.min(users.length, assistants.length);
        for (let i = 0; i < pairCount; i++) {
          _human_ai_pairs.push({ human: users[i], assistant: assistants[i] });
        }
      }
      return _human_ai_pairs;
    },
  };
}
