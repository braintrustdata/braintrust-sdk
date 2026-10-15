import { debugLogger } from "../../debug-logger";
import type { Span } from "../../logger";

type Relationship =
  | "input_context"
  | "requested_by"
  | "consumes_tool_result"
  | "generated_by"
  | "transcribed_by";
type Link = {
  context: { traceId: string; spanId: string; traceFlags: number };
  attributes: { "braintrust.relationship.type": Relationship };
};

/** Session-local identity resolution. A late transcript/tool can resolve an earlier link. */
export class Relationships {
  private warned = false;
  private targets = new Map<string, Span>();
  private waiting = new Map<string, Map<Span, Relationship>>();
  private links = new Map<Span, Map<string, Link>>();

  register(id: string, target: Span): void {
    this.targets.set(id, target);
    for (const [source, relationship] of this.waiting.get(id) ?? [])
      this.link(source, target, relationship);
    this.waiting.delete(id);
  }

  reference(source: Span, id: string, relationship: Relationship): void {
    const target = this.targets.get(id);
    if (target) this.link(source, target, relationship);
    else if (this.waiting.size < 8192) {
      const waiting = this.waiting.get(id) ?? new Map();
      waiting.set(source, relationship);
      this.waiting.set(id, waiting);
    }
  }

  link(source: Span, target: Span, relationship: Relationship): void {
    if (source.spanId === target.spanId) return;
    // Legacy UUID ID generators cannot be represented as OTel contexts. Do not
    // fabricate an identity that would point at a different exported span.
    if (
      !/^[0-9a-f]{32}$/.test(target.rootSpanId) ||
      !/^[0-9a-f]{16}$/.test(target.spanId) ||
      /^0+$/.test(target.rootSpanId) ||
      /^0+$/.test(target.spanId)
    ) {
      if (!this.warned)
        debugLogger.warn(
          "LiveKit span links require OpenTelemetry-compatible Braintrust IDs; disable BRAINTRUST_LEGACY_IDS.",
        );
      this.warned = true;
      return;
    }
    const links = this.links.get(source) ?? new Map<string, Link>();
    const key = `${relationship}:${target.rootSpanId}:${target.spanId}`;
    if (links.has(key)) return;
    links.set(key, {
      context: {
        traceId: target.rootSpanId,
        spanId: target.spanId,
        traceFlags: 1,
      },
      attributes: { "braintrust.relationship.type": relationship },
    });
    this.links.set(source, links);
    source.log({ links: [...links.values()] });
  }
}
