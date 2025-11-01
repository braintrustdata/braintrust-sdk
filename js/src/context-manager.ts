export interface ContextParentSpanIds {
  rootSpanId: string;
  spanParents: string[];
}

export interface Span {
  spanId: string;
  rootSpanId: string;
  _getOtelParent(): string | undefined;
  kind: "span";
}

export abstract class ContextManager {
  abstract getParentSpanIds(): ContextParentSpanIds | undefined;
  abstract runInContext<R>(span: Span, callback: () => R): R;
  abstract getCurrentSpan(): Span | undefined;
}
