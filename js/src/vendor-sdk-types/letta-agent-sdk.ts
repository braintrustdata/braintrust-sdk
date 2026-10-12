// Only the public message fields used for tracing. Do not require the SDK at runtime.
export interface LettaSession {
  agentId?: string | null;
  conversationId?: string | null;
  send(message: unknown, options?: Record<string, unknown>): Promise<void>;
  stream(): AsyncGenerator<LettaMessage>;
  close(): void;
}

export interface LettaClient {
  createAgent(options?: Record<string, unknown>): Promise<string>;
  resumeSession(id: string, options?: Record<string, unknown>): LettaSession;
  createSession(id: string, options?: Record<string, unknown>): LettaSession;
}

export interface LettaSDK {
  LettaAgentClient: new (...args: unknown[]) => LettaClient;
}

export interface LettaMessage {
  type: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  isError?: boolean;
  agentId?: string | null;
  conversationId?: string | null;
  model?: string;
  success?: boolean;
  result?: string;
  structuredOutput?: unknown;
  error?: string;
  message?: string;
  errorDetail?: string;
  errorCode?: string;
  durationMs?: number;
  totalCostUsd?: number;
  stopReason?: string;
  runIds?: string[];
}
