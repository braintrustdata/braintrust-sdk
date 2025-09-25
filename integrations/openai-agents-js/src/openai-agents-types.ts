/**
 * Type definitions copied from @openai/agents-core.
 *
 * Original source: https://github.com/openai/openai-agents-js
 *
 * MIT License
 *
 * Copyright (c) 2025 OpenAI
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type SpanDataBase = {
  type: string;
};

export type AgentSpanData = SpanDataBase & {
  type: "agent";
  name: string;
  handoffs?: string[];
  tools?: string[];
  output_type?: string;
};

export type FunctionSpanData = SpanDataBase & {
  type: "function";
  name: string;
  input: string;
  output: string;
  mcp_data?: string;
};

export type GenerationSpanData = SpanDataBase & {
  type: "generation";
  input?: Array<Record<string, any>>;
  output?: Array<Record<string, any>>;
  model?: string;
  model_config?: Record<string, any>;
  usage?: Record<string, any>;
};

export type ResponseSpanData = SpanDataBase & {
  type: "response";
  response_id?: string;
  /**
   * Not used by the OpenAI tracing provider but helpful for other tracing providers.
   */
  _input?: string | Record<string, any>[];
  _response?: Record<string, any>;
};

export type HandoffSpanData = SpanDataBase & {
  type: "handoff";
  from_agent?: string;
  to_agent?: string;
};

export type CustomSpanData = SpanDataBase & {
  type: "custom";
  name: string;
  data: Record<string, any>;
};

export type GuardrailSpanData = SpanDataBase & {
  type: "guardrail";
  name: string;
  triggered: boolean;
};

export type TranscriptionSpanData = SpanDataBase & {
  type: "transcription";
  input: {
    data: string;
    format: "pcm" | string;
  };
  output?: string;
  model?: string;
  model_config?: Record<string, any>;
};

export type SpeechSpanData = SpanDataBase & {
  type: "speech";
  input?: string;
  output: {
    data: string;
    format: "pcm" | string;
  };
  model?: string;
  model_config?: Record<string, any>;
};

export type SpeechGroupSpanData = SpanDataBase & {
  type: "speech_group";
  input?: string;
};

export type MCPListToolsSpanData = SpanDataBase & {
  type: "mcp_tools";
  server?: string;
  result?: string[];
};

export type SpanData =
  | AgentSpanData
  | FunctionSpanData
  | GenerationSpanData
  | ResponseSpanData
  | HandoffSpanData
  | CustomSpanData
  | GuardrailSpanData
  | TranscriptionSpanData
  | SpeechSpanData
  | SpeechGroupSpanData
  | MCPListToolsSpanData;

// Simplified versions of Trace and Span types - only including what we actually use
export type Trace = {
  type: "trace";
  traceId: string;
  name: string;
  groupId: string | null;
  metadata?: Record<string, any>;
};

export type Span<TData extends SpanData = SpanData> = {
  type: "trace.span";
  traceId: string;
  spanData: TData;
  spanId: string;
  parentId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  error: { message: string; data?: Record<string, any> } | null;
};
