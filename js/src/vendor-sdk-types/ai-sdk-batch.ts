import type { AISDKCallParams, AISDKResult, AISDKTools } from "./ai-sdk";

/** The public experimental batch API in ai >=7.0.108 <8. */
export interface AISDKBatchReference {
  readonly version: 2;
  readonly id: string;
  readonly provider: string;
}

export interface AISDKBatchError {
  readonly message: string;
  readonly type?: string;
  readonly code?: string;
  readonly statusCode?: number;
}

export interface AISDKBatchStatus {
  readonly status: "pending" | "completed" | "failed";
  readonly rawStatus?: string;
  readonly requestCounts?: {
    readonly total: number;
    readonly pending: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly error?: AISDKBatchError;
  readonly createdAt?: string;
}

export type AISDKBatchRequest = AISDKCallParams & {
  id: string;
  type: "text" | "image";
  model: string;
};

export interface AISDKStartBatchOptions {
  requests: ReadonlyArray<AISDKBatchRequest>;
  provider?: unknown;
  providerOptions?: unknown;
  webhookUrl?: string;
  headers?: Record<string, string | undefined>;
  abortSignal?: AbortSignal;
  timeout?: number | { totalMs?: number };
}

export interface AISDKBatchOperationOptions {
  batch: AISDKBatchReference;
  provider?: unknown;
  providerOptions?: unknown;
  tools?: AISDKTools;
  headers?: Record<string, string | undefined>;
  abortSignal?: AbortSignal;
  timeout?: number | { totalMs?: number };
  maxRetries?: number;
}

export type AISDKBatchItem = AISDKResult & {
  readonly id: string;
  readonly type: "text" | "image";
  readonly status: "succeeded" | "failed" | "cancelled" | "expired";
  readonly error?: AISDKBatchError;
};

export interface AISDKBatchAPI {
  experimental_startBatch(
    options: AISDKStartBatchOptions,
  ): Promise<AISDKBatchReference & AISDKBatchStatus>;
  experimental_getBatchStatus(
    options: AISDKBatchOperationOptions,
  ): Promise<AISDKBatchStatus>;
  experimental_getBatchResults(
    options: AISDKBatchOperationOptions,
  ): ReadableStream<AISDKBatchItem> & AsyncIterable<AISDKBatchItem>;
  experimental_cancelBatch(
    options: AISDKBatchOperationOptions,
  ): Promise<unknown>;
}
