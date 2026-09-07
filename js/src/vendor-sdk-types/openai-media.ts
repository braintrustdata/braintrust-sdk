/** Minimal OpenAI image/audio and Realtime surfaces used by instrumentation. */
export interface OpenAIMediaParams {
  model?: string;
  prompt?: string;
  input?: string;
  image?: unknown;
  mask?: unknown;
  file?: unknown;
  stream?: boolean;
  response_format?: string;
  output_format?: string;
  [key: string]: unknown;
}

export interface OpenAIMediaResult {
  model?: string;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  output_format?: string;
  text?: string;
  language?: string;
  duration?: number;
  segments?: unknown[];
  words?: unknown[];
  usage?: unknown;
}

export interface OpenAIMediaEvent extends OpenAIMediaResult {
  type: string;
  b64_json?: string;
  audio?: string;
  delta?: string;
  segment?: unknown;
}

export type OpenAIMediaResponse =
  | OpenAIMediaResult
  | string
  | Response
  | AsyncIterable<OpenAIMediaEvent>;
export type OpenAIMediaMethod = (
  params: OpenAIMediaParams,
  options?: unknown,
) => PromiseLike<OpenAIMediaResponse>;
export interface OpenAIMediaClient {
  images?: {
    generate: OpenAIMediaMethod;
    edit: OpenAIMediaMethod;
    createVariation: OpenAIMediaMethod;
  };
  audio?: {
    speech: { create: OpenAIMediaMethod };
    transcriptions: { create: OpenAIMediaMethod };
    translations: { create: OpenAIMediaMethod };
  };
}

export interface OpenAIRealtimeEvent {
  type: string;
  response_id?: string;
  item_id?: string;
  output_index?: number;
  content_index?: number;
  delta?: string;
  audio?: string;
  transcript?: string;
  item?: Record<string, unknown>;
  session?: Record<string, unknown>;
  response?: {
    id?: string;
    model?: string;
    status?: string;
    status_details?: unknown;
    output?: Array<Record<string, unknown>>;
    usage?: unknown;
    [key: string]: unknown;
  };
  error?: { message?: string; code?: string };
}

export interface OpenAIRealtimeConnection {
  url?: URL;
  on(event: string, listener: (event: OpenAIRealtimeEvent) => void): unknown;
  off(event: string, listener: (event: OpenAIRealtimeEvent) => void): unknown;
  send(event: OpenAIRealtimeEvent): void;
  close(...args: unknown[]): void;
  socket?: {
    addEventListener?(event: string, listener: () => void): void;
    removeEventListener?(event: string, listener: () => void): void;
    on?(event: string, listener: () => void): void;
    off?(event: string, listener: () => void): void;
  };
}
