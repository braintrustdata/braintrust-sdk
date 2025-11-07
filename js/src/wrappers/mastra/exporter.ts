/**
 * MastraExporter - Context-aware Braintrust exporter for Mastra
 *
 * This exporter automatically detects and attaches Mastra traces to Braintrust spans.
 * Simply use Mastra agents within logger.traced() or Eval() calls, and traces will
 * automatically be nested correctly.
 *
 * Usage modes:
 * 1. Auto-detection: Automatically detects spans from logger.traced() or Eval() (recommended)
 * 2. Standalone: Creates its own logger when no Braintrust context is detected
 *
 * @example
 * // Inside logger.traced() - automatically detects parent span
 * await logger.traced(async (span) => {
 *   const response = await agent.generate("What is the capital of France?");
 * });
 *
 * @example
 * // Inside Eval() - automatically detects parent span from hooks.span
 * await Eval("my-project", {
 *   data: () => testCases,
 *   task: async (input, hooks) => {
 *     const response = await agent.generate(input);
 *     return response.text;
 *   },
 * });
 */
import type {
  AITracingExporter,
  AITracingEvent,
  AnyExportedAISpan,
  ModelGenerationAttributes,
  ModelStepAttributes,
} from '@mastra/core/ai-tracing';
import { AISpanType, omitKeys } from '@mastra/core/ai-tracing';
import { currentSpan } from '../../logger';
import type { Span, Logger } from '../../logger';

export interface MastraExporterConfig {
  /** Braintrust logger instance (required) */
  logger: Logger<true>;
}

type SpanData = {
  logger: Logger<true> | Span; // Either a logger or an external span
  spans: Map<string, Span>; // Maps span.id to Braintrust span
  activeIds: Set<string>; // Tracks started spans not yet ended
  isExternal: boolean; // True if logger is an external span
};

// Default span type for all spans
const DEFAULT_SPAN_TYPE = 'task';

// Exceptions to the default mapping
const SPAN_TYPE_EXCEPTIONS: Partial<Record<AISpanType, string>> = {
  [AISpanType.MODEL_GENERATION]: 'llm',
  [AISpanType.TOOL_CALL]: 'tool',
  [AISpanType.MCP_TOOL_CALL]: 'tool',
  [AISpanType.WORKFLOW_CONDITIONAL_EVAL]: 'function',
  [AISpanType.WORKFLOW_WAIT_EVENT]: 'function',
};

// Mapping function - returns valid Braintrust span types
function mapSpanType(spanType: AISpanType): 'llm' | 'score' | 'function' | 'eval' | 'task' | 'tool' {
  return (SPAN_TYPE_EXCEPTIONS[spanType] as any) ?? DEFAULT_SPAN_TYPE;
}


export class MastraExporter implements AITracingExporter {
  name = 'braintrust-mastra';
  private traceMap = new Map<string, SpanData>();
  private logger: Logger<true>;

  constructor(config: MastraExporterConfig) {
    this.logger = config.logger;
  }

  async exportEvent(event: AITracingEvent): Promise<void> {
    if (event.exportedSpan.isEvent) {
      await this.handleEventSpan(event.exportedSpan);
      return;
    }

    switch (event.type) {
      case 'span_started':
        await this.handleSpanStarted(event.exportedSpan);
        break;
      case 'span_updated':
        await this.handleSpanUpdateOrEnd(event.exportedSpan, false);
        break;
      case 'span_ended':
        await this.handleSpanUpdateOrEnd(event.exportedSpan, true);
        break;
    }
  }

  private async handleSpanStarted(span: AnyExportedAISpan): Promise<void> {
    if (span.isRootSpan) {
      await this.initLoggerOrUseContext(span);
    }

    const spanData = this.getSpanData({ span });
    if (!spanData) {
      return;
    }

    // Track active spans
    if (!span.isEvent) {
      spanData.activeIds.add(span.id);
    }

    const braintrustParent = this.getBraintrustParent({ spanData, span });
    if (!braintrustParent) {
      return;
    }

    const payload = this.buildSpanPayload(span);

    // When attaching to an external parent (eval/logger span), don't pass Mastra's internal
    // parentSpanIds. Let Braintrust auto-handle the parent-child relationship.
    const shouldOmitParentIds = spanData.isExternal && !span.parentSpanId;

    const braintrustSpan = braintrustParent.startSpan({
      spanId: span.id,
      name: span.name,
      type: mapSpanType(span.type),
      ...(shouldOmitParentIds
        ? {} // Let Braintrust auto-link to parent
        : {
            parentSpanIds: span.parentSpanId
              ? { spanId: span.parentSpanId, rootSpanId: span.traceId }
              : { spanId: span.traceId, rootSpanId: span.traceId },
          }),
      ...payload,
    });

    spanData.spans.set(span.id, braintrustSpan);
  }

  private async handleSpanUpdateOrEnd(span: AnyExportedAISpan, isEnd: boolean): Promise<void> {
    const spanData = this.getSpanData({ span });
    if (!spanData) {
      return;
    }

    const braintrustSpan = spanData.spans.get(span.id);
    if (!braintrustSpan) {
      return;
    }

    braintrustSpan.log(this.buildSpanPayload(span));

    if (isEnd) {
      if (span.endTime) {
        braintrustSpan.end({ endTime: span.endTime.getTime() / 1000 });
      } else {
        braintrustSpan.end();
      }

      // Mark span as ended
      if (!span.isEvent) {
        spanData.activeIds.delete(span.id);
      }

      // Clean up if no more active spans
      if (spanData.activeIds.size === 0 && !spanData.isExternal) {
        this.traceMap.delete(span.traceId);
      }
    }
  }

  private async handleEventSpan(span: AnyExportedAISpan): Promise<void> {
    if (span.isRootSpan) {
      await this.initLoggerOrUseContext(span);
    }

    const spanData = this.getSpanData({ span });
    if (!spanData) {
      return;
    }

    const braintrustParent = this.getBraintrustParent({ spanData, span });
    if (!braintrustParent) {
      return;
    }

    const payload = this.buildSpanPayload(span);

    // Create zero-duration span for event
    const braintrustSpan = braintrustParent.startSpan({
      spanId: span.id,
      name: span.name,
      type: mapSpanType(span.type),
      parentSpanIds: span.parentSpanId
        ? { spanId: span.parentSpanId, rootSpanId: span.traceId }
        : { spanId: span.traceId, rootSpanId: span.traceId },
      startTime: span.startTime.getTime() / 1000,
      ...payload,
    });

    braintrustSpan.end({ endTime: span.startTime.getTime() / 1000 });
  }

  private async initLoggerOrUseContext(span: AnyExportedAISpan): Promise<void> {
    // Try to find a Braintrust span to attach to:
    // 1. Auto-detect from Braintrust's current span (logger.traced(), Eval(), etc.)
    // 2. Fall back to the configured logger

    const braintrustSpan = currentSpan();
    // Check if it's a valid span (not the NOOP_SPAN)
    if (braintrustSpan && braintrustSpan.id) {
      this.traceMap.set(span.traceId, {
        logger: braintrustSpan,
        spans: new Map(),
        activeIds: new Set(),
        isExternal: true,
      });
    } else {
      this.traceMap.set(span.traceId, {
        logger: this.logger,
        spans: new Map(),
        activeIds: new Set(),
        isExternal: false,
      });
    }
  }

  private getSpanData(options: { span: AnyExportedAISpan }): SpanData | undefined {
    const { span } = options;
    if (this.traceMap.has(span.traceId)) {
      return this.traceMap.get(span.traceId);
    }
  }

  private getBraintrustParent(options: {
    spanData: SpanData;
    span: AnyExportedAISpan;
  }): Logger<true> | Span | undefined {
    const { spanData, span } = options;

    const parentId = span.parentSpanId;
    if (!parentId) {
      return spanData.logger;
    }

    if (spanData.spans.has(parentId)) {
      return spanData.spans.get(parentId);
    }

    // Parent might be the root (logger), attach to logger
    if (parentId) {
      return spanData.logger;
    }
  }

  private buildSpanPayload(span: AnyExportedAISpan): Record<string, any> {
    const payload: Record<string, any> = {};

    if (span.input !== undefined) {
      payload.input = span.input;
    }

    if (span.output !== undefined) {
      payload.output = span.output;
    }

    payload.metrics = {};
    payload.metadata = {
      ...span.metadata,
    };

    const attributes = (span.attributes ?? {}) as Record<string, any>;

    if (span.type === AISpanType.MODEL_GENERATION) {
      const modelAttr = attributes as ModelGenerationAttributes;

      if (modelAttr.model !== undefined) {
        payload.metadata.model = modelAttr.model;
      }

      if (modelAttr.provider !== undefined) {
        payload.metadata.provider = modelAttr.provider;
      }

      payload.metrics = normalizeUsageMetrics(modelAttr);

      if (modelAttr.parameters !== undefined) {
        payload.metadata.modelParameters = modelAttr.parameters;
      }

      const otherAttributes = omitKeys(attributes, ['model', 'usage', 'parameters', 'provider']);
      payload.metadata = {
        ...payload.metadata,
        ...otherAttributes,
      };
    } else {
      // For all other span types, put attributes in metadata
      payload.metadata = {
        ...payload.metadata,
        ...attributes,
      };
    }

    if (span.errorInfo) {
      payload.error = span.errorInfo.message;
      payload.metadata.errorDetails = span.errorInfo;
    }

    if (Object.keys(payload.metrics).length === 0) {
      delete payload.metrics;
    }

    return payload;
  }

  async shutdown(): Promise<void> {
    for (const [_traceId, spanData] of this.traceMap) {
      for (const [_spanId, span] of spanData.spans) {
        span.end();
      }
    }
    this.traceMap.clear();
  }
}


/**
 * Normalizes model usage metrics to Braintrust's canonical format.
 * Handles various provider naming conventions (inputTokens vs promptTokens, etc.)
 * and includes support for reasoning tokens and cache tokens.
 *
 * Always includes cache and reasoning token fields (set to 0 if not provided)
 * to ensure consistent structure for Braintrust's cost calculation.
 */
function normalizeUsageMetrics(attributes: ModelGenerationAttributes | ModelStepAttributes): Record<string, any> {
  const metrics: Record<string, any> = {};

  if (attributes.usage) {
    const { usage } = attributes;

    // Prompt tokens: inputTokens (AI SDK) or promptTokens (OpenAI)
    if (usage.inputTokens !== undefined) {
      metrics.prompt_tokens = usage.inputTokens;
    } else if (usage.promptTokens !== undefined) {
      metrics.prompt_tokens = usage.promptTokens;
    }

    // Completion tokens: outputTokens (AI SDK) or completionTokens (OpenAI)
    if (usage.outputTokens !== undefined) {
      metrics.completion_tokens = usage.outputTokens;
    } else if (usage.completionTokens !== undefined) {
      metrics.completion_tokens = usage.completionTokens;
    }

    // Total tokens
    if (usage.totalTokens !== undefined) {
      metrics.tokens = usage.totalTokens;
    }

    // Reasoning tokens (o1 models, Claude thinking, etc.)
    // Always include this field (default to 0) for consistent cost calculation
    metrics.completion_reasoning_tokens = usage.reasoningTokens ?? 0;

    // Cache tokens (Anthropic prompt caching, etc.)
    // Always include these fields (default to 0) for consistent cost calculation
    if (usage.promptCacheHitTokens !== undefined) {
      metrics.prompt_cached_tokens = usage.promptCacheHitTokens;
    } else if (usage.cachedInputTokens !== undefined) {
      // Cache tokens: cachedInputTokens (AI SDK v5)
      metrics.prompt_cached_tokens = usage.cachedInputTokens;
    } else {
      metrics.prompt_cached_tokens = 0;
    }

    if (usage.promptCacheMissTokens !== undefined) {
      metrics.prompt_cache_creation_tokens = usage.promptCacheMissTokens;
    } else {
      metrics.prompt_cache_creation_tokens = 0;
    }
  }

  return metrics;
}