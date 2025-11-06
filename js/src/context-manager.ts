// Context management base class and types
// Break a circular dependency between logger.ts and otel/context.ts
export interface SpanForContext {
  spanId: string;
  rootSpanId: string;
  _getOtelParent?(): string | undefined;
}

export interface ContextParentSpanIds {
  rootSpanId: string;
  spanParents: string[];
}

export abstract class ContextManager {
  abstract getParentSpanIds(): ContextParentSpanIds | undefined;
  abstract runInContext<R>(span: SpanForContext, callback: () => R): R;
  abstract getCurrentSpan(): SpanForContext | undefined;
}
